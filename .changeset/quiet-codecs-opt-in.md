---
"just-bash": patch
---

Keep the native zstd and xz codecs opt-in so installing just-bash does not require approving their build scripts. Applications that use those tar compression formats can install `@mongodb-js/zstd` or `node-liblzma` explicitly.
