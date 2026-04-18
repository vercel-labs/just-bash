/**
 * cd - Change directory builtin
 */

import type { ExecResult } from "../../types.js";
import { failure, success } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export async function handleCd(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
  let target: string;
  let printPath = false;
  let physical = false;

  // Parse options
  let i = 0;
  while (i < args.length) {
    if (args[i] === "--") {
      // End of options
      i++;
      break;
    } else if (args[i] === "-L") {
      physical = false;
      i++;
    } else if (args[i] === "-P") {
      physical = true;
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
    target = ctx.state.env.get("HOME") || "/";
  } else if (remainingArgs[0] === "~") {
    target = ctx.state.env.get("HOME") || "/";
  } else if (remainingArgs[0] === "-") {
    target = ctx.state.previousDir;
    printPath = true; // cd - prints the new directory
  } else {
    target = remainingArgs[0];
  }

  // CDPATH support: if target doesn't start with / or ., search CDPATH directories
  // CDPATH is only used for relative paths that don't start with .
  if (
    !target.startsWith("/") &&
    !target.startsWith("./") &&
    !target.startsWith("../") &&
    target !== "." &&
    target !== ".."
  ) {
    const cdpath = ctx.state.env.get("CDPATH");
    if (cdpath) {
      const cdpathDirs = cdpath.split(":").filter((d) => d);
      for (const dir of cdpathDirs) {
        const candidate = dir.startsWith("/")
          ? `${dir}/${target}`
          : `${ctx.state.cwd}/${dir}/${target}`;
        try {
          const stat = await ctx.fs.stat(candidate);
          if (stat.isDirectory) {
            // Found in CDPATH - use this path and print it
            target = candidate;
            printPath = true;
            break;
          }
        } catch {
          // Directory doesn't exist in this CDPATH entry, continue
        }
      }
    }
  }

  // Walk the target path using bash's logical (-L) semantics:
  // - The current working directory is trusted and never stat'd, so `cd ..`
  //   still works when the cwd has been removed (e.g. `rm -rf` of $PWD).
  // - `..` pops the stack textually without touching the filesystem, matching
  //   real bash's behavior where $PWD anchors resolution.
  // - Only newly added components from the user-supplied target are stat'd,
  //   so `cd nonexistent/..` still errors the same way real bash does.
  const isAbsolute = target.startsWith("/");
  const stack: string[] = isAbsolute
    ? []
    : ctx.state.cwd.split("/").filter((p) => p);
  const inputParts = target.split("/").filter((p) => p && p !== ".");
  for (const part of inputParts) {
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
    const currentPath = `/${stack.join("/")}`;
    try {
      const stat = await ctx.fs.stat(currentPath);
      if (!stat.isDirectory) {
        return failure(`bash: cd: ${target}: Not a directory\n`);
      }
    } catch {
      return failure(`bash: cd: ${target}: No such file or directory\n`);
    }
  }

  let newDir = stack.length > 0 ? `/${stack.join("/")}` : "/";

  // If -P is specified, resolve symlinks to get the physical path
  if (physical) {
    try {
      newDir = await ctx.fs.realpath(newDir);
    } catch {
      // If realpath fails, use the logical path (matches bash behavior)
    }
  }

  ctx.state.previousDir = ctx.state.cwd;
  ctx.state.cwd = newDir;
  ctx.state.env.set("PWD", ctx.state.cwd);
  ctx.state.env.set("OLDPWD", ctx.state.previousDir);

  // cd - prints the new directory
  return success(printPath ? `${newDir}\n` : "");
}
