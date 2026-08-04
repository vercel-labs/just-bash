/**
 * Custom Commands API
 *
 * Provides types and utilities for registering user-provided TypeScript commands.
 */

import { type ByteString, EMPTY_BYTES } from "./encoding.js";
import { getFileSystemIdentity } from "./fs/identity.js";
import type { IFileSystem } from "./fs/interface.js";
import {
  type ExecutionLimitProfile,
  type ExecutionLimits,
  resolveLimits,
} from "./limits.js";
import type {
  Command,
  CommandContext,
  ExecResult,
  ResolvedCommandContext,
  RuntimeCommandContext,
} from "./types.js";

/**
 * A custom command - either a Command object or a lazy loader.
 */
export type CustomCommand = Command | LazyCommand;

/**
 * Lazy-loaded custom command (for code-splitting).
 */
export interface LazyCommand {
  name: string;
  /**
   * Set false to run through the restricted extension boundary. Commands are
   * trusted by default for compatibility with existing host integrations.
   */
  trusted?: boolean;
  load: () => Promise<Command>;
}

/** Inputs for a complete standalone command context, primarily for tests. */
export interface CommandContextOptions
  extends Omit<Partial<CommandContext>, "fs" | "limits" | "stdin"> {
  fs: IFileSystem;
  stdin?: ByteString;
  executionLimits?: ExecutionLimits;
  executionLimitProfile?: ExecutionLimitProfile;
}

/**
 * Build the same resolved public context shape that the interpreter gives a
 * custom command. This avoids hand-maintained test objects drifting whenever
 * an internal execution limit is added.
 */
export function createCommandContext(
  options: CommandContextOptions,
): RuntimeCommandContext {
  const {
    executionLimits,
    executionLimitProfile,
    fs,
    stdin = EMPTY_BYTES,
    ...overrides
  } = options;
  return {
    fs,
    fsIdentity: overrides.fsIdentity ?? getFileSystemIdentity(fs),
    cwd: "/",
    env: new Map(),
    stdin,
    limits: resolveLimits(executionLimits, executionLimitProfile),
    ...overrides,
  };
}

/**
 * Type guard to check if a custom command is lazy-loaded.
 */
export function isLazyCommand(cmd: CustomCommand): cmd is LazyCommand {
  return "load" in cmd && typeof cmd.load === "function";
}

/**
 * Define a TypeScript command with type inference.
 * Convenience wrapper - you can also just use the Command interface directly.
 *
 * @example
 * ```ts
 * const hello = defineCommand("hello", async (args, ctx) => {
 *   const name = args[0] || "world";
 *   return { stdout: `Hello, ${name}!\n`, stderr: "", exitCode: 0 };
 * });
 *
 * const bash = new Bash({ customCommands: [hello] });
 * await bash.exec("hello Alice"); // "Hello, Alice!\n"
 * ```
 */
export function defineCommand(
  name: string,
  execute: (args: string[], ctx: ResolvedCommandContext) => Promise<ExecResult>,
  options: { trusted?: boolean } = {},
): Command {
  return { name, trusted: options.trusted !== false, execute };
}

/**
 * Create a lazy-loaded wrapper for a custom command.
 * The command is only loaded when first executed.
 */
export function createLazyCustomCommand(lazy: LazyCommand): Command {
  let cached: Command | null = null;
  let loading: Promise<Command> | null = null;
  return {
    name: lazy.name,
    trusted: lazy.trusted !== false,
    async execute(
      args: string[],
      ctx: ResolvedCommandContext,
    ): Promise<ExecResult> {
      if (!cached) {
        let currentLoading = loading;
        if (!currentLoading) {
          currentLoading = lazy.load().then((command) => {
            cached = command;
            return command;
          });
          loading = currentLoading;
        }
        try {
          cached = await currentLoading;
        } catch (error) {
          // A failed dynamic import may be transient. Permit a later explicit
          // invocation to retry while still single-flighting concurrent calls.
          if (loading === currentLoading) loading = null;
          throw error;
        }
      }
      const command = cached;
      if (!command) throw new Error(`Failed to load command: ${lazy.name}`);
      return command.execute(args, ctx);
    },
  };
}
