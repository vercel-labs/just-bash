/**
 * cd - Change directory builtin
 */

import type { ExecResult } from "../../types.js";
import { failure, success } from "../helpers/index.js";
import type { InterpreterContext } from "../types.js";

export async function handleCd(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
  let target: string;
  let printPath = false;
  let _physical = false;

  // Parse options
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--") {
      // End of options
      i++;
      break;
    } else if (args[i] === "-L") {
      _physical = false;
      i++;
    } else if (args[i] === "-P") {
      _physical = true;
      i++;
    } else if (args[i].startsWith("-") && args[i] !== "-") {
      // Unknown option - ignore for now
      i++;
    } else {
      break;
    }
  }

  // Get the target directory
  const remainingArgs = args.slice(i);
  if (remainingArgs.length === 0) {
    target = ctx.state.env.HOME || "/";
  } else if (remainingArgs[0] === "~") {
    target = ctx.state.env.HOME || "/";
  } else if (remainingArgs[0] === "-") {
    target = ctx.state.previousDir;
    printPath = true; // cd - prints the new directory
  } else {
    target = remainingArgs[0];
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
          return failure(`bash: cd: ${target}: Not a directory\n`);
        }
      } catch {
        return failure(`bash: cd: ${target}: No such file or directory\n`);
      }
    }
  }

  const newDir = currentPath || "/";

  ctx.state.previousDir = ctx.state.cwd;
  ctx.state.cwd = newDir;
  ctx.state.env.PWD = ctx.state.cwd;
  ctx.state.env.OLDPWD = ctx.state.previousDir;

  // cd - prints the new directory
  return success(printPath ? `${newDir}\n` : "");
}
