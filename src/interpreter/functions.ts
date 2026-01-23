/**
 * Function Handling
 *
 * Handles shell function definition and invocation:
 * - Function definition (adding to function table)
 * - Function calls (with positional parameters and local scopes)
 */

import type {
  FunctionDefNode,
  HereDocNode,
  RedirectionNode,
  WordNode,
} from "../ast/types.js";
import type { ExecResult } from "../types.js";
import { ExitError, ReturnError } from "./errors.js";
import { expandWord } from "./expansion.js";
import { OK, result, throwExecutionLimit } from "./helpers/result.js";
import type { InterpreterContext } from "./types.js";

/**
 * POSIX special built-in commands that cannot be redefined as functions in POSIX mode.
 */
const POSIX_SPECIAL_BUILTINS = new Set([
  ":",
  ".",
  "break",
  "continue",
  "eval",
  "exec",
  "exit",
  "export",
  "readonly",
  "return",
  "set",
  "shift",
  "trap",
  "unset",
]);

export function executeFunctionDef(
  ctx: InterpreterContext,
  node: FunctionDefNode,
): ExecResult {
  // In POSIX mode, special built-ins cannot be redefined as functions
  // This is a fatal error that exits the script
  if (ctx.state.options.posix && POSIX_SPECIAL_BUILTINS.has(node.name)) {
    const stderr = `bash: line ${ctx.state.currentLine}: \`${node.name}': is a special builtin\n`;
    throw new ExitError(2, "", stderr);
  }
  ctx.state.functions.set(node.name, node);
  return OK;
}

/**
 * Process input redirections to get stdin content for function calls.
 * Handles heredocs (<<, <<-), here-strings (<<<), and file input (<).
 */
async function processInputRedirections(
  ctx: InterpreterContext,
  redirections: RedirectionNode[],
): Promise<string> {
  let stdin = "";

  for (const redir of redirections) {
    if (
      (redir.operator === "<<" || redir.operator === "<<-") &&
      redir.target.type === "HereDoc"
    ) {
      const hereDoc = redir.target as HereDocNode;
      let content = await expandWord(ctx, hereDoc.content);
      // <<- strips leading tabs from each line
      if (hereDoc.stripTabs) {
        content = content
          .split("\n")
          .map((line) => line.replace(/^\t+/, ""))
          .join("\n");
      }
      // Only handle fd 0 (stdin) for now
      const fd = redir.fd ?? 0;
      if (fd === 0) {
        stdin = content;
      }
    } else if (redir.operator === "<<<" && redir.target.type === "Word") {
      stdin = `${await expandWord(ctx, redir.target as WordNode)}\n`;
    } else if (redir.operator === "<" && redir.target.type === "Word") {
      const target = await expandWord(ctx, redir.target as WordNode);
      const filePath = ctx.fs.resolvePath(ctx.state.cwd, target);
      try {
        stdin = await ctx.fs.readFile(filePath);
      } catch {
        // File not found - stdin remains unchanged
      }
    }
  }

  return stdin;
}

export async function callFunction(
  ctx: InterpreterContext,
  func: FunctionDefNode,
  args: string[],
  stdin = "",
): Promise<ExecResult> {
  ctx.state.callDepth++;
  if (ctx.state.callDepth > ctx.limits.maxCallDepth) {
    ctx.state.callDepth--;
    throwExecutionLimit(
      `${func.name}: maximum recursion depth (${ctx.limits.maxCallDepth}) exceeded, increase executionLimits.maxCallDepth`,
      "recursion",
    );
  }

  ctx.state.localScopes.push(new Map());

  const savedPositional: Record<string, string | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    savedPositional[String(i + 1)] = ctx.state.env[String(i + 1)];
    ctx.state.env[String(i + 1)] = args[i];
  }
  savedPositional["@"] = ctx.state.env["@"];
  savedPositional["#"] = ctx.state.env["#"];
  ctx.state.env["@"] = args.join(" ");
  ctx.state.env["#"] = String(args.length);

  const cleanup = (): void => {
    const localScope = ctx.state.localScopes.pop();
    if (localScope) {
      for (const [varName, originalValue] of localScope) {
        if (originalValue === undefined) {
          delete ctx.state.env[varName];
        } else {
          ctx.state.env[varName] = originalValue;
        }
      }
    }

    for (const [key, value] of Object.entries(savedPositional)) {
      if (value === undefined) {
        delete ctx.state.env[key];
      } else {
        ctx.state.env[key] = value;
      }
    }

    ctx.state.callDepth--;
  };

  try {
    // Process redirections on the function definition to get stdin
    // Only use redirection-based stdin if no pipeline stdin was passed
    const redirectionStdin = await processInputRedirections(
      ctx,
      func.redirections,
    );
    const effectiveStdin = stdin || redirectionStdin;
    const execResult = await ctx.executeCommand(func.body, effectiveStdin);
    cleanup();
    return execResult;
  } catch (error) {
    cleanup();
    // Handle return statement - convert to normal exit with the specified code
    if (error instanceof ReturnError) {
      return result(error.stdout, error.stderr, error.exitCode);
    }
    throw error;
  }
}
