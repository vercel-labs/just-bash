import require$$1 from "util";
import require$$1$1 from "util/types";
var lib = {};
var hasRequiredLib;
function requireLib() {
  if (hasRequiredLib) return lib;
  hasRequiredLib = 1;
  const { promisify } = require$$1;
  const { isUint8Array } = require$$1$1;
  function load() {
    try {
      return require("../build/Release/zstd.node");
    } catch {
      try {
        return require("../build/Debug/zstd.node");
      } catch (error) {
        throw error;
      }
    }
  }
  const zstd = load();
  const _compress = promisify(zstd.compress);
  const _decompress = promisify(zstd.decompress);
  lib.compress = async function compress(data, compressionLevel) {
    if (!isUint8Array(data)) {
      throw new TypeError(`parameter 'data' must be a Uint8Array.`);
    }
    if (compressionLevel != null && typeof compressionLevel !== "number") {
      throw new TypeError(`parameter 'compressionLevel' must be a number.`);
    }
    try {
      return await _compress(data, compressionLevel ?? 3);
    } catch (e) {
      throw new Error(`zstd: ${e.message}`);
    }
  };
  lib.decompress = async function decompress(data) {
    if (!isUint8Array(data)) {
      throw new TypeError(`parameter 'data' must be a Uint8Array.`);
    }
    try {
      return await _decompress(data);
    } catch (e) {
      throw new Error(`zstd: ${e.message}`);
    }
  };
  lib.getDefinedNapiVersion = zstd.getDefinedNapiVersion;
  return lib;
}
var libExports = /* @__PURE__ */ requireLib();
export {
  libExports as l
};
