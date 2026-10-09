// Browser shim for node:zlib, aliased by the browser build. Browsers have no
// synchronous zlib, so gzip, gunzip, zcat and rg -z report an error at runtime
// instead of breaking the whole bundle at build time.
export const constants = Object.freeze({
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
});

function unavailable() {
  throw new Error("node:zlib is not available in browser environments");
}

export const gzipSync = unavailable;
export const gunzipSync = unavailable;
