/**
 * export - Set environment variables builtin
 */

import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

export function handleExport(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  for (const arg of args) {
    if (arg.includes("=")) {
      const [name, ...rest] = arg.split("=");
      ctx.state.env[name] = rest.join("=");
    }
  }
  return { stdout: "", stderr: "", exitCode: 0 };
}
