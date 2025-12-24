/**
 * cd - Change directory builtin
 */

import type { ExecResult } from "../../types.js";
import type { InterpreterContext } from "../types.js";

export async function handleCd(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
  let target: string;

  if (args.length === 0 || args[0] === "~") {
    target = ctx.state.env.HOME || "/";
  } else if (args[0] === "-") {
    target = ctx.state.previousDir;
  } else {
    target = args[0];
  }

  const newDir = ctx.fs.resolvePath(ctx.state.cwd, target);

  try {
    const statResult = await ctx.fs.stat(newDir);
    if (!statResult.isDirectory) {
      return {
        stdout: "",
        stderr: `bash: cd: ${target}: Not a directory\n`,
        exitCode: 1,
      };
    }
  } catch {
    if (newDir !== "/") {
      return {
        stdout: "",
        stderr: `bash: cd: ${target}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  }

  ctx.state.previousDir = ctx.state.cwd;
  ctx.state.cwd = newDir;
  ctx.state.env.PWD = ctx.state.cwd;
  ctx.state.env.OLDPWD = ctx.state.previousDir;

  return { stdout: "", stderr: "", exitCode: 0 };
}
