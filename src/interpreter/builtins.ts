import type { IFileSystem } from "../fs.js";
import type { ExecResult } from "../types.js";

export interface BuiltinContext {
  /** Virtual filesystem */
  fs: IFileSystem;
  /** Current working directory */
  cwd: string;
  /** Set current working directory */
  setCwd: (cwd: string) => void;
  /** Previous directory for cd - */
  previousDir: string;
  /** Set previous directory */
  setPreviousDir: (dir: string) => void;
  /** Environment variables */
  env: Record<string, string>;
  /** Local variable scopes stack (for functions) */
  localScopes: Map<string, string | undefined>[];
  /** Resolve a path relative to cwd */
  resolvePath: (path: string) => string;
}

/**
 * Handle the cd builtin command
 */
export async function handleCd(
  args: string[],
  ctx: BuiltinContext,
): Promise<ExecResult> {
  const target = args[0] || ctx.env.HOME || "/";

  let newDir: string;
  if (target === "-") {
    newDir = ctx.previousDir;
  } else if (target === "~") {
    newDir = ctx.env.HOME || "/";
  } else {
    newDir = ctx.resolvePath(target);
  }

  try {
    const stat = await ctx.fs.stat(newDir);
    if (!stat.isDirectory) {
      return {
        stdout: "",
        stderr: `cd: ${target}: Not a directory\n`,
        exitCode: 1,
      };
    }
    ctx.setPreviousDir(ctx.cwd);
    ctx.setCwd(newDir);
    return { stdout: "", stderr: "", exitCode: 0 };
  } catch {
    return {
      stdout: "",
      stderr: `cd: ${target}: No such file or directory\n`,
      exitCode: 1,
    };
  }
}

/**
 * Handle the export builtin command
 */
export function handleExport(
  args: string[],
  env: Record<string, string>,
): ExecResult {
  for (const arg of args) {
    const eqIndex = arg.indexOf("=");
    if (eqIndex > 0) {
      const name = arg.slice(0, eqIndex);
      const value = arg.slice(eqIndex + 1);
      env[name] = value;
    }
  }
  return { stdout: "", stderr: "", exitCode: 0 };
}

/**
 * Handle the unset builtin command
 */
export function handleUnset(
  args: string[],
  env: Record<string, string>,
): ExecResult {
  for (const arg of args) {
    delete env[arg];
  }
  return { stdout: "", stderr: "", exitCode: 0 };
}

/**
 * Handle the local builtin command (for function-scoped variables)
 */
export function handleLocal(args: string[], ctx: BuiltinContext): ExecResult {
  // 'local' is only valid inside a function
  if (ctx.localScopes.length === 0) {
    return {
      stdout: "",
      stderr: "bash: local: can only be used in a function\n",
      exitCode: 1,
    };
  }

  const currentScope = ctx.localScopes[ctx.localScopes.length - 1];

  for (const arg of args) {
    const eqIndex = arg.indexOf("=");
    let varName: string;
    let value: string | undefined;

    if (eqIndex > 0) {
      varName = arg.slice(0, eqIndex);
      value = arg.slice(eqIndex + 1);
    } else {
      varName = arg;
      value = undefined;
    }

    // Save the original value (or undefined if it didn't exist)
    // Only save if we haven't already saved it in this scope
    if (!currentScope.has(varName)) {
      currentScope.set(varName, ctx.env[varName]);
    }

    // Set the new value
    if (value !== undefined) {
      ctx.env[varName] = value;
    } else if (!(varName in ctx.env)) {
      // If no value and variable doesn't exist, set to empty string
      ctx.env[varName] = "";
    }
  }

  return { stdout: "", stderr: "", exitCode: 0 };
}

/**
 * Handle the exit builtin command
 */
export function handleExit(args: string[]): ExecResult {
  const code = args[0] ? parseInt(args[0], 10) : 0;
  return {
    stdout: "",
    stderr: "",
    exitCode: Number.isNaN(code) ? 1 : code,
  };
}

/**
 * Handle variable assignment: VAR=value
 */
export function handleVariableAssignment(
  command: string,
  env: Record<string, string>,
): ExecResult | null {
  // Handle variable assignment: VAR=value (no args, command contains =)
  if (command.includes("=")) {
    const eqIndex = command.indexOf("=");
    const varName = command.slice(0, eqIndex);
    // Check if it's a valid variable name
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
      const value = command.slice(eqIndex + 1);
      env[varName] = value;
      return { stdout: "", stderr: "", exitCode: 0 };
    }
  }
  return null;
}
