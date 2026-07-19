/**
 * Subshell, Group, and Script Execution
 *
 * Handles execution of subshells (...), groups { ...; }, and user scripts
 */

import type {
  GroupNode,
  HereDocNode,
  ScriptNode,
  StatementNode,
  SubshellNode,
} from "../ast/types.js";
import { ExecutionOutputAccumulator } from "../execution-output.js";
import { Parser } from "../parser/parser.js";
import type { ParseException } from "../parser/types.js";
import type { ExecResult } from "../types.js";
import {
  BreakError,
  ContinueError,
  ErrexitError,
  ExecutionLimitError,
  ExitError,
  isScopeExitError,
  ReturnError,
  SubshellExitError,
} from "./errors.js";
import { expandWord } from "./expansion.js";
import { getErrorMessage } from "./helpers/errors.js";
import { checkFdLimit, failure, result } from "./helpers/result.js";
import {
  applyRedirections,
  preOpenOutputRedirects,
  processFdVariableRedirections,
} from "./redirections.js";
import { beginIsolatedShellState } from "./state-transaction.js";
import type { InterpreterContext } from "./types.js";

/**
 * Type for executeStatement callback
 */
export type ExecuteStatementFn = (stmt: StatementNode) => Promise<ExecResult>;

/**
 * Execute a subshell node (...).
 * Creates an isolated execution environment that doesn't affect the parent.
 */
export async function executeSubshell(
  ctx: InterpreterContext,
  node: SubshellNode,
  stdin: string,
  executeStatement: ExecuteStatementFn,
): Promise<ExecResult> {
  // Pre-open output redirects to truncate files BEFORE executing body
  // This matches bash behavior where redirect files are opened before
  // any command substitutions in the subshell body are evaluated
  const preparedRedirects = await preOpenOutputRedirects(
    ctx,
    node.redirections,
  );
  if (preparedRedirects.error) {
    return preparedRedirects.error;
  }

  const parentLoopDepth = ctx.state.loopDepth;
  const restore = beginIsolatedShellState(ctx.state);
  // Track if parent has loop context - break/continue in subshell should exit subshell
  ctx.state.parentHasLoopContext = parentLoopDepth > 0;
  ctx.state.loopDepth = 0;

  // Subshells get a new BASHPID (unlike $$ which stays the same)
  ctx.state.bashPid = ctx.state.nextVirtualPid++;

  // Save any existing groupStdin and set new one from pipeline
  if (stdin) {
    ctx.state.groupStdin = stdin;
  }

  const output = new ExecutionOutputAccumulator(ctx.executionScope, "subshell");
  let exitCode = 0;

  try {
    for (const stmt of node.body) {
      const res = await executeStatement(stmt);
      output.appendResult(res);
      exitCode = res.exitCode;
    }
  } catch (error) {
    restore();
    // ExecutionLimitError must always propagate - these are safety limits
    if (error instanceof ExecutionLimitError) {
      output.prependTo(error);
      throw error;
    }
    // SubshellExitError means break/continue was called when parent had loop context
    // This exits the subshell cleanly with exit code 0
    if (error instanceof SubshellExitError) {
      output.append(
        "stdout",
        error.stdout,
        error.internalOutputAccounting.stdout,
      );
      output.append(
        "stderr",
        error.stderr,
        error.internalOutputAccounting.stderr,
      );
      // Apply output redirections before returning
      const bodyResult = output.build(0);
      return applyRedirections(
        ctx,
        bodyResult,
        node.redirections,
        preparedRedirects.targets,
      );
    }
    // BreakError/ContinueError should NOT propagate out of subshell
    // They only affect loops within the subshell
    if (error instanceof BreakError || error instanceof ContinueError) {
      output.append(
        "stdout",
        error.stdout,
        error.internalOutputAccounting.stdout,
      );
      output.append(
        "stderr",
        error.stderr,
        error.internalOutputAccounting.stderr,
      );
      // Apply output redirections before returning
      const bodyResult = output.build(0);
      return applyRedirections(
        ctx,
        bodyResult,
        node.redirections,
        preparedRedirects.targets,
      );
    }
    // ExitError in subshell should NOT propagate - just return the exit code
    // (subshells are like separate processes)
    if (error instanceof ExitError) {
      output.append(
        "stdout",
        error.stdout,
        error.internalOutputAccounting.stdout,
      );
      output.append(
        "stderr",
        error.stderr,
        error.internalOutputAccounting.stderr,
      );
      // Apply output redirections before returning
      const bodyResult = output.build(error.exitCode);
      return applyRedirections(
        ctx,
        bodyResult,
        node.redirections,
        preparedRedirects.targets,
      );
    }
    // ReturnError in subshell (e.g., f() ( return 42; )) should also just exit
    // with the given code, since subshells are like separate processes
    if (error instanceof ReturnError) {
      output.append(
        "stdout",
        error.stdout,
        error.internalOutputAccounting.stdout,
      );
      output.append(
        "stderr",
        error.stderr,
        error.internalOutputAccounting.stderr,
      );
      // Apply output redirections before returning
      const bodyResult = output.build(error.exitCode);
      return applyRedirections(
        ctx,
        bodyResult,
        node.redirections,
        preparedRedirects.targets,
      );
    }
    if (error instanceof ErrexitError) {
      // Apply output redirections before propagating
      output.append(
        "stdout",
        error.stdout,
        error.internalOutputAccounting.stdout,
      );
      output.append(
        "stderr",
        error.stderr,
        error.internalOutputAccounting.stderr,
      );
      const bodyResult = output.build(error.exitCode);
      return applyRedirections(
        ctx,
        bodyResult,
        node.redirections,
        preparedRedirects.targets,
      );
    }
    // Apply output redirections before returning
    output.append("stderr", `${getErrorMessage(error)}\n`);
    const bodyResult = output.build(1);
    return applyRedirections(
      ctx,
      bodyResult,
      node.redirections,
      preparedRedirects.targets,
    );
  }

  restore();

  // Apply output redirections
  const bodyResult = output.build(exitCode);
  return applyRedirections(
    ctx,
    bodyResult,
    node.redirections,
    preparedRedirects.targets,
  );
}

