---
"just-bash": patch
---

js-exec: fix Buffer shim correctness — ascii encode now uses & 0xff (not & 0x7f), consolidate latin1/ascii into shared \_rawEncode, fix Buffer.from(ArrayBuffer, offset, length), throw on invalid byteLength input, clamp negative toString start, throw RangeError for out-of-range write offset
