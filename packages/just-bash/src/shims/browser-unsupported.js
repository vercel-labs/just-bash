// Browser shim for Node-only builtins aliased by the browser build. Every
// corresponding use is behind a compile-time __BROWSER__ branch, so this
// module must remain inert and should never be called at runtime.
export const AsyncLocalStorage = undefined;
export const Module = undefined;

export function lookup() {
  throw new Error("node:dns is not available in browser environments");
}
