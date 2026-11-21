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
  appendFile: (path: string, content: string) => Promise<void>;
  /**
   * Flush buffered output for one file (already-resolved path), or for all
   * files when omitted. Optional: adapters without buffering may omit it.
   * Callers must flush before reading a file awk may have written to
   * (getline, input files, exit) so readers see already-printed output.
   * Flush all when the read name might be a symlink alias of an output
   * file: a single-path flush cannot know which buffered entries share
   * the file.
   */
  flushOutput?: (path?: string) => Promise<void>;
  resolvePath: (cwd: string, path: string) => string;
}
