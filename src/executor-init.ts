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
  const { graphqlPlugin } = await import("@executor-js/plugin-graphql");
  const { openApiPlugin } = await import("@executor-js/plugin-openapi");
  const { mcpPlugin } = await import("@executor-js/plugin-mcp");

  // Always include discovery (custom sources), graphql, openapi, and mcp plugins.
  // User-provided plugins are appended after.
  const allPlugins = [
    discoveryPlugin(),
    graphqlPlugin(),
    openApiPlugin(),
    mcpPlugin(),
    ...(plugins ?? []),
  ];

  const executor = await createExecutor({
    plugins: allPlugins,
  });

  // Build an ExecutorSDKHandle that merges the official SDK's tools/sources
  // with the discovery plugin's sources.add() extension.
  // biome-ignore lint/suspicious/noExplicitAny: executor extensions are typed per-plugin; we access them dynamically
  const ext = executor as any;

  const discoveryExt = ext.justBashDiscovery as {
    sources: { add: (def: Record<string, unknown>) => Promise<void> };
  };
  const graphqlExt = ext.graphql as {
    addSource: (config: {
      endpoint: string;
      namespace?: string;
      headers?: Record<string, unknown>;
      introspectionJson?: string;
    }) => Promise<{ toolCount: number }>;
  };
  const openapiExt = ext.openapi as {
    addSpec: (config: {
      spec: string;
      baseUrl?: string;
      namespace?: string;
      headers?: Record<string, unknown>;
    }) => Promise<{ toolCount: number }>;
  };
  const mcpExt = ext.mcp as {
    addSource: (config: {
      transport: string;
      name: string;
      endpoint?: string;
      command?: string;
      args?: string[];
      env?: Record<string, string>;
      cwd?: string;
      namespace?: string;
      headers?: Record<string, string>;
      remoteTransport?: string;
      queryParams?: Record<string, string>;
    }) => Promise<{ toolCount: number; namespace: string }>;
  };

  /**
   * Route sources.add() calls to the appropriate plugin based on `kind`.
   * - "custom": discovery plugin (inline tool definitions)
   * - "graphql": @executor-js/plugin-graphql (introspects schema)
   * - "openapi": @executor-js/plugin-openapi (parses spec)
   * - "mcp": @executor-js/plugin-mcp (connects to MCP server)
   */
  const addSource = async (def: Record<string, unknown>): Promise<void> => {
    const kind = def.kind as string;
    if (kind === "graphql") {
      await graphqlExt.addSource({
        endpoint: def.endpoint as string,
        namespace: (def.name as string) ?? undefined,
        headers: def.headers as Record<string, unknown> | undefined,
        introspectionJson: def.introspectionJson as string | undefined,
      });
    } else if (kind === "openapi") {
      await openapiExt.addSpec({
        spec: def.spec as string,
        baseUrl: (def.endpoint ?? def.baseUrl) as string | undefined,
        namespace: (def.name as string) ?? undefined,
        headers: def.headers as Record<string, unknown> | undefined,
      });
    } else if (kind === "mcp") {
      const transport = (def.transport as string) ?? "remote";
      if (transport === "stdio") {
        await mcpExt.addSource({
          transport: "stdio",
          name: def.name as string,
          command: def.command as string,
          args: def.args as string[] | undefined,
          env: def.env as Record<string, string> | undefined,
          cwd: def.cwd as string | undefined,
          namespace: (def.name as string) ?? undefined,
        });
      } else {
        await mcpExt.addSource({
          transport: "remote",
          name: def.name as string,
          endpoint: def.endpoint as string,
          namespace: (def.name as string) ?? undefined,
          headers: def.headers as Record<string, string> | undefined,
          remoteTransport: def.remoteTransport as string | undefined,
          queryParams: def.queryParams as Record<string, string> | undefined,
        });
      }
    } else {
      // "custom" and any unknown kinds fall through to the discovery plugin
      await discoveryExt.sources.add(def);
    }
  };

  const sdkHandle: ExecutorSDKHandle = {
    tools: {
      list: executor.tools.list,
      invoke: executor.tools.invoke,
    },
    sources: {
      add: addSource,
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
