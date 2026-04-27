/**
 * Lazy initialization of `@executor-js/sdk`.
 *
 * Kept in its own module so consumers who only use inline tools never load
 * the SDK or optional discovery plugins.
 */
const DEFAULT_SCOPE_ID = "default-scope";
const DECLINE_ALL_ELICITATIONS = async () => ({
    action: "decline",
});
function toSDKElicitationHandler(Effect, handler) {
    if (handler === "accept-all")
        return "accept-all";
    const publicHandler = handler ?? DECLINE_ALL_ELICITATIONS;
    return (ctx) => Effect.promise(async () => {
        const response = await publicHandler(ctx);
        return response;
    });
}
function getExtension(executor, key) {
    const extension = executor[key];
    if (!extension) {
        throw new Error(`Executor plugin not loaded: ${key}`);
    }
    return extension;
}
function pluginLoadError(kind, error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Error(`Failed to load @executor-js ${kind} plugin: ${message}`);
}
async function loadOfficialPlugins(kinds) {
    const plugins = [];
    if (kinds.has("graphql")) {
        try {
            const { graphqlPlugin } = await import("@executor-js/plugin-graphql/core");
            plugins.push(graphqlPlugin());
        }
        catch (error) {
            throw pluginLoadError("GraphQL", error);
        }
    }
    if (kinds.has("openapi")) {
        try {
            const { openApiPlugin } = await import("@executor-js/plugin-openapi/core");
            plugins.push(openApiPlugin());
        }
        catch (error) {
            throw pluginLoadError("OpenAPI", error);
        }
    }
    if (kinds.has("mcp")) {
        try {
            const { mcpPlugin } = await import("@executor-js/plugin-mcp/core");
            plugins.push(mcpPlugin());
        }
        catch (error) {
            throw pluginLoadError("MCP", error);
        }
    }
    return plugins;
}
export async function initExecutorSDK(setup, plugins, onElicitation) {
    const queuedSources = [];
    const setupRecorder = {
        tools: {
            list: async () => [],
            invoke: async () => {
                throw new Error("sdk.tools.invoke() is not available during executor setup");
            },
        },
        sources: {
            add: async (input) => {
                queuedSources.push(input);
            },
            list: async () => [],
        },
        close: async () => { },
    };
    if (setup) {
        await setup(setupRecorder);
    }
    const sourceKinds = new Set(queuedSources.map((source) => String(source.kind ?? "custom")));
    const { createExecutor } = await import("@executor-js/sdk");
    const { Effect } = await import("@executor-js/sdk/core");
    const { discoveryPlugin } = await import("./executor-discovery-plugin.js");
    const officialPlugins = await loadOfficialPlugins(sourceKinds);
    const allPlugins = [
        discoveryPlugin(),
        ...officialPlugins,
        ...(plugins ?? []),
    ];
    const createSDKExecutor = createExecutor;
    const executor = (await createSDKExecutor({
        plugins: allPlugins,
        onElicitation: toSDKElicitationHandler(Effect, onElicitation),
    }));
    const addSource = createAddSource(executor);
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
    for (const source of queuedSources) {
        await addSource(source);
    }
    return { sdk, rawExecutor: executor };
}
function createAddSource(executor) {
    const discoveryExt = getExtension(executor, "justBashDiscovery");
    return async (def) => {
        const kind = String(def.kind ?? "custom");
        if (kind === "graphql") {
            const graphqlExt = getExtension(executor, "graphql");
            await graphqlExt.addSource({
                endpoint: def.endpoint,
                scope: def.scope ?? DEFAULT_SCOPE_ID,
                name: def.name,
                namespace: def.name,
                headers: def.headers,
                queryParams: def.queryParams,
                introspectionJson: def.introspectionJson,
            });
            return;
        }
        if (kind === "openapi") {
            const openapiExt = getExtension(executor, "openapi");
            await openapiExt.addSpec({
                spec: def.spec,
                scope: def.scope ?? DEFAULT_SCOPE_ID,
                baseUrl: (def.endpoint ?? def.baseUrl),
                name: def.name,
                namespace: def.name,
                headers: def.headers,
                queryParams: def.queryParams,
            });
            return;
        }
        if (kind === "mcp") {
            const mcpExt = getExtension(executor, "mcp");
            const transport = def.transport ?? "remote";
            if (transport === "stdio") {
                await mcpExt.addSource({
                    transport: "stdio",
                    scope: def.scope ?? DEFAULT_SCOPE_ID,
                    name: def.name,
                    command: def.command,
                    args: def.args,
                    env: def.env,
                    cwd: def.cwd,
                    namespace: def.name,
                });
                return;
            }
            await mcpExt.addSource({
                transport: "remote",
                scope: def.scope ?? DEFAULT_SCOPE_ID,
                name: def.name,
                endpoint: def.endpoint,
                namespace: def.name,
                headers: def.headers,
                remoteTransport: def.remoteTransport,
                queryParams: def.queryParams,
            });
            return;
        }
        await discoveryExt.sources.add(def);
    };
}
