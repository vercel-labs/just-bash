## our_shell: ysh
## oils_failures_allowed: 0

#### YSH doesn't respect LC_COLLATE for bash/zsh glob sort order

touch hello-test.sh hello_preamble.sh

# test/spec-common.sh sets LC_ALL=C.UTF_8
# BUG: YSH shouldn't have 'unset' either!
# unset LC_ALL
setglobal ENV.LC_ALL = ''

# TODO: need erase()
#call ENV->erase('LC_ALL')

bash -c 'echo bash hello*'

setglobal ENV.LC_COLLATE = 'en_US.UTF-8'
#env | grep LC_
echo '--- set LC_COLLATE to en_US'

# YSH
$[ENV.SH] -c 'echo "ysh " hello*'

if true; then
  bash -c 'echo "bash" hello*'
  #zsh  -c 'echo "zsh " hello*'
fi

## STDOUT:
bash hello-test.sh hello_preamble.sh
--- set LC_COLLATE to en_US
ysh  hello-test.sh hello_preamble.sh
bash hello_preamble.sh hello-test.sh
## END

