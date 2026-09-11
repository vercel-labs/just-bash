---
"just-bash": patch
---

python3: name the program in tracebacks and run it in its own namespace

The program was pasted into the worker's wrapper script, so every traceback named `/tmp/_jb_script.py` at a line four hundred past the program's own, for `-c` code and script files alike, and the wrapper's helpers (`json`, `Path`, `_orig_open`, ...) sat in the program's globals. The program is now compiled under its own name (`<string>`, `<stdin>`, or the script path as typed) and run in a fresh `__main__` namespace, the wrapper's own frame is dropped from what is printed, `__file__` and `sys.path[0]` are set for a script file as CPython sets them (so a sibling module imports without a `/host` prefix), and `sys.exit("message")` prints the message before exiting 1.
