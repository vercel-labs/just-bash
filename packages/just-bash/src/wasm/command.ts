import { utf8ByteLength } from "../encoding.js";
import type { ResourceLease } from "../execution-scope.js";
import { sanitizeHostErrorMessage } from "../fs/sanitize-error.js";
import { bindDefenseContextCallback } from "../security/defense-context.js";
import { _Atomics, _SharedArrayBuffer } from "../security/trusted-globals.js";
import type { Command, ExecResult, ResolvedCommandContext } from "../types.js";
import { WorkerLifecycle } from "../worker-lifecycle.js";
import { CLOSED, HEADER_BYTES, RPC_BYTES, respond } from "./protocol.js";
import type { WasmCommandOptions, WasmLimits } from "./types.js";
import { ERRNO_IO } from "./wasi/abi.js";
import { errnoFrom, WasiError, WasiFileSystem } from "./wasi/filesystem.js";
import type {
  WasmWorker,
  WorkerFactory,
  WorkerMessage,
} from "./worker-types.js";

type PreparedOptions = Omit<WasmCommandOptions, "adapter"> & {
  adapter?: string;
};

function option(
  value: number | undefined,
  fallback: number,
  minimum = 1,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < minimum || result > maximum)
    throw new RangeError(
      "WASM limits must be finite integers within their supported range",
    );
  return result;
}

export function createWasmCommand(
  name: string,
  options: WasmCommandOptions,
  createWorker: WorkerFactory,
): Command {
  const kind = options.adapter && options.adapter !== "wasi" ? "WASM" : "WASI";
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.+-]*$/.test(name))
    throw new TypeError(`Invalid ${kind} command name`);
  if (
    !(options.wasm instanceof Uint8Array) &&
    typeof options.wasm !== "function"
  )
    throw new TypeError("wasm must be bytes or a host loader");
  const limits: WasmLimits = {
    timeoutMs: option(options.timeoutMs, 30_000, 1, 2_147_483_647),
    maxMemoryBytes: option(
      options.maxMemoryBytes,
      256 * 1024 * 1024,
      65536,
      2 ** 32,
    ),
    maxModuleBytes: option(options.maxModuleBytes, 64 * 1024 * 1024),
    maxFileBytes: option(options.maxFileBytes, 64 * 1024 * 1024, 0),
    maxTableElements: option(
      options.maxTableElements,
      1_000_000,
      1,
      0xffffffff,
    ),
  };
  const source = options.wasm;
  let adapter: string | undefined;
  if (options.adapter !== undefined && options.adapter !== "wasi") {
    if (
      typeof options.adapter !== "string" &&
      !(options.adapter instanceof URL)
    )
      throw new TypeError(
        "WASM adapters must be absolute JavaScript module URLs",
      );
    const url = new URL(String(options.adapter));
    if (
      !["file:", "https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.href.length > 4096
    )
      throw new TypeError("Unsupported WASM adapter URL");
    adapter = url.href;
  }
  const workerOptions = { ...options, adapter };
  return {
    name,
    trusted: true,
    execute(args, ctx) {
      return execute(
        name,
        args,
        ctx,
        source,
        workerOptions,
        limits,
        createWorker,
      );
    },
  };
}

