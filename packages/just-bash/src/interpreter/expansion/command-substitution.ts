/**
 * Command Substitution Helpers
 *
 * Helper functions for handling command substitution patterns.
 */

import type {
  ScriptNode,
  SimpleCommandNode,
  WordNode,
} from "../../ast/types.js";
import { Parser } from "../../parser/parser.js";
import { ExecutionLimitError, ExitError } from "../errors.js";
import { recordSubstitutionExit } from "../helpers/substitution-status.js";
import { beginIsolatedShellState } from "../state-transaction.js";
import type { InterpreterContext } from "../types.js";

/**
 * Check if a command substitution body matches the $(<file) shorthand pattern.
 * This is a special case where $(< file) is equivalent to $(cat file) but reads
 * the file directly without spawning a subprocess.
 *
 * For this to match, the body must consist of:
 * - One statement without operators (no && or ||)
 * - One pipeline with one command
 * - A SimpleCommand with no name, no args, no assignments
 * - Exactly one input redirection (<)
 *
 * Note: The special $(<file) behavior only works when it's the ONLY element
 * in the command substitution. $(< file; cmd) or $(cmd; < file) are NOT special.
 */
export function getFileReadShorthand(
  body: ScriptNode,
): { target: WordNode } | null {
  // Must have exactly one statement
  if (body.statements.length !== 1) return null;

  const statement = body.statements[0];
  // Must not have any operators (no && or ||)
  if (statement.operators.length !== 0) return null;
  // Must have exactly one pipeline
  if (statement.pipelines.length !== 1) return null;

  const pipeline = statement.pipelines[0];
  // Must not be negated
  if (pipeline.negated) return null;
  // Must have exactly one command
  if (pipeline.commands.length !== 1) return null;

  const cmd = pipeline.commands[0];
  // Must be a SimpleCommand
  if (cmd.type !== "SimpleCommand") return null;

  const simpleCmd = cmd as SimpleCommandNode;
  // Must have no command name
  if (simpleCmd.name !== null) return null;
  // Must have no arguments
  if (simpleCmd.args.length !== 0) return null;
  // Must have no assignments
  if (simpleCmd.assignments.length !== 0) return null;
  // Must have exactly one redirection
  if (simpleCmd.redirections.length !== 1) return null;

  const redirect = simpleCmd.redirections[0];
  // Must be an input redirection (<)
  if (redirect.operator !== "<") return null;
  // Target must be a WordNode (not heredoc)
  if (redirect.target.type !== "Word") return null;

  return { target: redirect.target };
}

/**
 * Execute a command substitution body against the *current* interpreter state.
 *
 * Command substitutions are subshell-like: they see everything the running
 * script has set (including non-exported variables), but their own mutations to
 * the environment, arrays and cwd are discarded afterwards. Callers must never
 * route this through `ctx.execFn`, which starts a fresh top-level execution
 * seeded from the instance's base state and therefore cannot see any variable
 * assigned by the running script.
 *
 * Returns stdout with trailing newlines stripped, exactly like `$(...)`.
 */
export async function runCommandSubstitution(
  ctx: InterpreterContext,
  body: ScriptNode,
): Promise<string> {
  // Command substitution runs in a subshell-like context.
  // ExitError should NOT terminate the main script, just this substitution.
  // But ExecutionLimitError MUST propagate to protect against infinite recursion.
  const currentDepth = ctx.substitutionDepth ?? 0;
  const maxDepth = ctx.limits.maxSubstitutionDepth;
  if (currentDepth >= maxDepth) {
    throw new ExecutionLimitError(
      `Command substitution nesting limit exceeded (${maxDepth})`,
      "substitution_depth",
    );
  }
  // Increment depth for nested substitutions
  const savedDepth = ctx.substitutionDepth;
  ctx.substitutionDepth = currentDepth + 1;

  // The substitution reads the live state but must not write back to it: a
  // `set -u`, a function definition or a `cd` inside $() is discarded the way
  // bash discards a subshell's. beginIsolatedShellState swaps in copies of
  // every mutable namespace and returns the rollback.
  const restoreState = beginIsolatedShellState(ctx.state);
  // Command substitutions get a new BASHPID (unlike $$ which stays the same)
  ctx.state.bashPid = ctx.state.nextVirtualPid++;
  // Suppress verbose mode (set -v) inside command substitutions
  // bash only prints verbose output for the main script
  const savedSuppressVerbose = ctx.state.suppressVerbose;
  ctx.state.suppressVerbose = true;

  const restore = (): void => {
    restoreState();
    ctx.state.suppressVerbose = savedSuppressVerbose;
    ctx.substitutionDepth = savedDepth;
  };

  try {
    const result = await ctx.executeScript(body);
    // Roll the subshell state back before publishing anything to the parent:
    // the exit code and stderr below are the only things that cross the boundary.
    restore();
    // Store the exit code for $?
    recordSubstitutionExit(ctx.state, result.exitCode);
    // Command substitution stderr should go to the shell's stderr at expansion
    // time, NOT be affected by later redirections on the outer command
    if (result.stderr) {
      ctx.state.expansionStderr =
        (ctx.state.expansionStderr || "") + result.stderr;
    }
    return finishSubstitutionOutput(ctx, result.stdout);
  } catch (error) {
    // Restore environment on error as well
    restore();
    // ExecutionLimitError must always propagate - these are safety limits
    if (error instanceof ExecutionLimitError) {
      throw error;
    }
    if (error instanceof ExitError) {
      // Catch exit in command substitution - return output so far
      recordSubstitutionExit(ctx.state, error.exitCode);
      // Also forward stderr from the exit
      if (error.stderr) {
        ctx.state.expansionStderr =
          (ctx.state.expansionStderr || "") + error.stderr;
      }
      return finishSubstitutionOutput(ctx, error.stdout);
    }
    throw error;
  }
}

function finishSubstitutionOutput(
  ctx: InterpreterContext,
  stdout: string,
): string {
  const output = stdout.replace(/\n+$/, "");
  // Check string length limit for command substitution output
  if (output.length > ctx.limits.maxStringLength) {
    throw new ExecutionLimitError(
      `command substitution: string length limit exceeded (${ctx.limits.maxStringLength} bytes)`,
      "string_length",
    );
  }
  return output;
}

/**
 * Parse and run a command substitution that the parser kept as raw text
 * (arithmetic `$(...)`/backticks, array subscripts), against the current
 * interpreter state.
 */
export async function runCommandSubstitutionText(
  ctx: InterpreterContext,
  command: string,
): Promise<string> {
  const parser = new Parser();
  return await runCommandSubstitution(ctx, parser.parse(command));
}
