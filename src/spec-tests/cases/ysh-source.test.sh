# spec/ysh-source

## oils_failures_allowed: 0

#### --builtin flag
shopt --set ysh:upgrade

source $LIB_YSH/math.ysh

json write (max(1, 2))
## STDOUT:
2
## END

#### no path passed with --builtin flag
shopt --set ysh:upgrade

source --builtin
## status: 2
## STDOUT:
## END

#### non-existent path passed to --builtin flag
shopt --set ysh:upgrade

source --builtin test/this-file-will-never-exist.ysh
## status: 1
## STDOUT:
## END
