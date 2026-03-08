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

export const _setInterval: typeof globalThis.setInterval = ((
  callback: Parameters<typeof globalThis.setInterval>[0],
  delay?: number,
  ...args: unknown[]
) => {
  return nativeSetInterval(bindTimerCallback(callback), delay, ...args);
}) as typeof globalThis.setInterval;

export const _clearInterval: typeof globalThis.clearInterval =
  nativeClearInterval;

export const _SharedArrayBuffer: typeof globalThis.SharedArrayBuffer =
  globalThis.SharedArrayBuffer;
export const _Atomics: typeof globalThis.Atomics = globalThis.Atomics;
export const _performanceNow: () => number = performance.now.bind(performance);
