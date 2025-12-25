## oils_failures_allowed: 4

#### ${x|html}
x='echo hi 2>&1'
echo "${x|html}"
## STDOUT:
echo hi 2&gt;&amp;1
## END

#### ${x %05d}
x=3
printf '%05d\n' "$x"
echo ${x %05d}
## STDOUT:
00003
00003
## END

#### ${.myproc builtin sub}

proc myproc() {
  echo "$@"
}

echo ${.myproc builtin sub}
## STDOUT:
builtin sub
## END

#### $[x] with _ESCAPER
shopt --set oil:upgrade

x='echo hi 2>&1'

shvar _ESCAPER=html {
  echo "code $[x]"
}

# No _ESCAPER: fatal error
echo "code $[x]"

## STDOUT:
code echo hi 2&gt;&amp;1
## END

