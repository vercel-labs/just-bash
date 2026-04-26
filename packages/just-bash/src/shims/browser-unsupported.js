// Browser shim for node:dns — aliased by esbuild in the browser build.
// The DNS lookup is only used by denyPrivateRanges (a Node.js-only feature),
// so this shim is never called at runtime in browsers.
export function lookup() {
  throw new Error("node:dns is not available in browser environments");
}
