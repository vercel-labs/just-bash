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
import type { ExecutorConfig, ExecutorSDKHandle } from "./types.js";
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
export declare function createExecutor(config?: ExecutorConfig): Promise<ExecutorHandle>;
