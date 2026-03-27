/**
 * Executor SDK lazy initialization.
 * Separated from Bash.ts so the browser bundle never sees these imports.
 * Only loaded at runtime behind a dynamic import.
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
  /**
   * Execute code through the SDK pipeline.
   * The SDK creates the toolInvoker per-execution and passes it to our
   * CodeExecutor, which runs the code in QuickJS with the tools proxy.
   */
  executeViaSdk: (code: string) => Promise<{
    result: unknown;
    error?: string;
    logs?: string[];
  }>;
}> {
  // @banned-pattern-ignore: static literal path to vendored SDK bundle
  const { createExecutor, createFsBackend } = await import(
    "../vendor/executor/executor-sdk-bundle.mjs"
  );
  const { executeForExecutor } = await import("./commands/js-exec/js-exec.js");
  const EffectMod = await import("effect/Effect");

  // biome-ignore lint/suspicious/noExplicitAny: CodeExecutor + ToolInvoker types cross package boundaries; validated at runtime by the SDK
  const runtime: any = {
    // biome-ignore lint/suspicious/noExplicitAny: ToolInvoker type from @executor/sdk
    execute(code: string, toolInvoker: any) {
      return EffectMod.tryPromise(async () => {
        const ctx = {
          fs,
          cwd: getCwd(),
          env: getEnv(),
          stdin: "",
          limits: resolveLimits(getLimits()),
        };
        // Bridge: convert the SDK's Effect-based toolInvoker to the
        // JSON string protocol used by the SharedArrayBuffer bridge.
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

  // Use the Bash instance's virtual filesystem for executor state.
  // This makes all executor state serializable (serialize the fs = serialize everything)
  // and inspectable via bash commands (cat /.executor/config.json).
  const fsBackend = createFsBackend({
    fs: {
      writeFileSync: (path: string, content: string | Uint8Array) => {
        const str = typeof content === "string" ? content : new TextDecoder().decode(content);
        // InMemoryFs has writeFileSync
        (fs as any).writeFileSync(path, str);
      },
      mkdirSync: (path: string, opts?: { recursive?: boolean }) => {
        try { (fs as any).mkdirSync(path, opts); } catch { /* ignore */ }
      },
      readFile: (path: string) => fs.readFile(path),
      exists: (path: string) => fs.exists(path),
    },
    root: "/.executor",
  });

  const sdk = await createExecutor({
    runtime,
    storage: fsBackend,
    onToolApproval: approval ?? "allow-all",
  });

  if (setup) {
    await setup(sdk as unknown as ExecutorSDKHandle);
  }

  const sdkRef = sdk as unknown as ExecutorSDKHandle;

  // executeViaSdk routes code through the SDK's execute() which creates
  // the toolInvoker (with all discovered sources) and calls our CodeExecutor.
  // Our CodeExecutor runs the code in QuickJS with tools bridged via SAB.
  const executeViaSdk = async (
    code: string,
  ): Promise<{ result: unknown; error?: string; logs?: string[] }> => {
    return sdkRef.execute(code);
  };

  return { sdk: sdkRef, executeViaSdk };
}
