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
