---
"just-bash": patch
---

python3: report a file over the size limit as EFBIG, and a read-only mount as EROFS

The worker's errno table had `EFBIG` as 27, which is `EINTR` under Emscripten's numbering (`EFBIG` is 22). CPython retries an `open()` that fails with `EINTR`, and each retry leaked the stream Emscripten had already allocated for the failed open, so reading a file over `maxStringLength` looped until the descriptor table was exhausted and the script died of `OSError: [Errno 33] No file descriptors available`, taking any later stdlib import with it. A read the bridge refused as too large for its buffer surfaced as `ENOENT`, and a write into a read-only mount as `EIO`; both now carry their own errno, so Python reports `File too large` and `Read-only file system`. `ENODATA` is corrected to 116 alongside.
