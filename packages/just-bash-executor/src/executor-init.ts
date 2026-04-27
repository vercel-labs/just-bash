/**
 * Lazy initialization of `@executor-js/sdk`.
 *
 * Kept in its own module so consumers who only use inline tools never load
 * the SDK or optional discovery plugins.
 */

import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type {
  ExecutorConfig,
  ExecutorElicitationHandler,
  ExecutorElicitationResponse,
  ExecutorSDKHandle,
} from "./types.js";

const DEFAULT_SCOPE_ID = "default-scope";

type SDKExecutor = {
  tools: ExecutorSDKHandle["tools"];
  sources: {
    list: ExecutorSDKHandle["sources"]["list"];
  };
  close: ExecutorSDKHandle["close"];
} & Record<string, unknown>;

type SDKPlugin = unknown;
type ModuleNamespace = Record<string, unknown>;

type SDKEffect = {
  promise: <A>(evaluate: () => Promise<A>) => unknown;
};

type SDKElicitationHandler = "accept-all" | ((ctx: unknown) => unknown);

const DECLINE_ALL_ELICITATIONS: ExecutorElicitationHandler = async () => ({
  action: "decline",
});
const EXECUTOR_API_PACKAGE = "@executor-js/api";
const transformedModuleCache = new Map<string, Promise<ModuleNamespace>>();
const executorApiShimUrlCache = new Map<string, Promise<string>>();

// @executor-js 0.1.0 plugin core bundles import @executor-js/api for HTTP
// route helpers, but that package is not published. just-bash only needs the
// SDK plugin objects, so the fallback below loads those chunks with a tiny
// in-memory shim for the unused route helpers.
function toSDKElicitationHandler(
  Effect: SDKEffect,
  handler: ExecutorElicitationHandler | "accept-all" | undefined,
): SDKElicitationHandler {
  if (handler === "accept-all") return "accept-all";
  const publicHandler = handler ?? DECLINE_ALL_ELICITATIONS;
  return (ctx: unknown) =>
    Effect.promise(async () => {
      const response = await publicHandler(
        ctx as Parameters<ExecutorElicitationHandler>[0],
      );
      return response satisfies ExecutorElicitationResponse;
    });
}

function getExtension<T>(executor: SDKExecutor, key: string): T {
  const extension = executor[key];
  if (!extension) {
    throw new Error(`Executor plugin not loaded: ${key}`);
  }
  return extension as T;
}

