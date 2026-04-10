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

import type {
  Plugin,
  PluginContext,
  RuntimeToolHandler,
} from "@executor-js/sdk";
import {
  definePlugin,
  Source,
  ToolInvocationResult,
  ToolRegistration,
} from "@executor-js/sdk";

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
export function discoveryPlugin(): Plugin<
  "justBashDiscovery",
  DiscoveryPluginExtension
> {
  return definePlugin<"justBashDiscovery", DiscoveryPluginExtension>({
    key: "justBashDiscovery",
    init: async (ctx: PluginContext) => {
      const registeredToolIds: string[] = [];
      const registeredSourceIds: string[] = [];

      const addSource = async (def: SourceDefinition): Promise<void> => {
        if (def.kind === "custom" && def.tools) {
          await addCustomSource(
            ctx,
            def,
            registeredToolIds,
            registeredSourceIds,
          );
        } else {
          // TODO: Support "graphql" kind when @executor-js/plugin-graphql is published
          // TODO: Support "openapi" kind when @executor-js/plugin-openapi is published
          // TODO: Support "mcp" kind when @executor-js/plugin-mcp is published
          throw new Error(
            `Unsupported source kind: "${def.kind}". ` +
              `Only "custom" is supported. GraphQL/OpenAPI/MCP support requires ` +
              `official @executor-js plugins (not yet published).`,
          );
        }
      };

      return {
        extension: {
          sources: { add: addSource },
        },
        close: async () => {
          if (registeredToolIds.length > 0) {
            await ctx.tools.unregisterRuntime(registeredToolIds);
          }
          for (const sourceId of registeredSourceIds) {
            await ctx.sources.unregisterRuntime(sourceId);
          }
        },
      };
    },
  });
}

async function addCustomSource(
  ctx: PluginContext,
  def: SourceDefinition,
  registeredToolIds: string[],
  registeredSourceIds: string[],
): Promise<void> {
  const tools = def.tools;
  if (!tools) return;

  // Register the source
  await ctx.sources.registerRuntime(
    new Source({
      id: def.name,
      name: def.name,
      kind: "custom",
      runtime: true,
      canRemove: true,
      canRefresh: false,
    }),
  );
  registeredSourceIds.push(def.name);

  // Register each tool
  const registrations: ToolRegistration[] = [];
  for (const [name, tool] of Object.entries(tools)) {
    const toolId = `${def.name}.${name}`;

    // ToolRegistration id field is branded ToolId at the type level;
    // at runtime, Effect Schema.brand accepts plain strings.
    const reg = new ToolRegistration({
      // biome-ignore lint/suspicious/noExplicitAny: branded ToolId accepts string at runtime
      id: toolId as any,
      pluginKey: "justBashDiscovery",
      sourceId: def.name,
      name,
      description: tool.description,
    });
    registrations.push(reg);

    const handler: RuntimeToolHandler = {
      invoke: async (args: unknown) => {
        try {
          const result = await tool.execute(args);
          return new ToolInvocationResult({
            data: result ?? null,
            error: null,
          });
        } catch (e: unknown) {
          return new ToolInvocationResult({
            data: null,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      },
    };
    await ctx.tools.registerRuntimeHandler(toolId, handler);
    registeredToolIds.push(toolId);
  }

  await ctx.tools.registerRuntime(registrations);
}
