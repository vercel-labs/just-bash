/**
 * File reading utilities for command implementations.
 *
 * Provides common patterns for reading from files or stdin.
 */

import type { CommandContext, ExecResult } from "../types.js";

export interface ReadFilesOptions {
  /** Command name for error messages */
  cmdName: string;
  /** If true, "-" in file list means stdin */
  allowStdinMarker?: boolean;
  /** If true, stop on first error. If false, collect errors and continue */
  stopOnError?: boolean;
}

export interface FileContent {
  /** File name (or "-" for stdin, or "" if stdin with no files) */
  filename: string;
  /** File content */
  content: string;
}

export interface ReadFilesResult {
  /** Successfully read files */
  files: FileContent[];
  /** Error messages (e.g., "cmd: file: No such file or directory\n") */
  stderr: string;
  /** 0 if all files read successfully, 1 if any errors */
  exitCode: number;
}

/**
 * Read content from files or stdin.
 *
 * If files array is empty, reads from stdin.
 * If files contains "-", reads stdin at that position.
 *
 * @example
 * const result = await readFiles(ctx, files, { cmdName: "cat" });
 * if (result.exitCode !== 0 && options.stopOnError) {
 *   return { stdout: "", stderr: result.stderr, exitCode: result.exitCode };
 * }
 * for (const { filename, content } of result.files) {
 *   // process content
 * }
 */
export async function readFiles(
  ctx: CommandContext,
  files: string[],
  options: ReadFilesOptions,
): Promise<ReadFilesResult> {
  const { cmdName, allowStdinMarker = true, stopOnError = false } = options;

  // No files - read from stdin
  if (files.length === 0) {
    return {
      files: [{ filename: "", content: ctx.stdin }],
      stderr: "",
      exitCode: 0,
    };
  }

  const result: FileContent[] = [];
  let stderr = "";
  let exitCode = 0;

  for (const file of files) {
    if (allowStdinMarker && file === "-") {
      result.push({ filename: "-", content: ctx.stdin });
      continue;
    }

    try {
      const filePath = ctx.fs.resolvePath(ctx.cwd, file);
      const content = await ctx.fs.readFile(filePath);
      result.push({ filename: file, content });
    } catch {
      stderr += `${cmdName}: ${file}: No such file or directory\n`;
      exitCode = 1;
      if (stopOnError) {
        return { files: result, stderr, exitCode };
      }
    }
  }

  return { files: result, stderr, exitCode };
}

/**
 * Read and concatenate all files into a single string.
 *
 * Useful for commands like sort and uniq that process all input together.
 *
 * @example
 * const result = await readAndConcat(ctx, files, { cmdName: "sort" });
 * if (!result.ok) return result.error;
 * const lines = result.content.split("\n");
 */
export async function readAndConcat(
  ctx: CommandContext,
  files: string[],
  options: { cmdName: string; allowStdinMarker?: boolean },
): Promise<{ ok: true; content: string } | { ok: false; error: ExecResult }> {
  const result = await readFiles(ctx, files, {
    ...options,
    stopOnError: true,
  });

  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: { stdout: "", stderr: result.stderr, exitCode: result.exitCode },
    };
  }

  const content = result.files.map((f) => f.content).join("");
  return { ok: true, content };
}
