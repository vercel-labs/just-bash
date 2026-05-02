/**
 * Lazy initialization of `@executor-js/sdk` plus the GraphQL / OpenAPI / MCP
 * plugins. Pulled into its own module so consumers who only use inline tools
 * never load these dependencies.
 */
export async function initExecutorSDK(setup, plugins) {
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
    const ext = executor;
    const discoveryExt = ext.justBashDiscovery;
    const graphqlExt = ext.graphql;
    const openapiExt = ext.openapi;
    const mcpExt = ext.mcp;
    /**
     * Route sources.add() calls to the appropriate plugin based on `kind`.
     * - "custom": discovery plugin (inline tool definitions)
     * - "graphql": @executor-js/plugin-graphql (introspects schema)
     * - "openapi": @executor-js/plugin-openapi (parses spec)
     * - "mcp": @executor-js/plugin-mcp (connects to MCP server)
     */
    const addSource = async (def) => {
        const kind = def.kind;
        if (kind === "graphql") {
            await graphqlExt.addSource({
                endpoint: def.endpoint,
                namespace: def.name ?? undefined,
                headers: def.headers,
                introspectionJson: def.introspectionJson,
            });
        }
        else if (kind === "openapi") {
            await openapiExt.addSpec({
                spec: def.spec,
                baseUrl: (def.endpoint ?? def.baseUrl),
                namespace: def.name ?? undefined,
                headers: def.headers,
            });
        }
        else if (kind === "mcp") {
            const transport = def.transport ?? "remote";
            if (transport === "stdio") {
                await mcpExt.addSource({
                    transport: "stdio",
                    name: def.name,
                    command: def.command,
                    args: def.args,
                    env: def.env,
                    cwd: def.cwd,
                    namespace: def.name ?? undefined,
                });
            }
            else {
                await mcpExt.addSource({
                    transport: "remote",
                    name: def.name,
                    endpoint: def.endpoint,
                    namespace: def.name ?? undefined,
                    headers: def.headers,
                    remoteTransport: def.remoteTransport,
                    queryParams: def.queryParams,
                });
            }
        }
        else {
            // "custom" and any unknown kinds fall through to the discovery plugin
            await discoveryExt.sources.add(def);
        }
    };
    const sdk = {
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
