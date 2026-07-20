/**
 * Pre-captured global references.
 *
 * Defense-in-depth replaces dangerous globals with blocking proxies during
 * bash execution. These pre-captured references are taken at module load
 * time (before defense patches are applied) so that just-bash's own
 * infrastructure can use them safely.
 *
 * IMPORTANT: This module must be imported eagerly (at Bash construction time),
 * not lazily during exec(), to ensure the capture happens before patching.
 */
import { DefenseInDepthBox } from "./security/defense-in-depth-box.js";

const nativeSetTimeout = globalThis.setTimeout.bind(globalThis);
const nativeClearTimeout = globalThis.clearTimeout.bind(globalThis);
const nativeSetInterval = globalThis.setInterval.bind(globalThis);
const nativeClearInterval = globalThis.clearInterval.bind(globalThis);

type TimerCallback = (...args: unknown[]) => unknown;

function bindTimerCallback<T>(callback: T): T {
  if (typeof callback !== "function") return callback;
  return DefenseInDepthBox.bindCurrentContext(callback as TimerCallback) as T;
}

export const _setTimeout: typeof globalThis.setTimeout = ((
  callback: Parameters<typeof globalThis.setTimeout>[0],
  delay?: number,
  ...args: unknown[]
) => {
  return nativeSetTimeout(bindTimerCallback(callback), delay, ...args);
}) as typeof globalThis.setTimeout;

export const _clearTimeout: typeof globalThis.clearTimeout = nativeClearTimeout;

const MAX_NATIVE_TIMEOUT_MS = 2_147_483_647;

export interface FiniteTimeoutHandle {
  cleared: boolean;
  remainingMs: number;
  timer: ReturnType<typeof globalThis.setTimeout> | undefined;
}

/**
 * Schedule a configured deadline without overflowing the host timer. Positive
 * Infinity means no deadline; longer finite delays are advanced in native-safe
 * chunks so they retain their actual duration.
 */
export function _setTimeoutIfFinite(
  callback: Parameters<typeof globalThis.setTimeout>[0],
  delay: number,
): FiniteTimeoutHandle | undefined {
  if (delay === Number.POSITIVE_INFINITY) return undefined;
  const boundCallback = bindTimerCallback(callback) as () => void;
  const handle: FiniteTimeoutHandle = {
    cleared: false,
    remainingMs: Math.max(0, delay),
    timer: undefined,
  };
  const schedule = (): void => {
    if (handle.cleared) return;
    const chunk = Math.min(handle.remainingMs, MAX_NATIVE_TIMEOUT_MS);
    handle.timer = nativeSetTimeout(() => {
      if (handle.cleared) return;
      handle.remainingMs -= chunk;
      if (handle.remainingMs > 0) schedule();
      else boundCallback();
    }, chunk);
  };
  schedule();
  return handle;
}

export function _clearFiniteTimeout(
  handle: FiniteTimeoutHandle | undefined,
): void {
  if (!handle) return;
  handle.cleared = true;
  if (handle.timer !== undefined) nativeClearTimeout(handle.timer);
}

export const _setInterval: typeof globalThis.setInterval = ((
  callback: Parameters<typeof globalThis.setInterval>[0],
  delay?: number,
  ...args: unknown[]
) => {
  return nativeSetInterval(bindTimerCallback(callback), delay, ...args);
}) as typeof globalThis.setInterval;

export const _clearInterval: typeof globalThis.clearInterval =
  nativeClearInterval;

// _SharedArrayBuffer, _Atomics, _performanceNow moved to security/trusted-globals.ts
