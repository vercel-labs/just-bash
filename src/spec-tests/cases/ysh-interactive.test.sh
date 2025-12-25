## our_shell: ysh

#### yshrc
cat >$[ENV.TMP]/yshrc <<EOF
proc f {
  if ('foo') {
    echo yshrc
  }
}
f
EOF
$[ENV.SH] --rcfile $[ENV.TMP]/yshrc -i -c 'echo hello'
## STDOUT:
yshrc
hello
## END

#### YSH_HISTFILE

#export YSH_HISTFILE=myhist

# TODO: HISTFILE/YSH_HISTFILE should be looked up in ENV
setglobal ENV.YSH_HISTFILE = 'myhist'

rm -f myhist

echo 'echo 42
echo 43
echo 44' | $[ENV.SH] --norc -i 

cat myhist

## STDOUT:
42
43
44
^D
echo 42
echo 43
echo 44
## END
