/**
 * Lazy initialization of `@executor-js/sdk` plus the GraphQL / OpenAPI / MCP
 * plugins. Pulled into its own module so consumers who only use inline tools
 * never load these dependencies.
 */
import type { ExecutorConfig, ExecutorSDKHandle } from "./types.js";
export declare function initExecutorSDK(setup: ((sdk: ExecutorSDKHandle) => Promise<void>) | undefined, plugins: ExecutorConfig["plugins"] | undefined): Promise<{
    sdk: ExecutorSDKHandle;
    rawExecutor: any;
}>;
