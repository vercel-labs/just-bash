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
export const _setTimeout: typeof globalThis.setTimeout = globalThis.setTimeout;
export const _clearTimeout: typeof globalThis.clearTimeout =
  globalThis.clearTimeout;
export const _SharedArrayBuffer: typeof globalThis.SharedArrayBuffer =
  globalThis.SharedArrayBuffer;
export const _Atomics: typeof globalThis.Atomics = globalThis.Atomics;
export const _performanceNow: () => number = performance.now.bind(performance);
