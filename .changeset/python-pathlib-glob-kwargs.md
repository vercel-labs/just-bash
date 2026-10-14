---
"just-bash": patch
---

Forward keyword arguments through `Path.glob` and `Path.rglob` in `python3`, so `Path.rglob()` and `glob(..., case_sensitive=...)` no longer fail with `TypeError: _path_glob() got an unexpected keyword argument 'case_sensitive'`.
