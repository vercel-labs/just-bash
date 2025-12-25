/**
 * eval - Execute arguments as a shell command
 *
 * Concatenates all arguments and executes them as a shell command
 * in the current environment (variables persist after eval).
 */

import { type ParseException, parse } from "../../parser/parser.js";
import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

export async function handleEval(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
  if (args.length === 0) {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  // Concatenate all arguments with spaces (like bash does)
  const command = args.join(" ");

  if (command.trim() === "") {
    return { stdout: "", stderr: "", exitCode: 0 };
  }

  try {
    // Parse and execute in the current environment
    const ast = parse(command);
    return ctx.executeScript(ast);
  } catch (error) {
    if ((error as ParseException).name === "ParseException") {
      return {
        stdout: "",
        stderr: `bash: eval: ${(error as Error).message}\n`,
        exitCode: 2,
      };
    }
    throw error;
  }
}
