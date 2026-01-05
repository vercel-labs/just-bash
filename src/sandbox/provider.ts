/**
 * Provider interface for sandbox implementations.
 * This allows swapping between just-bash (default) and @vercel/sandbox (fullVM).
 */

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface FileContent {
  content: string;
  encoding?: "utf-8" | "base64";
}

export type FileInput = string | FileContent;

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
}

/**
 * Common interface for sandbox providers.
 * Implemented by BashProvider (just-bash) and VercelProvider (@vercel/sandbox).
 */
export interface SandboxProvider {
  /**
   * Execute a command and return the result.
   */
  exec(cmd: string, opts?: ExecOptions): Promise<ExecResult>;

  /**
   * Write files to the sandbox filesystem.
   */
  writeFiles(files: Record<string, FileInput>): Promise<void>;

  /**
   * Read a file from the sandbox filesystem.
   */
  readFile(path: string, encoding?: "utf-8" | "base64"): Promise<string>;

  /**
   * Create a directory.
   */
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;

  /**
   * Stop/cleanup the sandbox (no-op for just-bash, required for VM).
   */
  stop(): Promise<void>;
}
