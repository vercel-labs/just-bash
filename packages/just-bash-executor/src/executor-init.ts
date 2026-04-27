/**
 * Lazy initialization of `@executor-js/sdk` plus the GraphQL / OpenAPI / MCP
 * plugins. Pulled into its own module so consumers who only use inline tools
 * never load these dependencies.
 */

import type { ExecutorConfig, ExecutorSDKHandle } from "./types.js";

export async function initExecutorSDK(
  setup: ((sdk: ExecutorSDKHandle) => Promise<void>) | undefined,
  plugins: ExecutorConfig["plugins"] | undefined,
): Promise<{
  sdk: ExecutorSDKHandle;
  // biome-ignore lint/suspicious/noExplicitAny: SDK executor object is plugin-typed; access is checked dynamically
  rawExecutor: any;
}> {
  const { createExecutor } = await import("@executor-js/sdk");
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

  const sdk: ExecutorSDKHandle = {
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
    await setup(sdk);
  }

  return { sdk, rawExecutor: executor };
}
