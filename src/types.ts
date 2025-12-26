import type { IFileSystem } from "./fs-interface.js";
import type { SecureFetch } from "./network/index.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** The final environment variables after execution (only set by BashEnv.exec) */
  env?: Record<string, string>;
}

/** Result from BashEnv.exec() - always includes env */
export interface BashExecResult extends ExecResult {
  env: Record<string, string>;
}

/** Options for exec calls within commands */
export interface CommandExecOptions {
  /** Environment variables to merge into the exec state */
  env?: Record<string, string>;
  /** Working directory for the exec */
  cwd?: string;
}

/**
 * Context provided to commands during execution.
 *
 * ## Field Availability
 *
 * **Always available (core fields):**
 * - `fs`, `cwd`, `env`, `stdin`
 *
 * **Available when running via BashEnv interpreter:**
 * - `exec` - For commands like `xargs`, `bash -c` that need to run subcommands
 * - `getRegisteredCommands` - For the `help` command to list available commands
 *
 * **Conditionally available based on configuration:**
 * - `fetch` - Only when `network` option is configured in BashEnv
 * - `sleep` - Only when a custom sleep function is provided (e.g., for testing)
 */
export interface CommandContext {
  /** Virtual filesystem interface for file operations */
  fs: IFileSystem;
  /** Current working directory */
  cwd: string;
  /** Environment variables */
  env: Record<string, string>;
  /** Standard input content */
  stdin: string;
  /**
   * Execute a subcommand (e.g., for `xargs`, `bash -c`).
   * Available when running commands via BashEnv interpreter.
   */
  exec?: (command: string, options?: CommandExecOptions) => Promise<ExecResult>;
  /**
   * Secure fetch function for network requests (e.g., for `curl`).
   * Only available when `network` option is configured in BashEnv.
   */
  fetch?: SecureFetch;
  /**
   * Returns names of all registered commands.
   * Available when running commands via BashEnv interpreter.
   * Used by the `help` command.
   */
  getRegisteredCommands?: () => string[];
  /**
   * Custom sleep implementation.
   * If provided, used instead of real setTimeout.
   * Useful for testing with mock clocks.
   */
  sleep?: (ms: number) => Promise<void>;
}

export interface Command {
  name: string;
  execute(args: string[], ctx: CommandContext): Promise<ExecResult>;
}

export type CommandRegistry = Map<string, Command>;

// Re-export IFileSystem for convenience
export type { IFileSystem };
