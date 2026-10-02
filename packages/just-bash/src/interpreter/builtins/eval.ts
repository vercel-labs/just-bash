/**
 * eval - Execute arguments as a shell command
 *
 * Concatenates all arguments and executes them as a shell command
 * in the current environment (variables persist after eval).
 */

import { type ParseException, parse } from "../../parser/parser.js";
import type { ExecResult } from "../../types.js";
import {
  BreakError,
  ContinueError,
  ExitError,
  ReturnError,
} from "../errors.js";
import { failure, OK } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export async function handleEval(
  ctx: InterpreterContext,
  args: string[],
  stdin?: string,
  /**
   * A redirection gave this `eval` its own fd 0. Empty content is still
   * ownership: `eval '…' < empty-file` means EOF inside, where an
   * unredirected `eval` shares the shell's stdin.
   */
  stdinRedirected = false,
  /** The fd 0 this `eval` was given is closed (`eval '…' 0<&-`). */
  stdinClosed = false,
): Promise<ExecResult> {
  // Handle options like bash does:
  // -- ends option processing
  // - alone is a plain argument
  // -x (any other option) is invalid
  let evalArgs = args;
  if (evalArgs.length > 0) {
    const first = evalArgs[0];
    if (first === "--") {
      evalArgs = evalArgs.slice(1);
    } else if (first.startsWith("-") && first !== "-" && first.length > 1) {
      // Invalid option like -z, -x, etc.
      return failure(
        `bash: eval: ${first}: invalid option\neval: usage: eval [arg ...]\n`,
        2,
      );
    }
  }

  if (evalArgs.length === 0) {
    return OK;
  }

  // Concatenate all arguments with spaces (like bash does)
  const command = evalArgs.join(" ");

  if (command.trim() === "") {
    return OK;
  }

  // `eval` runs in the current shell, so it restores only the stdin it
  // actually replaced. A pipeline or a redirection gives it its own fd 0
  // (`printf … | eval '…'`, `eval '…' < file`) and that has to be undone
  // afterwards. Without one, eval shares the shell's fd 0: reads inside it
  // move the one shared position, so `{ eval 'read a'; read b; }` must give
  // `b` the second line rather than replay the first.
  const savedGroupStdin = ctx.state.groupStdin;
  const savedGroupStdinClosed = ctx.state.groupStdinClosed;
  const ownsStdin = stdinRedirected || (stdin !== undefined && stdin !== "");
  if (ownsStdin) {
    ctx.state.groupStdin = stdin ?? "";
    ctx.state.groupStdinClosed = !stdin && stdinClosed;
  }

  try {
    // Parse and execute in the current environment
    const ast = parse(command);
    return await ctx.executeScript(ast);
  } catch (error) {
    // Rethrow control flow errors so they propagate to outer loops/functions
    if (
      error instanceof BreakError ||
      error instanceof ContinueError ||
      error instanceof ReturnError ||
      error instanceof ExitError
    ) {
      throw error;
    }
    if ((error as ParseException).name === "ParseException") {
      return failure(`bash: eval: ${(error as Error).message}\n`);
    }
    throw error;
  } finally {
    // Same rule as command groups: hand the shared position back untouched
    // only when eval owned fd 0. `undefined` is not a read position, so a body
    // that cleared shared stdin it does not own (pipeline stages on main, see
    // #328) gets the inherited position restored rather than propagated.
    if (
      ownsStdin ||
      (savedGroupStdin !== undefined && ctx.state.groupStdin === undefined)
    ) {
      ctx.state.groupStdin = savedGroupStdin;
      ctx.state.groupStdinClosed = savedGroupStdinClosed;
    }
  }
}
