/**
 * Custom discovery plugin for @executor-js/sdk.
 *
 * Provides a `sources.add()` extension that registers tools dynamically
 * at runtime. Supports a "custom" source kind where tools are provided
 * directly as `{ description?, execute(args) }` objects — no schema
 * introspection required.
 *
 * This covers the discovery code path (plugin → tool registration →
 * tool invocation) until official plugins like @executor-js/plugin-graphql
 * and @executor-js/plugin-openapi are published.
 */
import type { Plugin } from "@executor-js/sdk";
export interface DiscoveryToolDef {
    description?: string;
    execute: (args: any) => unknown | Promise<unknown>;
}
export interface SourceDefinition {
    /** Source kind. Currently only "custom" is supported. */
    kind: string;
    /** Unique name for this source (becomes the tool namespace). */
    name: string;
    /** Tool definitions (for kind: "custom"). Keys are tool names. */
    tools?: Record<string, DiscoveryToolDef>;
    /** Auth config (reserved for future plugin kinds). */
    auth?: Record<string, unknown>;
    /** Endpoint URL (reserved for future plugin kinds). */
    endpoint?: string;
}
export interface DiscoveryPluginExtension {
    sources: {
        add: (def: SourceDefinition) => Promise<void>;
    };
}
/**
 * Create a discovery plugin instance.
 *
 * Usage with createExecutor:
 * ```ts
 * import { createExecutor } from "@executor-js/sdk";
 * import { discoveryPlugin } from "./executor-discovery-plugin.js";
 *
 * const sdk = await createExecutor({ plugins: [discoveryPlugin()] });
 * // sdk.justBashDiscovery.sources.add({ kind: "custom", name: "math", tools: { ... } })
 * ```
 */
export declare function discoveryPlugin(): Plugin<"justBashDiscovery", DiscoveryPluginExtension>;
