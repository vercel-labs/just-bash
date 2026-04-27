/**
 * Custom discovery plugin for @executor-js/sdk.
 *
 * Provides a `sources.add()` extension that registers tools dynamically
 * at runtime. Supports a "custom" source kind where tools are provided
 * directly as `{ description?, execute(args) }` objects.
 */

import {
  definePlugin,
  Effect,
  type Plugin,
  type PluginCtx,
  type SourceInputTool,
} from "@executor-js/sdk/core";

export interface DiscoveryToolDef {
  description?: string;
  // biome-ignore lint/suspicious/noExplicitAny: tool execute accepts any args shape
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
export function discoveryPlugin(): Plugin<
  "justBashDiscovery",
  DiscoveryPluginExtension,
  null
> {
  const handlers = new Map<string, DiscoveryToolDef>();

  return definePlugin(() => ({
    id: "justBashDiscovery",
    storage: () => null,
    extension: (ctx: PluginCtx<null>) => ({
      sources: {
        add: (def: SourceDefinition) =>
          Effect.gen(function* () {
            if (def.kind !== "custom" || !def.tools) {
              return yield* Effect.fail(
                new Error(
                  `Unsupported source kind: "${def.kind}" for discovery plugin. ` +
                    `Only "custom" is supported here.`,
                ),
              );
            }

            const scope = ctx.scopes[0]?.id ?? "default-scope";
            const tools: SourceInputTool[] = [];

            for (const [name, tool] of Object.entries(def.tools)) {
              const toolId = `${def.name}.${name}`;
              handlers.set(toolId, tool);
              tools.push({
                name,
                description: tool.description ?? name,
              });
            }

            yield* ctx.core.sources.register({
              id: def.name,
              scope,
              kind: "custom",
              name: def.name,
              canRemove: true,
              canRefresh: false,
              tools,
            });
          }),
      },
    }),
    invokeTool: ({ toolRow, args }) =>
      Effect.tryPromise({
        try: async () => {
          const handler = handlers.get(toolRow.id);
          if (!handler) {
            throw new Error(`Unknown tool: ${toolRow.id}`);
          }
          return handler.execute(args);
        },
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    close: () =>
      Effect.sync(() => {
        handlers.clear();
      }),
  }))();
}
