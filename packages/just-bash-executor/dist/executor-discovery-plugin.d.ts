/**
 * Custom discovery plugin for @executor-js/sdk.
 *
 * Provides a `sources.add()` extension that registers tools dynamically
 * at runtime. Supports a "custom" source kind where tools are provided
 * directly as `{ description?, execute(args) }` objects.
 */
import { Effect, type Plugin } from "@executor-js/sdk/core";
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
        add: (def: SourceDefinition) => Effect.Effect<undefined, Error>;
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
 * const sdk = await createExecutor({
 *   plugins: [discoveryPlugin()],
 *   onElicitation: "accept-all",
 * });
 * await sdk.justBashDiscovery.sources.add({
 *   kind: "custom",
 *   name: "math",
 *   tools: { ... },
 * });
 * ```
 */
export declare function discoveryPlugin(): Plugin<"justBashDiscovery", DiscoveryPluginExtension, null>;
