import { ExecutionAbortedError } from "./interpreter/errors.js";

export interface CombinedAbortSignal {
  signal: AbortSignal | undefined;
  cleanup(): void;
}

/**
 * Compose abort signals without relying on AbortSignal.any(), which is not
 * available in every supported runtime. The first abort reason wins and all
 * listeners are removable by the caller's finally block.
 */
export function combineAbortSignals(
  ...signals: Array<AbortSignal | undefined>
): CombinedAbortSignal {
  const uniqueSignals = [
    ...new Set(
      signals.filter((signal): signal is AbortSignal => signal !== undefined),
    ),
  ];
  if (uniqueSignals.length === 0) {
    return { signal: undefined, cleanup() {} };
  }
  if (uniqueSignals.length === 1) {
    return { signal: uniqueSignals[0], cleanup() {} };
  }

  const controller = new AbortController();
  const listeners: Array<readonly [AbortSignal, () => void]> = [];

  for (const signal of uniqueSignals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    listeners.push([signal, onAbort]);
  }

  return {
    signal: controller.signal,
    cleanup() {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener("abort", listener);
      }
    },
  };
}

/**
 * Wait for host work that cannot observe cancellation, giving up when `signal`
 * aborts.
 *
 * A cancelled invocation must not keep waiting for uncancellable host work: its
 * caller bounds how long it waits for a command to unwind, and a command that is
 * still resolving has nothing to unwind. The abandoned work stays observed, and
 * the abort listener is removed on both paths.
 */
export async function raceCancellation<T>(
  work: Promise<T>,
  signal: AbortSignal | undefined,
  cancellationMessage: string,
): Promise<T> {
  if (!signal) return work;
  if (signal.aborted) {
    // Work handed over by an already-cancelled invocation is nobody else's to
    // await, so keep its settlement observed here.
    work.catch(() => undefined);
    throw new ExecutionAbortedError("", cancellationMessage);
  }

  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        onAbort = () =>
          reject(new ExecutionAbortedError("", cancellationMessage));
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
