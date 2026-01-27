import { g as getDefaultExportFromCjs } from "../_chunks/_libs/ms.mjs";
import { r as requireAmdefine } from "./amdefine.mjs";
var main = { exports: {} };
main.exports;
var hasRequiredMain;
function requireMain() {
  if (hasRequiredMain) return main.exports;
  hasRequiredMain = 1;
  (function(module) {
    if (typeof define !== "function") {
      var define = /* @__PURE__ */ requireAmdefine()(module);
    }
    define(["./lib/freeze", "./lib/BitStream", "./lib/Stream", "./lib/BWT", "./lib/Context1Model", "./lib/DefSumModel", "./lib/FenwickModel", "./lib/MTFModel", "./lib/NoModel", "./lib/Huffman", "./lib/RangeCoder", "./lib/BWTC", "./lib/Bzip2", "./lib/Dmc", "./lib/Lzjb", "./lib/LzjbR", "./lib/Lzp3", "./lib/PPM", "./lib/Simple"], function(freeze, BitStream, Stream, BWT, Context1Model, DefSumModel, FenwickModel, MTFModel, NoModel, Huffman, RangeCoder, BWTC, Bzip2, Dmc, Lzjb, LzjbR, Lzp3, PPM, Simple) {
      return freeze({
        version: "0.0.1",
        // APIs
        BitStream,
        Stream,
        // transforms
        BWT,
        // models and coder
        Context1Model,
        DefSumModel,
        FenwickModel,
        MTFModel,
        NoModel,
        Huffman,
        RangeCoder,
        // compression methods
        BWTC,
        Bzip2,
        Dmc,
        Lzjb,
        LzjbR,
        Lzp3,
        PPM,
        Simple
      });
    });
  })(main);
  return main.exports;
}
var mainExports = /* @__PURE__ */ requireMain();
const Ae = /* @__PURE__ */ getDefaultExportFromCjs(mainExports);
export {
  Ae as A
};
