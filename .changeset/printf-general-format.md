---
"just-bash": patch
---

Format `%g` and `%e` like C in `printf` and `awk`. `printf '%g' 100000` now prints `100000` rather than `1`, `1e10` prints `1e+10` rather than `1e+01`, small values switch to exponent form below `1e-4` (`1e-05`), exponents are padded to two digits, and the `#` flag keeps the zeros and the decimal point. This also corrects the numbers `awk` prints through `OFMT`, such as `print 1e-10`.
