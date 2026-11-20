---
"just-bash": patch
---

browser: stop importing `node:zlib` from the browser bundle

`dist/bundle/browser.js` kept two static `node:zlib` imports, so browser bundlers failed to resolve them and every app importing `just-bash/browser` failed to build. The browser build now aliases `node:zlib` to a shim. `gzip`, `gunzip`, `zcat` and `rg -z` report an error at runtime, and every other command keeps working.
