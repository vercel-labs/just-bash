import { utf8ByteLength } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { SecureFetchOptions } from "../../network/fetch.js";
import type { FetchResult } from "../../network/types.js";
import { _performanceNow } from "../../security/trusted-globals.js";
import { _clearTimeout, _setTimeout } from "../../timers.js";
import type { RuntimeCommandContext } from "../../types.js";
import type { CurlOptions } from "./types.js";

/** Retry only recognizable transport failures; never policy/FS/resource errors. */
export function curlTransportFailure(
  error: unknown,
): "timeout" | "network" | undefined {
  if (!(error instanceof Error)) return;
  if (error.name === "GuardedFetchError" && "code" in error) {
    if (error.code === "timeout") return "timeout";
    if (error.code === "network_error") {
      const cause = error.cause;
      return cause instanceof Error &&
        (cause.name === "AbortError" || cause.name === "TimeoutError")
        ? "timeout"
        : "network";
    }
    return;
  }
  if (error.name === "AbortError" || error.name === "TimeoutError")
    return "timeout";
  // A private RPC carries only the message. Match fixed native diagnostics,
  // never arbitrary policy text or URLs that happen to mention a timeout.
  if (
    /^(?:(?:The|This) operation was aborted(?: due to timeout)?|signal timed out)[.!]?$/i.test(
      error.message,
    )
  )
    return "timeout";
  if (
    /^(?:Failed to fetch|fetch failed|Network request failed|NetworkError when attempting to fetch resource\.)$/i.test(
      error.message,
    )
  )
    return "network";
}

function check(ctx: RuntimeCommandContext): void {
  ctx.executionScope?.throwIfAborted("curl");
  ctx.signal?.throwIfAborted();
  ctx.executionScope?.consumeWork(1, "curl");
}

async function retryDelay(
  ms: number,
  ctx: RuntimeCommandContext,
): Promise<void> {
  check(ctx);
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      ctx.signal?.removeEventListener("abort", abort);
      resolve();
    };
    const timer = _setTimeout(finish, ms);
    const abort = () => {
      _clearTimeout(timer);
      ctx.signal?.removeEventListener("abort", abort);
      reject(ctx.signal?.reason);
    };
    ctx.signal?.addEventListener("abort", abort, { once: true });
    if (ctx.signal?.aborted) abort();
  });
  check(ctx);
}

/** Curl's default transient HTTP set; 501/505 and policy rejection do not retry. */
const retryStatuses = new Set([408, 429, 500, 502, 503, 504]);

export async function transfer(
  url: string,
  request: SecureFetchOptions,
  options: CurlOptions,
  ctx: RuntimeCommandContext,
  onAttemptTime: (seconds: number) => void,
): Promise<{ result: FetchResult; timeTotal: number }> {
  const fetch = ctx.fetch;
  if (!fetch) throw new Error("curl fetch capability unavailable");
  ctx.executionScope?.consumeLimited(
    "curl retries",
    options.retry,
    ctx.limits.maxLoopIterations,
    "curl",
  );
  let inputBytes = 0;
  const consumeInput = (bytes: number) => {
    // Discarded responses and retransmitted payloads are still processed input.
    // In particular, --retry must not reset the execution-wide byte budget.
    ctx.executionScope?.consumeInput(bytes, "curl transfer");
    inputBytes += bytes;
    if (
      !Number.isSafeInteger(inputBytes) ||
      inputBytes > ctx.limits.maxInputBytes
    )
      throw new ExecutionLimitError(
        "curl: input size limit exceeded",
        "string_length",
      );
  };
  const requestBytes =
    typeof request.body === "string"
      ? utf8ByteLength(request.body)
      : (request.body?.byteLength ?? 0);
  for (let attempt = 0; ; attempt++) {
    check(ctx);
    consumeInput(requestBytes);
    const started = _performanceNow();
    try {
      const result = await fetch(url, {
        ...request,
        // Fetch does not expose the connection phase. Both flags bound the
        // complete request, including body consumption, capped again by host.
        timeoutMs:
          options.connectTimeoutMs === undefined
            ? options.timeoutMs
            : options.timeoutMs === undefined
              ? options.connectTimeoutMs
              : Math.min(options.timeoutMs, options.connectTimeoutMs),
      });
      check(ctx);
      consumeInput(result.body.byteLength);
      if (result.cookieJar !== undefined)
        consumeInput(utf8ByteLength(result.cookieJar));
      if (attempt >= options.retry || !retryStatuses.has(result.status)) {
        return {
          result,
          timeTotal: Math.max(0, _performanceNow() - started) / 1000,
        };
      }
    } catch (error) {
      check(ctx);
      rethrowFatalExecutionError(error);
      if (attempt >= options.retry || !curlTransportFailure(error)) throw error;
    } finally {
      // curl's time_total is the last attempt, including failures; retry sleep
      // and local filesystem work do not belong to the transfer duration.
      onAttemptTime(Math.max(0, _performanceNow() - started) / 1000);
    }
    // Retry is explicitly requested; stop/timeout of the enclosing shell can
    // interrupt the delay. No retries are enabled by the host or by default.
    await retryDelay(Math.min(600000, 1000 * 2 ** Math.min(attempt, 10)), ctx);
  }
}
