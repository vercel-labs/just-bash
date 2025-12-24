/**
 * Built-in Command Handlers
 *
 * Shell built-in commands that modify interpreter state:
 * - cd: Change directory
 * - export: Set environment variables
 * - unset: Remove variables/functions
 * - exit: Exit shell
 * - local: Declare local variables in functions
 */

import type { ExecResult } from "../types.js";
import type { InterpreterContext } from "./types.js";

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

export function handleUnset(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  for (const arg of args) {
    delete ctx.state.env[arg];
    ctx.state.functions.delete(arg);
  }
  return { stdout: "", stderr: "", exitCode: 0 };
}

export function handleExit(
  _ctx: InterpreterContext,
  args: string[],
): ExecResult {
  const code = args.length > 0 ? Number.parseInt(args[0], 10) || 0 : 0;
  return { stdout: "", stderr: "", exitCode: code };
}

export function handleLocal(
  ctx: InterpreterContext,
  args: string[],
): ExecResult {
  if (ctx.state.localScopes.length === 0) {
    return {
      stdout: "",
      stderr: "bash: local: can only be used in a function\n",
      exitCode: 1,
    };
  }

  const currentScope = ctx.state.localScopes[ctx.state.localScopes.length - 1];

  for (const arg of args) {
    if (arg.includes("=")) {
      const [name, ...rest] = arg.split("=");
      if (!currentScope.has(name)) {
        currentScope.set(name, ctx.state.env[name]);
      }
      ctx.state.env[name] = rest.join("=");
    } else {
      if (!currentScope.has(arg)) {
        currentScope.set(arg, ctx.state.env[arg]);
      }
    }
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}