/**
 * Execute a group node { ...; }.
 * Runs commands in the current execution environment.
 */
export async function executeGroup(
  ctx: InterpreterContext,
  node: GroupNode,
  stdin: string,
  executeStatement: ExecuteStatementFn,
): Promise<ExecResult> {
  const output = new ExecutionOutputAccumulator(ctx.executionScope, "group");
  let exitCode = 0;

  const preparedRedirects = await preOpenOutputRedirects(
    ctx,
    node.redirections,
  );
  if (preparedRedirects.error) return preparedRedirects.error;

  // Process FD variable redirections ({varname}>file syntax)
  const fdVarError = await processFdVariableRedirections(
    ctx,
    node.redirections,
    preparedRedirects.targets,
  );
  if (fdVarError) {
    return fdVarError;
  }

  // Process heredoc and input redirections to get stdin content
  let effectiveStdin = stdin;
  for (const redir of node.redirections) {
    if (
      (redir.operator === "<<" || redir.operator === "<<-") &&
      redir.target.type === "HereDoc"
    ) {
      const hereDoc = redir.target as HereDocNode;
      let content = await expandWord(ctx, hereDoc.content);
      if (hereDoc.stripTabs) {
        content = content
          .split("\n")
          .map((line) => line.replace(/^\t+/, ""))
          .join("\n");
      }
      // If this is a non-standard fd (not 0), store in fileDescriptors for -u option
      const fd = redir.fd ?? 0;
      if (fd !== 0) {
        if (!ctx.state.fileDescriptors) {
          ctx.state.fileDescriptors = new Map();
        }
        checkFdLimit(ctx);
        ctx.state.fileDescriptors.set(fd, content);
      } else {
        effectiveStdin = content;
      }
    } else if (redir.operator === "<<<" && redir.target.type === "Word") {
      effectiveStdin = `${
        preparedRedirects.targets.get(node.redirections.indexOf(redir)) ?? ""
      }\n`;
    } else if (redir.operator === "<" && redir.target.type === "Word") {
      try {
        const target =
          preparedRedirects.targets.get(node.redirections.indexOf(redir)) ?? "";
        const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
        effectiveStdin = await ctx.fs.readFile(filePath);
      } catch {
        const target =
          preparedRedirects.targets.get(node.redirections.indexOf(redir)) ?? "";
        return result("", `bash: ${target}: No such file or directory\n`, 1);
      }
    }
  }

  // Save any existing groupStdin and set new one from pipeline
  const savedGroupStdin = ctx.state.groupStdin;
  if (effectiveStdin) {
    ctx.state.groupStdin = effectiveStdin;
  }

  try {
    for (const stmt of node.body) {
      const res = await executeStatement(stmt);
      output.appendResult(res);
      exitCode = res.exitCode;
    }
  } catch (error) {
    // Restore groupStdin before handling error
    ctx.state.groupStdin = savedGroupStdin;
    // ExecutionLimitError must always propagate - these are safety limits
    if (error instanceof ExecutionLimitError) {
      output.prependTo(error);
      throw error;
    }
    if (
      isScopeExitError(error) ||
      error instanceof ErrexitError ||
      error instanceof ExitError
    ) {
      error.prependOutput(output.stdout, output.stderr);
      throw error;
    }
    output.append("stderr", `${getErrorMessage(error)}\n`);
    return output.build(1);
  }

  // Restore groupStdin
  ctx.state.groupStdin = savedGroupStdin;

  // Apply output redirections
  const bodyResult = output.build(exitCode);
  return applyRedirections(
    ctx,
    bodyResult,
    node.redirections,
    preparedRedirects.targets,
  );
}

