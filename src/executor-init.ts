/**
 * Executor SDK lazy initialization.
 * Separated from Bash.ts so the browser bundle never sees these imports.
 * Only loaded at runtime behind a __BROWSER__ guard.
 */

import type { ExecutorConfig, ExecutorSDKHandle } from "./Bash.js";
import { resolveLimits } from "./limits.js";

export async function initExecutorSDK(
  setup: (sdk: ExecutorSDKHandle) => Promise<void>,
  approval: ExecutorConfig["onToolApproval"] | undefined,
  fs: import("./fs/interface.js").IFileSystem,
  getCwd: () => string,
  getEnv: () => Map<string, string>,
  getLimits: () => import("./limits.js").ExecutionLimits | undefined,
): Promise<{
  sdk: ExecutorSDKHandle;
  invokeTool: (path: string, argsJson: string) => Promise<string>;
}> {
  // @banned-pattern-ignore: static literal path to vendored SDK bundle
  const { createExecutor } = await import(
    "../vendor/executor/executor-sdk-bundle.mjs"
  );
  const { executeForExecutor } = await import("./commands/js-exec/js-exec.js");
  const EffectMod = await import("effect/Effect");

  // biome-ignore lint/suspicious/noExplicitAny: CodeExecutor + ToolInvoker types cross package boundaries; validated at runtime by the SDK
  const runtime: any = {
    // biome-ignore lint/suspicious/noExplicitAny: ToolInvoker type from @executor/sdk
    execute(code: string, toolInvoker: any) {
      return EffectMod.tryPromise(() => {
        const ctx = {
          fs,
          cwd: getCwd(),
          env: getEnv(),
          stdin: "",
          limits: resolveLimits(getLimits()),
        };
        const invokeTool = async (
          path: string,
          argsJson: string,
        ): Promise<string> => {
          let args: unknown;
          try {
            args = argsJson ? JSON.parse(argsJson) : undefined;
          } catch {
            args = undefined;
          }
          const result = await EffectMod.runPromise(
            toolInvoker.invoke({ path, args }),
          );
          return result !== undefined ? JSON.stringify(result) : "";
        };
        return executeForExecutor(code, ctx, invokeTool);
      });
    },
  };

  const sdk = await createExecutor({
    runtime,
    storage: "memory",
    onToolApproval: approval ?? "allow-all",
  });

  if (setup) {
    await setup(sdk as unknown as ExecutorSDKHandle);
  }

  const sdkRef = sdk as unknown as ExecutorSDKHandle;

  const invokeTool = async (
    path: string,
    argsJson: string,
  ): Promise<string> => {
    const escapedPath = path.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
    const sdkHandle = sdkRef;
    if (!sdkHandle) throw new Error("Executor SDK not initialized");
    const result = await sdkHandle.execute(
      `return await tools.${escapedPath}(${argsJson || "{}"})`,
    );
    if (result.error) throw new Error(result.error);
    return result.result !== undefined ? JSON.stringify(result.result) : "";
  };

  return { sdk: sdkRef, invokeTool };
}
