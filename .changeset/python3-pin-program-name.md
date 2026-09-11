---
"just-bash": patch
---

python3: name the interpreter `python3` rather than the worker's host path

Emscripten's Node glue takes the program name from `process.argv[1]`, which in a worker thread is `worker.js`'s absolute path on the host. CPython received it as `argv[0]` and as the `_` environment variable, so `sys.executable` and `os.environ['_']` disclosed the host install path to the guest, and the path's length shaped the initial heap: at some lengths (200 characters, which a pnpm store path with a patch hash lands on) `Py_FinalizeEx` aborted with `gilstate_tss_clear: failed to clear current tstate` after the program had run, and every `python3` invocation exited 1 with the right output. The module is now created with `thisProgram: "python3"`, so the guest sees `python3` and `sys.executable` is empty, as CPython reports for a program it cannot locate.
