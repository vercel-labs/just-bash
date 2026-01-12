/**
 * Batched parallel file reading utility for commands that need to read
 * multiple files efficiently (jq, yq, xan cat, etc.)
 *
 * Uses Promise.all with configurable batch size to parallelize reads
 * while avoiding overwhelming the filesystem.
 */

import type { CommandContext, ExecResult } from "../types.js";

/** Default batch size for parallel file reads */
const DEFAULT_BATCH_SIZE = 100;

/** Result of reading a single file */
export interface FileReadResult {
  /** Original file path or "stdin" */
  source: string;
  /** File content (empty string if error) */
  content: string;
  /** Error path if read failed */
  error: string | null;
}

/** Options for batch reading */
export interface BatchReadOptions {
  /** Number of files to read in parallel (default: 100) */
  batchSize?: number;
  /** Command name for error messages (e.g., "jq", "xan cat") */
  cmdName?: string;
}

/**
 * Read multiple files in parallel batches.
 *
 * @param files Array of file paths to read (use "-" for stdin)
 * @param ctx Command context with filesystem access and stdin
 * @param options Batch size and error message configuration
 * @returns Object with results array and optional error result
 *
 * @example
 * const { results, error } = await batchReadFiles(files, ctx, { cmdName: "jq" });
 * if (error) return error;
 * for (const { source, content } of results) {
 *   // process content
 * }
 */
export async function batchReadFiles(
  files: string[],
  ctx: CommandContext,
  options: BatchReadOptions = {},
): Promise<{ results: FileReadResult[]; error?: ExecResult }> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const cmdName = options.cmdName ?? "command";
  const results: FileReadResult[] = [];

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (file): Promise<FileReadResult> => {
        if (file === "-") {
          return { source: "stdin", content: ctx.stdin, error: null };
        }
        try {
          const filePath = ctx.fs.resolvePath(ctx.cwd, file);
          const content = await ctx.fs.readFile(filePath);
          return { source: file, content, error: null };
        } catch {
          return { source: file, content: "", error: file };
        }
      }),
    );

    // Check for errors in this batch
    for (const r of batchResults) {
      if (r.error) {
        return {
          results: [],
          error: {
            stdout: "",
            stderr: `${cmdName}: ${r.error}: No such file or directory\n`,
            exitCode: 2,
          },
        };
      }
    }

    results.push(...batchResults);
  }

  return { results };
}

