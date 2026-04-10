/**
 * Adapter for using js-exec as a CodeExecutor runtime for @executor-js/sdk.
 *
 * This module exports a Promise-based executor that can be wrapped with
 * Effect.tryPromise() to satisfy the CodeExecutor interface.
 *
 * Usage with @executor-js/sdk:
 *
 * ```ts
 * import { createJustBashCodeExecutor } from 'just-bash/executor';
 * import { createExecutor } from '@executor-js/sdk';
 * import type { CodeExecutor } from '@executor-js/sdk';
 * import * as Effect from 'effect/Effect';
 *
 * const jb = createJustBashCodeExecutor();
 *
 * const codeExecutor: CodeExecutor = {
 *   execute: (code, toolInvoker) =>
 *     Effect.tryPromise(() =>
 *       jb.execute(code, (path, args) =>
 *         Effect.runPromise(toolInvoker.invoke({ path, args }))
 *       )
 *     ),
 * };
 *
 * const executor = await createExecutor({
 *   runtime: codeExecutor,
 *   tools: { ... },
 * });
 * ```
 */

import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "../../fs/interface.js";
import { resolveLimits } from "../../limits.js";
import type { SecureFetch } from "../../network/index.js";
import type { CommandContext } from "../../types.js";
import { type ExecutorResult, executeForExecutor } from "./js-exec.js";

export interface JustBashExecutorOptions {
  /** Virtual filesystem for code to access. Defaults to an empty InMemoryFs. */
  fs?: IFileSystem;
  /** Working directory inside the sandbox. Defaults to /home/user. */
  cwd?: string;
  /** Environment variables available to code. Defaults to empty. */
  env?: Record<string, string>;
  /** Network fetch function. Defaults to undefined (no network). */
  fetch?: SecureFetch;
}

export interface JustBashCodeExecutor {
  /**
   * Execute code with tool invocation support.
   *
   * @param code - JavaScript code to execute. Can use `await` and `return`.
   *   Tools are available as `tools.namespace.method(args)`.
   * @param invokeTool - Callback to handle tool invocations.
   *   Receives (path, args) and should return the tool result.
   * @returns ExecutorResult with result, error, and captured logs.
   */
  execute(
    code: string,
    invokeTool: (path: string, args: unknown) => Promise<unknown>,
  ): Promise<ExecutorResult>;
}

/**
 * Create a js-exec based code executor for use with @executor-js/sdk.
 *
 * The executor runs JavaScript code in a QuickJS sandbox with:
 * - A `tools` proxy for invoking registered tools
 * - Console output captured to `logs` array
 * - Return value captured in `result`
 * - Full Node.js-compatible module system (fs, path, etc.)
 */
export function createJustBashCodeExecutor(
  options?: JustBashExecutorOptions,
): JustBashCodeExecutor {
  const fs = options?.fs ?? new InMemoryFs();
  const cwd = options?.cwd ?? "/home/user";
  const env = options?.env ?? (Object.create(null) as Record<string, string>);
  const fetch = options?.fetch;

  return {
    async execute(
      code: string,
      invokeTool: (path: string, args: unknown) => Promise<unknown>,
    ): Promise<ExecutorResult> {
      const envMap = new Map<string, string>();
      for (const [k, v] of Object.entries(env)) {
        envMap.set(k, v);
      }

      const ctx: CommandContext = {
        fs,
        cwd,
        env: envMap,
        stdin: "",
        fetch,
        limits: resolveLimits(),
      };

      // Bridge between the Promise-based invokeTool and the JSON-string protocol
      const invokeToolBridge = async (
        path: string,
        argsJson: string,
      ): Promise<string> => {
        let args: unknown;
        try {
          args = argsJson ? JSON.parse(argsJson) : undefined;
        } catch {
          args = undefined;
        }
        const result = await invokeTool(path, args);
        return result !== undefined ? JSON.stringify(result) : "";
      };

      return executeForExecutor(code, ctx, invokeToolBridge);
    },
  };
}
