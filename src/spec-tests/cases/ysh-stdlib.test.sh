# spec/ysh-stdlib

## our_shell: ysh

#### smoke test for two.sh

source --builtin osh/two.sh

log 'hi'

shopt --unset errexit
forkwait { die "bad" }
echo status=$?

## STDOUT:
status=1
## END

#### smoke test for stream.ysh and table.ysh 

source $LIB_YSH/stream.ysh
source $LIB_YSH/table.ysh

## status: 0

