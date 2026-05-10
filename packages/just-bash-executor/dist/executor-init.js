/**
 * Lazy initialization of `@executor-js/sdk`.
 *
 * Kept in its own module so consumers who only use inline tools never load
 * the SDK or optional discovery plugins.
 */
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const DEFAULT_SCOPE_ID = "default-scope";
const DECLINE_ALL_ELICITATIONS = async () => ({
    action: "decline",
});
const EXECUTOR_API_PACKAGE = "@executor-js/api";
const transformedModuleCache = new Map();
const executorApiShimUrlCache = new Map();
// @executor-js 0.1.0 plugin core bundles import @executor-js/api for HTTP
// route helpers, but that package is not published. just-bash only needs the
// SDK plugin objects, so the fallback below loads those chunks with a tiny
// in-memory shim for the unused route helpers.
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
function isMissingExecutorApiError(error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes(EXECUTOR_API_PACKAGE);
}
async function importOfficialPluginExport(specifier, exportName) {
    try {
        const mod = (await import(specifier));
        return mod[exportName];
    }
    catch (error) {
        if (!isMissingExecutorApiError(error))
            throw error;
        const mod = await importOfficialPluginChunkWithoutApi(specifier);
        return mod[exportName];
    }
}
async function importOfficialPluginChunkWithoutApi(specifier) {
    const fromFile = fileURLToPath(import.meta.url);
    const corePath = await resolveExistingPath(await resolveModuleSpecifier(specifier, fromFile));
    const coreSource = await readFile(corePath, "utf8");
    const chunkMatch = coreSource.match(/from\s+["'](\.\/[^"']+\.js)["']/);
    if (!chunkMatch) {
        throw new Error(`Could not locate ${specifier} SDK bundle`);
    }
    const chunkPath = resolve(dirname(corePath), chunkMatch[1]);
    return importTransformedModule(chunkPath);
}
async function importTransformedModule(modulePath) {
    let pending = transformedModuleCache.get(modulePath);
    if (!pending) {
        pending = (async () => {
            const source = await readFile(modulePath, "utf8");
            const transformed = await rewriteModuleSpecifiers(source, modulePath);
            const url = `data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`;
            return (await import(url));
        })();
        transformedModuleCache.set(modulePath, pending);
    }
    return pending;
}
async function rewriteModuleSpecifiers(source, fromFile) {
    const specifiers = new Set();
    collectModuleSpecifiers(source, specifiers);
    const resolved = new Map();
    for (const specifier of specifiers) {
        if (specifier === EXECUTOR_API_PACKAGE) {
            resolved.set(specifier, await getExecutorApiShimUrl(fromFile));
            continue;
        }
        resolved.set(specifier, pathToFileURL(await resolveModuleSpecifier(specifier, fromFile)).href);
    }
    return source
        .replace(/\bfrom\s*(["'])([^"']+)\1/g, (_match, quote, specifier) => {
        return `from ${quote}${resolved.get(specifier) ?? specifier}${quote}`;
    })
        .replace(/\bimport\s*(["'])([^"']+)\1/g, (_match, quote, specifier) => {
        return `import ${quote}${resolved.get(specifier) ?? specifier}${quote}`;
    })
        .replace(/\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g, (_match, quote, specifier) => {
        return `import(${quote}${resolved.get(specifier) ?? specifier}${quote})`;
    });
}
function collectModuleSpecifiers(source, specifiers) {
    for (const regex of [
        /\bfrom\s*["']([^"']+)["']/g,
        /\bimport\s*["']([^"']+)["']/g,
        /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    ]) {
        for (const match of source.matchAll(regex)) {
            specifiers.add(match[1]);
        }
    }
}
async function getExecutorApiShimUrl(fromFile) {
    let pending = executorApiShimUrlCache.get(fromFile);
    if (!pending) {
        pending = (async () => {
            const effectUrl = pathToFileURL(await resolveModuleSpecifier("effect", fromFile)).href;
            const httpApiUrl = pathToFileURL(await resolveModuleSpecifier("effect/unstable/httpapi", fromFile)).href;
            const source = `
        import { Schema } from ${JSON.stringify(effectUrl)};
        import { HttpApi } from ${JSON.stringify(httpApiUrl)};

        export class InternalError extends Schema.TaggedErrorClass()(
          "InternalError",
          { message: Schema.String },
          { httpApiStatus: 500 },
        ) {}

        export function addGroup(group) {
          return HttpApi.make("executor").add(group);
        }

        export function capture(effect) {
          return effect;
        }
      `;
            return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
        })();
        executorApiShimUrlCache.set(fromFile, pending);
    }
    return pending;
}
async function resolveModuleSpecifier(specifier, fromFile) {
    if (specifier.startsWith("file:"))
        return fileURLToPath(specifier);
    if (specifier.startsWith("node:") || specifier.startsWith("data:")) {
        throw new Error(`Cannot rewrite non-file module specifier: ${specifier}`);
    }
    if (specifier.startsWith(".") || specifier.startsWith("/")) {
        const resolvedPath = specifier.startsWith("/")
            ? specifier
            : resolve(dirname(fromFile), specifier);
        return resolveExistingPath(resolvedPath);
    }
    const { packageName, subpath } = splitPackageSpecifier(specifier);
    const packageRoot = await findPackageRoot(packageName, fromFile);
    const packageJsonPath = join(packageRoot, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    const target = resolvePackageExport(packageJson, subpath);
    if (!target) {
        throw new Error(`Could not resolve ${specifier} from ${fromFile}`);
    }
    return resolveExistingPath(resolve(packageRoot, target));
}
function splitPackageSpecifier(specifier) {
    const parts = specifier.split("/");
    if (specifier.startsWith("@")) {
        return {
            packageName: parts.slice(0, 2).join("/"),
            subpath: parts.slice(2).join("/"),
        };
    }
    return {
        packageName: parts[0],
        subpath: parts.slice(1).join("/"),
    };
}
async function findPackageRoot(packageName, fromFile) {
    let current = dirname(fromFile);
    while (true) {
        const candidate = join(current, "node_modules", packageName);
        if (await pathExists(join(candidate, "package.json"))) {
            return candidate;
        }
        const parent = dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    throw new Error(`Cannot find package ${packageName} from ${fromFile}`);
}
async function pathExists(path) {
    try {
        await readFile(path);
        return true;
    }
    catch {
        return false;
    }
}
async function resolveExistingPath(path) {
    try {
        return await realpath(path);
    }
    catch {
        return path;
    }
}
function resolvePackageExport(packageJson, subpath) {
    const exportKey = subpath ? `./${subpath}` : ".";
    if (packageJson.exports !== undefined) {
        const entry = selectExportEntry(packageJson.exports, exportKey);
        const target = selectExportTarget(entry);
        if (target)
            return target;
        return undefined;
    }
    if (subpath)
        return subpath;
    return packageJson.module ?? packageJson.main ?? "index.js";
}
function selectExportEntry(exportsField, exportKey) {
    if (typeof exportsField === "string" ||
        Array.isArray(exportsField) ||
        exportsField === null) {
        return exportKey === "." ? exportsField : undefined;
    }
    if (typeof exportsField !== "object")
        return undefined;
    const map = exportsField;
    if (Object.hasOwn(map, exportKey))
        return map[exportKey];
    for (const [key, value] of Object.entries(map)) {
        if (!key.includes("*"))
            continue;
        const [prefix, suffix] = key.split("*");
        if (exportKey.startsWith(prefix) && exportKey.endsWith(suffix)) {
            const replacement = exportKey.slice(prefix.length, exportKey.length - suffix.length);
            return replaceExportTargetPattern(value, replacement);
        }
    }
    return undefined;
}
function replaceExportTargetPattern(entry, replacement) {
    if (typeof entry === "string")
        return entry.replaceAll("*", replacement);
    if (Array.isArray(entry)) {
        return entry.map((item) => replaceExportTargetPattern(item, replacement));
    }
    if (entry && typeof entry === "object") {
        return Object.fromEntries(Object.entries(entry).map(([key, value]) => [
            key,
            replaceExportTargetPattern(value, replacement),
        ]));
    }
    return entry;
}
function selectExportTarget(entry) {
    if (typeof entry === "string")
        return entry;
    if (Array.isArray(entry)) {
        for (const item of entry) {
            const target = selectExportTarget(item);
            if (target)
                return target;
        }
        return undefined;
    }
    if (!entry || typeof entry !== "object")
        return undefined;
    const conditions = entry;
    for (const key of ["import", "node", "default"]) {
        if (Object.hasOwn(conditions, key)) {
            const target = selectExportTarget(conditions[key]);
            if (target)
                return target;
        }
    }
    return undefined;
}
async function loadOfficialPlugins(kinds) {
    const plugins = [];
    if (kinds.has("graphql")) {
        try {
            const graphqlPlugin = await importOfficialPluginExport("@executor-js/plugin-graphql/core", "graphqlPlugin");
            plugins.push(graphqlPlugin());
        }
        catch (error) {
            throw pluginLoadError("GraphQL", error);
        }
    }
    if (kinds.has("openapi")) {
        try {
            const openApiPlugin = await importOfficialPluginExport("@executor-js/plugin-openapi/core", "openApiPlugin");
            plugins.push(openApiPlugin());
        }
        catch (error) {
            throw pluginLoadError("OpenAPI", error);
        }
    }
    if (kinds.has("mcp")) {
        try {
            const mcpPlugin = await importOfficialPluginExport("@executor-js/plugin-mcp/core", "mcpPlugin");
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
