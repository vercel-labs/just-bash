/**
 * Lazy initialization of `@executor-js/sdk`.
 *
 * Kept in its own module so consumers who only use inline tools never load
 * the SDK or optional discovery plugins.
 */
import type { ExecutorConfig, ExecutorSDKHandle } from "./types.js";
type SDKExecutor = {
    tools: ExecutorSDKHandle["tools"];
    sources: {
        list: ExecutorSDKHandle["sources"]["list"];
    };
    close: ExecutorSDKHandle["close"];
} & Record<string, unknown>;
export declare function initExecutorSDK(setup: ((sdk: ExecutorSDKHandle) => Promise<void>) | undefined, plugins: ExecutorConfig["plugins"] | undefined, onElicitation: ExecutorConfig["onElicitation"] | undefined): Promise<{
    sdk: ExecutorSDKHandle;
    rawExecutor: SDKExecutor;
}>;
export {};