/**
 * Type for executeScript callback
 */
export type ExecuteScriptFn = (node: ScriptNode) => Promise<ExecResult>;

/**
 * Execute a user script file found in PATH.
 * This handles executable files that don't have registered command handlers.
 * The script runs in a subshell-like environment with its own positional parameters.
 */
export async function executeUserScript(
  ctx: InterpreterContext,
  scriptPath: string,
  args: string[],
  stdin: string,
  executeScript: ExecuteScriptFn,
): Promise<ExecResult> {
  // Read the script content
  let content: string;
  try {
    content = await ctx.fs.readFile(scriptPath);
  } catch {
    return failure(`bash: ${scriptPath}: No such file or directory\n`, 127);
  }

  // Check for shebang and skip it if present (we'll execute as bash script)
  // Note: we don't actually support different interpreters, just bash
  if (content.startsWith("#!")) {
    const firstNewline = content.indexOf("\n");
    if (firstNewline !== -1) {
      content = content.slice(firstNewline + 1);
    }
  }

  const parentLoopDepth = ctx.state.loopDepth;
  const cleanup = beginIsolatedShellState(ctx.state);

  // Set up subshell-like environment
  ctx.state.parentHasLoopContext = parentLoopDepth > 0;
  ctx.state.loopDepth = 0;
  ctx.state.bashPid = ctx.state.nextVirtualPid++;
  if (stdin) {
    ctx.state.groupStdin = stdin;
  }
  ctx.state.currentSource = scriptPath;

  // Set positional parameters ($1, $2, etc.) from args
  // $0 should be the script path
  ctx.state.env.set("0", scriptPath);
  ctx.state.env.set("#", String(args.length));
  ctx.state.env.set("@", args.join(" "));
  ctx.state.env.set("*", args.join(" "));
  for (let i = 0; i < args.length && i < 9; i++) {
    ctx.state.env.set(String(i + 1), args[i]);
  }
  // Clear any remaining positional parameters
  for (let i = args.length + 1; i <= 9; i++) {
    ctx.state.env.delete(String(i));
  }

  try {
    const parser = new Parser();
    const ast = parser.parse(content);
    const execResult = await executeScript(ast);
    cleanup();
    return execResult;
  } catch (error) {
    cleanup();

    // ExitError propagates up (but with output from this script)
    if (error instanceof ExitError) {
      throw error;
    }

    // ExecutionLimitError must always propagate
    if (error instanceof ExecutionLimitError) {
      throw error;
    }

    // Handle parse errors
    if ((error as ParseException).name === "ParseException") {
      return failure(`bash: ${scriptPath}: ${(error as Error).message}\n`);
    }

    throw error;
  }
}
