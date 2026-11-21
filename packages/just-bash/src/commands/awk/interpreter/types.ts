/**
 * AWK Interpreter Types
 */

export type AwkValue = string | number;

/**
 * File system interface for AWK file operations
 */
export interface AwkFileSystem {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, content: string) => Promise<void>;
  /**
   * Append content to a file. `options.streamName` identifies the AWK
   * stream the write belongs to (the redirection name as written);
   * buffering and flushing are keyed by that name, not by the resolved
   * path, so `print > "f"` and `print > "./f"` are separate streams.
   * When `options.truncate` is set, the file is truncated first (the
   * `>` first-write) while the content itself is still buffered.
   * Defaults to the resolved path when no stream name is given.
   */
  appendFile: (
    path: string,
    content: string,
    options?: { streamName?: string; truncate?: boolean },
  ) => Promise<void>;
  /**
   * Flush buffered output for one AWK stream (the name as written), or
   * for all streams when omitted. Optional: adapters without buffering
   * may omit it. Callers must flush before reading a file awk may have
   * written to (getline, input files, exit) so readers see
   * already-printed output. Flush all when the read name might be a
   * symlink alias of an output file: a single-stream flush cannot know
   * which buffered entries share the file.
   */
  flushOutput?: (streamName?: string) => Promise<void>;
  resolvePath: (cwd: string, path: string) => string;
}
