/**
 * Subshell, Group, and Script Execution
 *
 * Handles execution of subshells (...), groups { ...; }, and user scripts
 */

import type {
  GroupNode,
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
import {
  advanceFd,
  type FdEntry,
  getFdAliasMembers,
  getFdEntry,
} from "./fd-table.js";
import { getErrorMessage } from "./helpers/errors.js";
import { failure, result } from "./helpers/result.js";
import {
  type PreparedRedirections,
  withPreparedRedirections,
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
  /** See `executeGroup`: empty content can still be an owned, empty fd 0. */
  stdinOwned = false,
): Promise<ExecResult> {
  const parentLoopDepth = ctx.state.loopDepth;
  const parentDescriptors = new Map<number, FdEntry>();
  for (const fd of ctx.state.fileDescriptors?.keys() ?? []) {
    const entry = getFdEntry(ctx, fd);
    if (entry) parentDescriptors.set(fd, entry);
  }
  const restoreState = beginIsolatedShellState(ctx);
  ctx.state.parentHasLoopContext = parentLoopDepth > 0;
  ctx.state.loopDepth = 0;
  ctx.state.bashPid = ctx.state.nextVirtualPid++;
  try {
    return await withPreparedRedirections(
      ctx,
      node.redirections,
      stdin,
      (prepared) =>
        executeSubshellBody(
          ctx,
          node,
          prepared.stdin ?? stdin,
          executeStatement,
          stdinOwned || prepared.stdin !== undefined,
        ),
    );
  } finally {
    const consumedDescriptors = new Map<number, number>();
    for (const [fd, parentEntry] of parentDescriptors) {
      const childEntry = getFdEntry(ctx, fd);
      const consumed =
        parentEntry.kind === "input" && childEntry?.kind === "input"
          ? parentEntry.content.length - childEntry.content.length
          : parentEntry.kind === "readwrite" &&
              childEntry?.kind === "readwrite" &&
              parentEntry.path === childEntry.path
            ? childEntry.position - parentEntry.position
            : 0;
      if (consumed <= 0) continue;
      const sourceFd = Math.min(...getFdAliasMembers(ctx, fd));
      consumedDescriptors.set(
        sourceFd,
        Math.max(consumedDescriptors.get(sourceFd) ?? 0, consumed),
      );
    }
    const closing = restoreState();
    if (closing) await closing;
    for (const [fd, consumed] of consumedDescriptors) {
      advanceFd(ctx, fd, consumed);
    }
  }
}

async function executeSubshellBody(
  ctx: InterpreterContext,
  node: SubshellNode,
  stdin: string,
  executeStatement: ExecuteStatementFn,
  stdinOwned: boolean,
): Promise<ExecResult> {
  // Save any existing groupStdin and set new one from pipeline
  if (stdinOwned || stdin) {
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
      return output.build(0);
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
      return output.build(0);
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
      return output.build(error.exitCode);
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
      return output.build(error.exitCode);
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
      return output.build(error.exitCode);
    }
    // Apply output redirections before returning
    output.append("stderr", `${getErrorMessage(error)}\n`);
    return output.build(1);
  }

  return output.build(exitCode);
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
  /**
   * The caller already gave this group its own fd 0 — a function body whose
   * definition or call was redirected. Needed because an empty `stdin` cannot
   * say whether it came from `< empty-file` or from no redirection at all.
   */
  stdinOwned = false,
): Promise<ExecResult> {
  return withPreparedRedirections(ctx, node.redirections, stdin, (prepared) =>
    executeGroupBody(ctx, node, stdin, executeStatement, stdinOwned, prepared),
  );
}

async function executeGroupBody(
  ctx: InterpreterContext,
  node: GroupNode,
  stdin: string,
  executeStatement: ExecuteStatementFn,
  stdinOwned: boolean,
  prepared: PreparedRedirections,
): Promise<ExecResult> {
  const output = new ExecutionOutputAccumulator(ctx.executionScope, "group");
  let exitCode = 0;

  // Process heredoc and input redirections to get stdin content.
  // `ownsStdin` records whether the group gets its *own* fd 0 — from a
  // pipeline (`… | { …; }`) or from a redirection on the group itself
  // (`{ …; } < file`, `<<EOT`, `<<<`). A group without one shares the
  // enclosing shell's stdin, which decides what has to be restored below.
  const effectiveStdin = prepared.stdin ?? stdin;
  const ownsStdin = stdinOwned || stdin !== "" || prepared.stdin !== undefined;

  // A group restores only the stdin it actually replaced.
  //
  // `{ …; } < file` (or a heredoc/here-string on the group, or a pipe into it)
  // gives the group its own fd 0, so the enclosing shell's read position has to
  // come back untouched by whatever the body read.
  //
  // A group without one shares the shell's fd 0. Reads inside it move the one
  // shared position, and `{ { read a; }; read b; }` must therefore give `b` the
  // *second* line: putting the saved position back would replay a line the
  // inner group already consumed.
  const savedGroupStdin = ctx.state.groupStdin;
  if (ownsStdin) {
    ctx.state.groupStdin = effectiveStdin;
  }
  const restoreGroupStdin = (): void => {
    // A shared stdin can be consumed down to "" but never taken away:
    // `undefined` means "this scope has no stdin at all", which is not a read
    // position. If the body left `undefined` where the group inherited a
    // stream, something inside cleared shared state it does not own (pipeline
    // stages do on main — see #328) and there is no position to hand back.
    if (
      ownsStdin ||
      (savedGroupStdin !== undefined && ctx.state.groupStdin === undefined)
    ) {
      ctx.state.groupStdin = savedGroupStdin;
    }
  };

  try {
    for (const stmt of node.body) {
      const res = await executeStatement(stmt);
      output.appendResult(res);
      exitCode = res.exitCode;
    }
  } catch (error) {
    // Restore groupStdin before handling error
    restoreGroupStdin();
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
  restoreGroupStdin();

  return output.build(exitCode);
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
  const cleanup = beginIsolatedShellState(ctx);

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
    const closing = cleanup();
    if (closing) await closing;
    return execResult;
  } catch (error) {
    const closing = cleanup();
    if (closing) await closing;

    // Executable scripts run in a subshell-like environment, so exit only
    // ends the script and returns its status to the surrounding command list.
    if (error instanceof ExitError) {
      return result(error.stdout, error.stderr, error.exitCode);
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
