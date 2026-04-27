/**
 * `createExecutor` — main entry point.
 *
 * Builds an `ExecutorHandle` containing:
 *   - `commands`: bash namespace commands derived from inline tools and/or
 *     SDK-discovered tools, ready to pass to `new Bash({ customCommands })`
 *   - `invokeTool`: a `(path, argsJson) => Promise<string>` callback to wire
 *     into `new Bash({ javascript: { invokeTool } })`
 *   - `sdk?`: the SDK handle when `setup` was provided, exposed for advanced
 *     use (e.g. listing sources)
 */

import type { Command } from "just-bash";
import { initExecutorSDK } from "./executor-init.js";
import { parseToolArgs } from "./parse-tool-args.js";
import { buildNamespaceCommands, type ToolEntry } from "./tool-command.js";
import type {
  ExecutorConfig,
  ExecutorSDKHandle,
  ExecutorToolDef,
} from "./types.js";

type SDKToolMeta = {
  id: string;
  sourceId?: string;
  source_id?: string;
  name?: string;
  annotations?: {
    approvalDescription?: string;
  };
};

type SDKSourceMeta = {
  id?: string;
  name?: string;
};

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export interface ExecutorHandle {
  /** Bash namespace commands; pass to `new Bash({ customCommands })`. */
  commands: Command[];
  /**
   * Tool invocation callback for `JavaScriptConfig.invokeTool`.
   * Routes inline tool calls directly and SDK-tool calls through the
   * approval/elicitation pipeline.
   */
  invokeTool: (path: string, argsJson: string) => Promise<string>;
  /**
   * SDK handle. Present only when `setup` was provided. Use it to inspect
   * sources, list tools, or close the executor when done.
   */
  sdk?: ExecutorSDKHandle;
}

/**
 * Build an `ExecutorHandle` from a config of inline tools and/or an SDK setup.
 *
 * - **Inline tools** (`tools`): registered locally; calls go through
 *   `tool.execute(args)` directly.
 * - **SDK setup** (`setup`): boots `@executor-js/sdk` with the GraphQL,
 *   OpenAPI, MCP, and discovery plugins; calls go through
 *   `sdk.tools.invoke()` with approval/elicitation gates applied.
 *
 * Both can be present in one call. Inline tools take precedence over
 * SDK-discovered tools with the same path.
 */
export async function createExecutor(
  config: ExecutorConfig = {},
): Promise<ExecutorHandle> {
  const inlineTools: Record<string, ExecutorToolDef> = Object.assign(
    Object.create(null) as Record<string, ExecutorToolDef>,
    config.tools ?? {},
  );

  const exposeAsCommands = config.exposeToolsAsCommands !== false;
  const allEntries: ToolEntry[] = [];

  for (const path of Object.keys(inlineTools)) {
    allEntries.push({
      path,
      description: inlineTools[path].description,
    });
  }

  const inlineInvokeTool = async (
    path: string,
    argsJson: string,
  ): Promise<string> => {
    const tool = inlineTools[path];
    if (!tool) throw new Error(`Unknown tool: ${path}`);
    const args = parseToolArgs(argsJson);
    const result = await tool.execute(args);
    return result !== undefined ? JSON.stringify(result) : "";
  };

  // No SDK setup → inline-only path. Done.
  if (!config.setup) {
    return {
      commands: exposeAsCommands
        ? buildNamespaceCommands(allEntries, inlineInvokeTool)
        : [],
      invokeTool: inlineInvokeTool,
    };
  }

  // SDK path: boot SDK, run user setup, list discovered tools, build a merged
  // invokeTool that prefers inline tools and falls through to the SDK pipeline.
  const { sdk, rawExecutor } = await initExecutorSDK(
    config.setup,
    config.plugins,
    config.onElicitation,
  );

  const discoveredTools = (await sdk.tools.list()) as {
    id: string;
    description?: string;
  }[];
  for (const tool of discoveredTools) {
    if (Object.hasOwn(inlineTools, tool.id)) continue; // inline wins
    allEntries.push({ path: tool.id, description: tool.description });
  }

  const approval = config.onToolApproval;
  const sdkInvokeTool = async (
    path: string,
    argsJson: string,
  ): Promise<string> => {
    const args = parseToolArgs(argsJson);

    if (approval && approval !== "allow-all") {
      if (approval === "deny-all") {
        throw new Error(`Tool invocation denied: ${path}`);
      }
      const allTools = (await rawExecutor.tools.list()) as SDKToolMeta[];
      const toolMeta = allTools.find((t) => t.id === path);
      const sourceId =
        readString(toolMeta?.sourceId) ??
        readString(toolMeta?.source_id) ??
        "unknown";
      const allSources = (await rawExecutor.sources.list()) as SDKSourceMeta[];
      const sourceMeta = allSources.find((source) => source.id === sourceId);
      const approvalLabel =
        readString(toolMeta?.annotations?.approvalDescription) ?? null;
      const decision = await approval({
        toolPath: path,
        sourceId,
        sourceName: readString(sourceMeta?.name) ?? sourceId,
        operationKind: "unknown",
        args,
        reason: approvalLabel ?? `Tool ${path} invoked`,
        approvalLabel,
      });
      if (!decision.approved) {
        throw new Error(
          `Tool invocation denied: ${path}${
            decision.reason ? ` (${decision.reason})` : ""
          }`,
        );
      }
    }

    const result = await rawExecutor.tools.invoke(path, args);

    return result !== undefined ? JSON.stringify(result) : "";
  };

  const invokeTool = async (
    path: string,
    argsJson: string,
  ): Promise<string> => {
    if (Object.hasOwn(inlineTools, path)) {
      return inlineInvokeTool(path, argsJson);
    }
    return sdkInvokeTool(path, argsJson);
  };

  return {
    commands: exposeAsCommands
      ? buildNamespaceCommands(allEntries, invokeTool)
      : [],
    invokeTool,
    sdk,
  };
}
