/**
 * source/. - Execute commands from a file in current environment builtin
 */

import { type ParseException, parse } from "../../parser/parser.js";
import type { ExecResult } from "../../types.js";
import { ExecutionLimitError, ExitError, ReturnError } from "../errors.js";
import { failure, result } from "../helpers/result.js";
import type { InterpreterContext } from "../types.js";

export async function handleSource(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
  // Handle -- to end options (ignored like bash does)
  let sourceArgs = args;
  if (sourceArgs.length > 0 && sourceArgs[0] === "--") {
    sourceArgs = sourceArgs.slice(1);
  }

  if (sourceArgs.length === 0) {
    return result("", "bash: source: filename argument required\n", 2);
  }

  const filename = sourceArgs[0];
  let _resolvedPath: string | null = null;
  let content: string | null = null;

  // If filename contains '/', use it directly (relative or absolute path)
  if (filename.includes("/")) {
    const directPath = ctx.fs.resolvePath(ctx.state.cwd, filename);
    try {
      content = await ctx.fs.readFile(directPath);
      _resolvedPath = directPath;
    } catch {
      // File not found
    }
  } else {
    // Filename doesn't contain '/' - search in PATH first, then current directory
    const pathEnv = ctx.state.env.get("PATH") || "";
    const pathDirs = pathEnv.split(":").filter((d) => d);

    for (const dir of pathDirs) {
      const candidate = ctx.fs.resolvePath(ctx.state.cwd, `${dir}/${filename}`);
      try {
        // Check if it's a regular file (not a directory)
        const stat = await ctx.fs.stat(candidate);
        if (stat.isDirectory) {
          continue; // Skip directories
        }
        content = await ctx.fs.readFile(candidate);
        _resolvedPath = candidate;
        break;
      } catch {
        // File doesn't exist in this PATH directory, continue searching
      }
    }

    // If not found in PATH, try current directory
    if (content === null) {
      const directPath = ctx.fs.resolvePath(ctx.state.cwd, filename);
      try {
        content = await ctx.fs.readFile(directPath);
        _resolvedPath = directPath;
      } catch {
        // File not found
      }
    }
  }

  if (content === null) {
    return failure(`bash: ${filename}: No such file or directory\n`);
  }

  // Save and set positional parameters from additional args
  const savedPositional = new Map<string, string | undefined>();
  if (sourceArgs.length > 1) {
    const scriptArgs = sourceArgs.slice(1);
    const oldPositionalCount = Number.parseInt(
      ctx.state.env.get("#") ?? "0",
      10,
    );
    const positionalExtent = Math.max(scriptArgs.length, oldPositionalCount, 9);
    for (let i = 0; i < positionalExtent; i++) {
      const key = String(i + 1);
      savedPositional.set(key, ctx.state.env.get(key));
      if (i < scriptArgs.length) ctx.state.env.set(key, scriptArgs[i]);
      else ctx.state.env.delete(key);
    }
    savedPositional.set("#", ctx.state.env.get("#"));
    savedPositional.set("@", ctx.state.env.get("@"));
    ctx.state.env.set("#", String(scriptArgs.length));
    ctx.state.env.set("@", scriptArgs.join(" "));
  }

  // Save and restore current source context for BASH_SOURCE tracking
  const savedSource = ctx.state.currentSource;

  const cleanup = (): void => {
    ctx.state.sourceDepth--;
    ctx.state.currentSource = savedSource;
    // Restore positional parameters if we changed them
    if (sourceArgs.length > 1) {
      for (const [key, value] of savedPositional) {
        if (value === undefined) {
          ctx.state.env.delete(key);
        } else {
          ctx.state.env.set(key, value);
        }
      }
    }
  };

  ctx.state.sourceDepth++;
  if (ctx.state.sourceDepth > ctx.limits.maxSourceDepth) {
    ctx.state.sourceDepth--;
    throw new ExecutionLimitError(
      `source: maximum nesting depth (${ctx.limits.maxSourceDepth}) exceeded, increase executionLimits.maxSourceDepth`,
      "recursion",
    );
  }
  // Set current source to the file being sourced (for function definitions)
  ctx.state.currentSource = filename;
  try {
    const ast = parse(content);
    const result = await ctx.executeScript(ast);
    cleanup();
    return result;
  } catch (error) {
    cleanup();

    // ExitError propagates up to exit the shell
    if (error instanceof ExitError) {
      throw error;
    }

    // Handle return in sourced script - treat as normal exit
    if (error instanceof ReturnError) {
      return result(error.stdout, error.stderr, error.exitCode);
    }

    if ((error as ParseException).name === "ParseException") {
      return failure(`bash: ${filename}: ${(error as Error).message}\n`);
    }
    throw error;
  }
}
