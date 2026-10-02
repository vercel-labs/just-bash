/**
 * Custom Commands API
 *
 * Provides types and utilities for registering user-provided TypeScript commands.
 */

import { raceCancellation } from "./abort-signals.js";
import { type ByteString, EMPTY_BYTES } from "./encoding.js";
import { getFileSystemIdentity } from "./fs/identity.js";
import type { IFileSystem } from "./fs/interface.js";
import {
  type ExecutionLimitProfile,
  type ExecutionLimits,
  resolveLimits,
} from "./limits.js";
import { _promiseThen } from "./security/trusted-globals.js";
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
  const { executionLimits, executionLimitProfile, fs, stdin, ...overrides } =
    options;
  return {
    fs,
    fsIdentity: overrides.fsIdentity ?? getFileSystemIdentity(fs),
    cwd: "/",
    env: new Map(),
    stdin: stdin ?? EMPTY_BYTES,
    stdinConnected: stdin !== undefined,
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

/** A caller waiting for a shared lazy load to settle. */
type LoadWaiter = {
  resolve(command: Command): void;
  reject(error: unknown): void;
};

/**
 * Create a lazy-loaded wrapper for a custom command.
 * The command is only loaded when first executed.
 *
 * The load is shared, and waiters can detach from it. Both properties matter
 * once an invocation can be cancelled: a cancelled waiter must not start a
 * competing load, and it must not stay attached to a load that may never
 * settle. Keeping only the waiter's own promise lets a cancelled waiter be
 * collected instead of being retained by the shared load, so repeated
 * cancellations cannot accumulate.
 */
export function createLazyCustomCommand(lazy: LazyCommand): Command {
  let cached: Command | null = null;
  let loading = false;
  const waiters = new Set<LoadWaiter>();

  /** Publish a completed shared load to the invocations still waiting. */
  const succeed = (command: Command): void => {
    cached = command;
    for (const waiter of waiters) waiter.resolve(command);
    waiters.clear();
  };

  /**
   * Publish a failed shared load. The failure is consumed here, so it cannot
   * escape as an unhandled rejection, and it is not cached, so a later
   * invocation retries.
   */
  const fail = (error: unknown): void => {
    loading = false;
    for (const waiter of waiters) waiter.reject(error);
    waiters.clear();
  };

  const startLoading = (): void => {
    loading = true;
    let loaded: Promise<Command>;
    try {
      loaded = Promise.resolve(lazy.load());
    } catch (error) {
      // A host loader may throw before returning its promise. That is the same
      // failure transition as a rejected load: waiting callers are notified and
      // a later invocation retries.
      fail(error);
      return;
    }
    // This load outlives the invocation that started it, so its settlement must
    // not be tied to that invocation's security lifetime: callbacks registered
    // through the patched Promise.prototype.then are blocked once that execution
    // ends, which would strand the load and let its failure escape. Settling
    // through the intrinsic then also keeps the loader's own promise methods,
    // and anything they run, outside trusted code.
    _promiseThen.call(loaded, succeed, fail);
  };

  return {
    name: lazy.name,
    trusted: lazy.trusted !== false,
    async execute(
      args: string[],
      ctx: ResolvedCommandContext,
    ): Promise<ExecResult> {
      if (!cached) {
        // Subscribe before starting the shared load, so a loader that fails
        // immediately still reaches this invocation.
        let waiter: LoadWaiter | undefined;
        const loaded = new Promise<Command>((resolve, reject) => {
          waiter = { resolve, reject };
          waiters.add(waiter);
        });
        if (!loading) startLoading();
        try {
          cached = await raceCancellation(
            loaded,
            ctx.signal,
            `bash: ${lazy.name} was cancelled before it started\n`,
          );
        } finally {
          // A cancelled waiter no longer owns this load's outcome, and the
          // shared load must not keep it alive while it is still pending.
          if (waiter) waiters.delete(waiter);
        }
      }
      const command = cached;
      if (!command) throw new Error(`Failed to load command: ${lazy.name}`);
      return command.execute(args, ctx);
    },
  };
}
