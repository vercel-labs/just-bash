/**
 * eval - Execute arguments as a shell command
 *
 * Concatenates all arguments and executes them as a shell command
 * in the current environment (variables persist after eval).
 */

import { type ParseException, parse } from "../../parser/parser.js";
import type { ExecResult } from "../../types.js";
import { BreakError, ContinueError, ExitError, ReturnError } from "../errors.js";
import type { InterpreterContext } from "../types.js";

export async function handleEval(
  ctx: InterpreterContext,
  args: string[],
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
      return {
        stdout: "",
        stderr: `bash: eval: ${first}: invalid option\neval: usage: eval [arg ...]\n`,
        exitCode: 2,
      };
    }
  }

  if (evalArgs.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // Concatenate all arguments with spaces (like bash does)
  const command = evalArgs.join(" ");

  if (command.trim() === "") {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  try {
    // Parse and execute in the current environment
    const ast = parse(command);
    return ctx.executeScript(ast);
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
      return {
        stdout: "",
        stderr: `bash: eval: ${(error as Error).message}\n`,
        exitCode: 1, // bash returns 1 for syntax errors in eval
      };
    }
    throw error;
  }
}
