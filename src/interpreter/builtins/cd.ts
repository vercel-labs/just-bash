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

  // Check path components before normalization to catch cases like "nonexistent/.."
  // where the intermediate directory doesn't exist
  const pathToCheck = target.startsWith("/")
    ? target
    : `${ctx.state.cwd}/${target}`;
  const parts = pathToCheck.split("/").filter((p) => p && p !== ".");
  let currentPath = "";
  for (const part of parts) {
    if (part === "..") {
      // Go up one level
      currentPath = currentPath.split("/").slice(0, -1).join("/") || "/";
    } else {
      currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
      try {
        const stat = await ctx.fs.stat(currentPath);
        if (!stat.isDirectory) {
          return {
            stdout: "",
            stderr: `bash: cd: ${target}: Not a directory\n`,
            exitCode: 1,
          };
        }
      } catch {
        return {
          stdout: "",
          stderr: `bash: cd: ${target}: No such file or directory\n`,
          exitCode: 1,
        };
      }
    }
  }

  const newDir = currentPath || "/";

  ctx.state.previousDir = ctx.state.cwd;
  ctx.state.cwd = newDir;
  ctx.state.env.PWD = ctx.state.cwd;
  ctx.state.env.OLDPWD = ctx.state.previousDir;

  return { stdout: "", stderr: "", exitCode: 0 };
}
