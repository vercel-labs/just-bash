---
"just-bash": patch
---

Honor `-A` in `local` and `readonly`. `local -A M` created a plain variable, so `M[alpha]=one` and `M[beta]=two` both wrote index 0 and every key read back the last value. `readonly -A X=([k]="a b c")` built an indexed array of the raw words. Both now create an associative array, and both refuse to convert an existing indexed array, as bash does.
