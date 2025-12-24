/**
 * exit - Exit shell builtin
 */

import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

export function handleExit(
  _ctx: InterpreterContext,
  args: string[],
): ExecResult {
  const code = args.length > 0 ? Number.parseInt(args[0], 10) || 0 : 0;
  return { stdout: "", stderr: "", exitCode: code };
}
