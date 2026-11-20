/**
 * SECURITY: Pre-captured references to dangerous globals.
 *
 * These are captured at module load time (before defense-in-depth patches)
 * so that just-bash infrastructure can use them. They bypass all defense
 * protections.
 *
 * DO NOT import these from command implementations unless absolutely
 * necessary (e.g., Python WASM worker IPC). Any import from this module
 * should be reviewed for security implications.
 */
export const _SharedArrayBuffer: typeof globalThis.SharedArrayBuffer =
  globalThis.SharedArrayBuffer;
export const _Atomics: typeof globalThis.Atomics = globalThis.Atomics;
export const _performanceNow: () => number = performance.now.bind(performance);
export const _Headers: typeof globalThis.Headers = globalThis.Headers;
/** Internal capability revocation; never expose this constructor to commands. */
export const _Proxy: ProxyConstructor = globalThis.Proxy;
/**
 * Intrinsic promise settlement for infrastructure that must keep observing a
 * promise after the execution that created it has ended. The patched
 * `Promise.prototype.then` blocks registered callbacks once an execution is
 * deactivated, and calling a caller-supplied `then` would run that caller's code
 * with the privileges of whatever registered it.
 */
export const _promiseThen: typeof Promise.prototype.then =
  Promise.prototype.then;