function execute(
  name: string,
  args: string[],
  ctx: ResolvedCommandContext,
  source: WasmCommandOptions["wasm"],
  options: PreparedOptions,
  configured: WasmLimits,
  createWorker: WorkerFactory,
): Promise<ExecResult> {
  return new Promise<ExecResult>((resolve) => {
    const abort = new AbortController();
    const limits = {
      ...configured,
      timeoutMs: Math.min(
        configured.timeoutMs,
        ctx.executionScope?.remainingTimeMs() ?? ctx.limits.maxExecutionTimeMs,
      ),
      maxFileBytes: Math.min(configured.maxFileBytes, ctx.limits.maxLiveBytes),
    };
    const host = new WasiFileSystem(ctx, limits);
    const lifecycle = new WorkerLifecycle({
      timeoutMs: limits.timeoutMs,
      signal: ctx.signal,
    });
    let worker: WasmWorker | undefined;
    let buffer: SharedArrayBuffer | undefined;
    let lease: ResourceLease | undefined;
    let closing: Promise<void> | undefined;
    let ended = false;
    let busy = false;
    let unlisten = (): void => {};
    let unregister = (): void => {};

    const finish = (code: number, error = ""): Promise<void> => {
      if (closing) return closing;
      ended = true;
      abort.abort();
      host.close();
      lifecycle.close();
      if (buffer) {
        const header = new Int32Array(buffer, 0, 4);
        _Atomics.store(header, 0, CLOSED);
        _Atomics.notify(header, 0);
      }
      closing = (async () => {
        if (!(await lifecycle.terminate(worker))) {
          code = 126;
          error = "Worker termination was not acknowledged";
        }
        unlisten();
        unregister();
        lease?.release();
        resolve({
          stdout: host.stdout,
          stderr:
            host.stderr +
            (error ? `${name}: ${sanitizeHostErrorMessage(error)}\n` : ""),
          exitCode: code,
          stdoutKind: "bytes",
        });
      })();
      return closing;
    };
    const fail = (error: unknown): void => {
      void finish(
        126,
        error instanceof Error ? error.message : "WASI execution failed",
      );
    };

    const receive = async (message: WorkerMessage): Promise<void> => {
      if (ended) return;
      if (!message || typeof message !== "object")
        throw new Error("Invalid WASI worker response");
      if (message.type === "done") {
        if (
          !Number.isSafeInteger(message.exitCode) ||
          message.exitCode < 0 ||
          message.exitCode > 0xffffffff
        )
          throw new Error("Invalid WASI exit status");
        await finish(message.exitCode);
      } else if (message.type === "error") {
        await finish(
          126,
          typeof message.message === "string"
            ? message.message.slice(0, 1024)
            : "WASI execution failed",
        );
      } else if (message.type === "request") {
        if (busy || !buffer) throw new Error("Invalid concurrent WASI request");
        busy = true;
        try {
          const data = await host.request(message);
          if (!ended) respond(buffer, 0, data);
        } catch (error) {
          if (ended) return;
          // Resource limit failures stop the worker, rather than becoming a
          // recoverable guest errno that could hide poisoned execution state.
          const errno = errnoFrom(error);
          if (!(error instanceof WasiError) && errno === ERRNO_IO) throw error;
          respond(buffer, errno, new Uint8Array());
        } finally {
          busy = false;
        }
      } else throw new Error("Invalid WASI worker message");
    };

    try {
      ctx.executionScope?.throwIfAborted("WASI command");
      unregister =
        ctx.executionScope?.registerCleanup(() =>
          finish(124, "Execution closed"),
        ) ?? unregister;
      lifecycle.arm((reason) => {
        void finish(
          124,
          reason === "abort"
            ? lifecycle.abortMessage()
            : lifecycle.timeoutMessage(),
        );
      });
      if (lifecycle.isCanceled) return;
      if (typeof _SharedArrayBuffer !== "function")
        throw new Error(
          "WASI requires SharedArrayBuffer; browser hosts must enable cross-origin isolation",
        );
      const onMessage = bindDefenseContextCallback(
        ctx.requireDefenseContext,
        "wasi",
        "worker message",
        (message: WorkerMessage) => {
          void receive(message).catch(fail);
        },
      );
      const startup = async (): Promise<void> => {
        const loaded =
          typeof source === "function" ? await source(abort.signal) : source;
        if (ended) return;
        if (
          !(loaded instanceof Uint8Array) ||
          loaded.length > limits.maxModuleBytes
        )
          throw new Error("WASM module exceeds configured byte limit");
        if (args.length > ctx.limits.maxArrayElements)
          throw new Error("Too many WASI arguments");
        const environment = new Map(
          ctx.exportedEnv ? Object.entries(ctx.exportedEnv) : ctx.env,
        );
        environment.set("PWD", ctx.cwd);
        const argv = [name, ...args];
        const env: string[] = [];
        for (const [key, value] of environment) {
          if (
            !key ||
            key.includes("=") ||
            key.includes("\0") ||
            value.includes("\0")
          )
            throw new Error("Invalid WASI environment");
          env.push(`${key}=${value}`);
        }
        let inputBytes =
          loaded.length +
          utf8ByteLength(ctx.cwd) +
          8 +
          utf8ByteLength(options.adapter ?? "");
        for (const value of [...argv, ...env]) {
          if (value.includes("\0"))
            throw new Error("WASI arguments cannot contain NUL");
          inputBytes += utf8ByteLength(value) + 8;
        }
        if (inputBytes > ctx.limits.maxWorkerMessageBytes)
          throw new Error("WASI worker request exceeds configured byte limit");
        ctx.executionScope?.consumeInput(loaded.length, "WASM module");
        const overhead =
          inputBytes * 3 +
          RPC_BYTES +
          HEADER_BYTES +
          limits.maxTableElements * 16;
        const available =
          ctx.executionScope?.remainingLiveBytes ?? ctx.limits.maxLiveBytes;
        const afterOverhead = available - overhead;
        // The memory maximum is reserved up front because a guest can grow
        // without another host call. Keep room for a file buffer, a replacement
        // buffer, and retained stdout/stderr within the same live-byte budget.
        const outputLimit = Math.min(
          ctx.limits.maxOutputSize,
          ctx.limits.maxStringLength,
        );
        const ioHeadroom = Math.max(
          RPC_BYTES,
          Math.floor(
            Math.min(afterOverhead / 2, limits.maxFileBytes * 2 + outputLimit),
          ),
        );
        limits.maxMemoryBytes =
          Math.floor(
            Math.min(limits.maxMemoryBytes, afterOverhead - ioHeadroom) / 65536,
          ) * 65536;
        if (limits.maxMemoryBytes < 65536)
          throw new Error("Insufficient live byte budget for WASI memory");
        lease = ctx.executionScope?.reserveBytes(
          overhead + limits.maxMemoryBytes,
          "WASI worker",
        );
        buffer = new _SharedArrayBuffer(HEADER_BYTES + RPC_BYTES);
        worker = createWorker(options, ctx);
        unlisten = worker.listen(
          (message) => {
            try {
              onMessage(message);
            } catch (error) {
              fail(error);
            }
          },
          () => {
            if (!ended) void finish(126, "WASI worker failed");
          },
        );
        worker.postMessage({
          // Own exactly the supplied view, then transfer it without detaching
          // the caller's bytes or cloning a larger backing buffer.
          wasm: new Uint8Array(loaded),
          args: argv,
          env,
          cwd: ctx.cwd,
          adapter: options.adapter,
          buffer,
          limits,
        });
      };
      void startup().catch(fail);
    } catch (error) {
      fail(error);
    }
  });
}