function pluginLoadError(kind: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Failed to load @executor-js ${kind} plugin: ${message}`);
}

function isMissingExecutorApiError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(EXECUTOR_API_PACKAGE);
}

async function importOfficialPluginExport<T>(
  specifier: string,
  exportName: string,
): Promise<T> {
  try {
    const mod = (await import(specifier)) as ModuleNamespace;
    return mod[exportName] as T;
  } catch (error) {
    if (!isMissingExecutorApiError(error)) throw error;
    const mod = await importOfficialPluginChunkWithoutApi(specifier);
    return mod[exportName] as T;
  }
}

async function importOfficialPluginChunkWithoutApi(
  specifier: string,
): Promise<ModuleNamespace> {
  const fromFile = fileURLToPath(import.meta.url);
  const corePath = await resolveExistingPath(
    await resolveModuleSpecifier(specifier, fromFile),
  );
  const coreSource = await readFile(corePath, "utf8");
  const chunkMatch = coreSource.match(/from\s+["'](\.\/[^"']+\.js)["']/);
  if (!chunkMatch) {
    throw new Error(`Could not locate ${specifier} SDK bundle`);
  }
  const chunkPath = resolve(dirname(corePath), chunkMatch[1]);
  return importTransformedModule(chunkPath);
}

async function importTransformedModule(
  modulePath: string,
): Promise<ModuleNamespace> {
  let pending = transformedModuleCache.get(modulePath);
  if (!pending) {
    pending = (async () => {
      const source = await readFile(modulePath, "utf8");
      const transformed = await rewriteModuleSpecifiers(source, modulePath);
      const url = `data:text/javascript;base64,${Buffer.from(transformed).toString("base64")}`;
      return (await import(url)) as ModuleNamespace;
    })();
    transformedModuleCache.set(modulePath, pending);
  }
  return pending;
}

async function rewriteModuleSpecifiers(
  source: string,
  fromFile: string,
): Promise<string> {
  const specifiers = new Set<string>();
  collectModuleSpecifiers(source, specifiers);

  const resolved = new Map<string, string>();
  for (const specifier of specifiers) {
    if (specifier === EXECUTOR_API_PACKAGE) {
      resolved.set(specifier, await getExecutorApiShimUrl(fromFile));
      continue;
    }
    resolved.set(
      specifier,
      pathToFileURL(await resolveModuleSpecifier(specifier, fromFile)).href,
    );
  }

  return source
    .replace(/\bfrom\s*(["'])([^"']+)\1/g, (_match, quote, specifier) => {
      return `from ${quote}${resolved.get(specifier) ?? specifier}${quote}`;
    })
    .replace(/\bimport\s*(["'])([^"']+)\1/g, (_match, quote, specifier) => {
      return `import ${quote}${resolved.get(specifier) ?? specifier}${quote}`;
    })
    .replace(
      /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/g,
      (_match, quote, specifier) => {
        return `import(${quote}${resolved.get(specifier) ?? specifier}${quote})`;
      },
    );
}

function collectModuleSpecifiers(
  source: string,
  specifiers: Set<string>,
): void {
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

async function getExecutorApiShimUrl(fromFile: string): Promise<string> {
  let pending = executorApiShimUrlCache.get(fromFile);
  if (!pending) {
    pending = (async () => {
      const effectUrl = pathToFileURL(
        await resolveModuleSpecifier("effect", fromFile),
      ).href;
      const httpApiUrl = pathToFileURL(
        await resolveModuleSpecifier("effect/unstable/httpapi", fromFile),
      ).href;
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

async function resolveModuleSpecifier(
  specifier: string,
  fromFile: string,
): Promise<string> {
  if (specifier.startsWith("file:")) return fileURLToPath(specifier);
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
  const packageJson = JSON.parse(
    await readFile(packageJsonPath, "utf8"),
  ) as PackageJson;
  const target = resolvePackageExport(packageJson, subpath);
  if (!target) {
    throw new Error(`Could not resolve ${specifier} from ${fromFile}`);
  }
  return resolveExistingPath(resolve(packageRoot, target));
}

type PackageJson = {
  exports?: unknown;
  module?: string;
  main?: string;
};

function splitPackageSpecifier(specifier: string): {
  packageName: string;
  subpath: string;
} {
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

async function findPackageRoot(
  packageName: string,
  fromFile: string,
): Promise<string> {
  let current = dirname(fromFile);
  while (true) {
    const candidate = join(current, "node_modules", packageName);
    if (await pathExists(join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error(`Cannot find package ${packageName} from ${fromFile}`);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveExistingPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

function resolvePackageExport(
  packageJson: PackageJson,
  subpath: string,
): string | undefined {
  const exportKey = subpath ? `./${subpath}` : ".";
  if (packageJson.exports !== undefined) {
    const entry = selectExportEntry(packageJson.exports, exportKey);
    const target = selectExportTarget(entry);
    if (target) return target;
    return undefined;
  }
  if (subpath) return subpath;
  return packageJson.module ?? packageJson.main ?? "index.js";
}

function selectExportEntry(exportsField: unknown, exportKey: string): unknown {
  if (
    typeof exportsField === "string" ||
    Array.isArray(exportsField) ||
    exportsField === null
  ) {
    return exportKey === "." ? exportsField : undefined;
  }
  if (typeof exportsField !== "object") return undefined;

  const map = exportsField as Record<string, unknown>;
  if (Object.hasOwn(map, exportKey)) return map[exportKey];
  for (const [key, value] of Object.entries(map)) {
    if (!key.includes("*")) continue;
    const [prefix, suffix] = key.split("*");
    if (exportKey.startsWith(prefix) && exportKey.endsWith(suffix)) {
      const replacement = exportKey.slice(
        prefix.length,
        exportKey.length - suffix.length,
      );
      return replaceExportTargetPattern(value, replacement);
    }
  }
  return undefined;
}

function replaceExportTargetPattern(
  entry: unknown,
  replacement: string,
): unknown {
  if (typeof entry === "string") return entry.replaceAll("*", replacement);
  if (Array.isArray(entry)) {
    return entry.map((item) => replaceExportTargetPattern(item, replacement));
  }
  if (entry && typeof entry === "object") {
    return Object.fromEntries(
      Object.entries(entry).map(([key, value]) => [
        key,
        replaceExportTargetPattern(value, replacement),
      ]),
    );
  }
  return entry;
}

function selectExportTarget(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (Array.isArray(entry)) {
    for (const item of entry) {
      const target = selectExportTarget(item);
      if (target) return target;
    }
    return undefined;
  }
  if (!entry || typeof entry !== "object") return undefined;

  const conditions = entry as Record<string, unknown>;
  for (const key of ["import", "node", "default"]) {
    if (Object.hasOwn(conditions, key)) {
      const target = selectExportTarget(conditions[key]);
      if (target) return target;
    }
  }
  return undefined;
}

async function loadOfficialPlugins(kinds: Set<string>): Promise<SDKPlugin[]> {
  const plugins: SDKPlugin[] = [];

  if (kinds.has("graphql")) {
    try {
      const graphqlPlugin = await importOfficialPluginExport<() => SDKPlugin>(
        "@executor-js/plugin-graphql/core",
        "graphqlPlugin",
      );
      plugins.push(graphqlPlugin());
    } catch (error) {
      throw pluginLoadError("GraphQL", error);
    }
  }

  if (kinds.has("openapi")) {
    try {
      const openApiPlugin = await importOfficialPluginExport<() => SDKPlugin>(
        "@executor-js/plugin-openapi/core",
        "openApiPlugin",
      );
      plugins.push(openApiPlugin());
    } catch (error) {
      throw pluginLoadError("OpenAPI", error);
    }
  }

  if (kinds.has("mcp")) {
    try {
      const mcpPlugin = await importOfficialPluginExport<() => SDKPlugin>(
        "@executor-js/plugin-mcp/core",
        "mcpPlugin",
      );
      plugins.push(mcpPlugin());
    } catch (error) {
      throw pluginLoadError("MCP", error);
    }
  }

  return plugins;
}

export async function initExecutorSDK(
  setup: ((sdk: ExecutorSDKHandle) => Promise<void>) | undefined,
  plugins: ExecutorConfig["plugins"] | undefined,
  onElicitation: ExecutorConfig["onElicitation"] | undefined,
): Promise<{
  sdk: ExecutorSDKHandle;
  rawExecutor: SDKExecutor;
}> {
  const queuedSources: Record<string, unknown>[] = [];
  const setupRecorder: ExecutorSDKHandle = {
    tools: {
      list: async () => [],
      invoke: async () => {
        throw new Error(
          "sdk.tools.invoke() is not available during executor setup",
        );
      },
    },
    sources: {
      add: async (input) => {
        queuedSources.push(input);
      },
      list: async () => [],
    },
    close: async () => {},
  };

  if (setup) {
    await setup(setupRecorder);
  }

  const sourceKinds = new Set(
    queuedSources.map((source) => String(source.kind ?? "custom")),
  );

  const { createExecutor } = await import("@executor-js/sdk");
  const { Effect } = await import("@executor-js/sdk/core");
  const { discoveryPlugin } = await import("./executor-discovery-plugin.js");
  const officialPlugins = await loadOfficialPlugins(sourceKinds);

  const allPlugins = [
    discoveryPlugin(),
    ...officialPlugins,
    ...((plugins ?? []) as SDKPlugin[]),
  ];

  const createSDKExecutor = createExecutor as (config: {
    plugins: SDKPlugin[];
    onElicitation: SDKElicitationHandler;
  }) => Promise<unknown>;

  const executor = (await createSDKExecutor({
    plugins: allPlugins,
    onElicitation: toSDKElicitationHandler(Effect, onElicitation),
  })) as SDKExecutor;

  const addSource = createAddSource(executor);
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

  for (const source of queuedSources) {
    await addSource(source);
  }

  return { sdk, rawExecutor: executor };
}

function createAddSource(
  executor: SDKExecutor,
): (def: Record<string, unknown>) => Promise<void> {
  const discoveryExt = getExtension<{
    sources: { add: (def: Record<string, unknown>) => Promise<void> };
  }>(executor, "justBashDiscovery");

  return async (def: Record<string, unknown>): Promise<void> => {
    const kind = String(def.kind ?? "custom");

    if (kind === "graphql") {
      const graphqlExt = getExtension<{
        addSource: (config: {
          endpoint: string;
          scope: string;
          name?: string;
          namespace?: string;
          headers?: Record<string, unknown>;
          queryParams?: Record<string, unknown>;
          introspectionJson?: string;
        }) => Promise<{ toolCount: number; namespace: string }>;
      }>(executor, "graphql");

      await graphqlExt.addSource({
        endpoint: def.endpoint as string,
        scope: (def.scope as string | undefined) ?? DEFAULT_SCOPE_ID,
        name: def.name as string | undefined,
        namespace: def.name as string | undefined,
        headers: def.headers as Record<string, unknown> | undefined,
        queryParams: def.queryParams as Record<string, unknown> | undefined,
        introspectionJson: def.introspectionJson as string | undefined,
      });
      return;
    }

    if (kind === "openapi") {
      const openapiExt = getExtension<{
        addSpec: (config: {
          spec: string;
          scope: string;
          name?: string;
          baseUrl?: string;
          namespace?: string;
          headers?: Record<string, unknown>;
          queryParams?: Record<string, unknown>;
        }) => Promise<{ sourceId: string; toolCount: number }>;
      }>(executor, "openapi");

      await openapiExt.addSpec({
        spec: def.spec as string,
        scope: (def.scope as string | undefined) ?? DEFAULT_SCOPE_ID,
        baseUrl: (def.endpoint ?? def.baseUrl) as string | undefined,
        name: def.name as string | undefined,
        namespace: def.name as string | undefined,
        headers: def.headers as Record<string, unknown> | undefined,
        queryParams: def.queryParams as Record<string, unknown> | undefined,
      });
      return;
    }

    if (kind === "mcp") {
      const mcpExt = getExtension<{
        addSource: (config: {
          transport: string;
          scope: string;
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
      }>(executor, "mcp");

      const transport = (def.transport as string | undefined) ?? "remote";
      if (transport === "stdio") {
        await mcpExt.addSource({
          transport: "stdio",
          scope: (def.scope as string | undefined) ?? DEFAULT_SCOPE_ID,
          name: def.name as string,
          command: def.command as string,
          args: def.args as string[] | undefined,
          env: def.env as Record<string, string> | undefined,
          cwd: def.cwd as string | undefined,
          namespace: def.name as string | undefined,
        });
        return;
      }

      await mcpExt.addSource({
        transport: "remote",
        scope: (def.scope as string | undefined) ?? DEFAULT_SCOPE_ID,
        name: def.name as string,
        endpoint: def.endpoint as string,
        namespace: def.name as string | undefined,
        headers: def.headers as Record<string, string> | undefined,
        remoteTransport: def.remoteTransport as string | undefined,
        queryParams: def.queryParams as Record<string, string> | undefined,
      });
      return;
    }

    await discoveryExt.sources.add(def);
  };
}
