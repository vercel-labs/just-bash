/**
 * Executor SDK lazy initialization.
 * Separated from Bash.ts so the browser bundle never sees these imports.
 * Only loaded at runtime behind a dynamic import.
 */

import {
  type ExecutorConfig,
  type ExecutorSDKHandle,
  parseToolArgs,
} from "./Bash.js";
import { resolveLimits } from "./limits.js";

/** Default elicitation handler: decline all requests (safe default). */
const DECLINE_ALL_ELICITATIONS = async () => ({ action: "decline" as const });

export async function initExecutorSDK(
  setup: (sdk: ExecutorSDKHandle) => Promise<void>,
  approval: ExecutorConfig["onToolApproval"] | undefined,
  elicitation: ExecutorConfig["onElicitation"] | undefined,
  plugins: ExecutorConfig["plugins"] | undefined,
  fs: import("./fs/interface.js").IFileSystem,
  getCwd: () => string,
  getEnv: () => Map<string, string>,
  getLimits: () => import("./limits.js").ExecutionLimits | undefined,
): Promise<{
  sdk: ExecutorSDKHandle;
  /**
   * Execute code through the SDK pipeline.
   * Lists tools from the SDK and creates a tool invoker that routes
   * tool calls through the SDK's invoke() method, then runs the code
   * in QuickJS with the tools proxy.
   */
  executeViaSdk: (code: string) => Promise<{
    result: unknown;
    error?: string;
    logs?: string[];
  }>;
}> {
  const { createExecutor } = await import("@executor-js/sdk");
  const { executeForExecutor } = await import("./commands/js-exec/js-exec.js");
  const { discoveryPlugin } = await import("./executor-discovery-plugin.js");

  // Always include the discovery plugin for sources.add() support.
  // User-provided plugins are appended after.
  const allPlugins = [discoveryPlugin(), ...(plugins ?? [])];

  const executor = await createExecutor({
    plugins: allPlugins,
  });

  // Build an ExecutorSDKHandle that merges the official SDK's tools/sources
  // with the discovery plugin's sources.add() extension.
  // biome-ignore lint/suspicious/noExplicitAny: executor extensions are typed per-plugin; we access justBashDiscovery dynamically
  const discoveryExt = (executor as any).justBashDiscovery as {
    sources: { add: (def: Record<string, unknown>) => Promise<void> };
  };

  const sdkHandle: ExecutorSDKHandle = {
    tools: {
      list: executor.tools.list,
      invoke: executor.tools.invoke,
    },
    sources: {
      add: discoveryExt.sources.add,
      list: executor.sources.list,
    },
    close: executor.close,
  };

  if (setup) {
    await setup(sdkHandle);
  }

  // Build the execution bridge: route tool calls through the SDK's invoke().
  const executeViaSdk = async (
    code: string,
  ): Promise<{ result: unknown; error?: string; logs?: string[] }> => {
    const ctx = {
      fs,
      cwd: getCwd(),
      env: getEnv(),
      stdin: "",
      limits: resolveLimits(getLimits()),
    };

    // Bridge: convert tool paths from the QuickJS tools proxy to SDK invoke() calls.
    const invokeTool = async (
      path: string,
      argsJson: string,
    ): Promise<string> => {
      const args = parseToolArgs(argsJson);

      // Check tool approval before invoking
      if (approval && approval !== "allow-all") {
        if (approval === "deny-all") {
          throw new Error(`Tool invocation denied: ${path}`);
        }
        // Look up tool metadata for the approval callback
        const allTools = await executor.tools.list();
        const toolMeta = allTools.find((t: { id: string }) => t.id === path) as
          | { id: string; sourceId: string; name: string }
          | undefined;
        const decision = await approval({
          toolPath: path,
          sourceId: toolMeta?.sourceId ?? "unknown",
          sourceName: toolMeta?.sourceId ?? "unknown",
          operationKind: "unknown",
          args,
          reason: `Tool ${path} invoked from js-exec`,
          approvalLabel: null,
        });
        if (!decision.approved) {
          throw new Error(
            `Tool invocation denied: ${path}${decision.reason ? ` (${decision.reason})` : ""}`,
          );
        }
      }

      // Route through SDK's tool invocation pipeline.
      // Default to declining elicitation requests (safe default).
      const elicitationHandler = elicitation ?? DECLINE_ALL_ELICITATIONS;
      const result = await executor.tools.invoke(path, args, {
        onElicitation: elicitationHandler,
      });

      return result.data !== undefined ? JSON.stringify(result.data) : "";
    };

    return executeForExecutor(code, ctx, invokeTool);
  };

  return { sdk: sdkHandle, executeViaSdk };
}
