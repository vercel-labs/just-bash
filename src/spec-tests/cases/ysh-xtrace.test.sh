## oils_failures_allowed: 0

#### Customize PS4
shopt -s ysh:upgrade
set -x

# Reuse the default
PS4=$['$LINENO ' ++ PS4]
echo 1; echo 2
echo 3
## STDOUT:
1
2
3
## END
## STDERR:
5 . builtin echo 1
5 . builtin echo 2
6 . builtin echo 3
## END


#### no_xtrace_osh doesn't show [[ ]] etc.
shopt -s ysh:upgrade
set -x

dir=/
if [[ -d $dir ]]; then
  (( a = 42 ))
fi
cd /

## stdout-json: ""
## STDERR:
. builtin cd /
## END

#### no_xtrace_osh UNSET, and xtrace_rich set
shopt --set ysh:upgrade 
shopt --unset no_xtrace_osh
shopt --unset errexit
set -x

{
  env false
  set +x
} 2>err.txt

sed --regexp-extended 's/[[:digit:]]{2,}/12345/g' err.txt >&2

## STDOUT:
## END
## STDERR:
| command 12345: env 'false'
; process 12345: status 1
. builtin set '+x'
## END

#### proc and shell function
shopt --set ysh:upgrade
set -x

shfunc() {
  : $1
}

proc p (x) {
  : $x
}

shfunc 1
p 2
## stdout-json: ""
## STDERR:
> proc shfunc 1
  . builtin ':' 1
< proc shfunc
> proc p 2
  . builtin ':' 2
< proc p
## END

#### eval
shopt --set ysh:upgrade
set -x

eval 'echo 1; echo 2'
## STDOUT:
1
2
## END
## STDERR:
> eval
  . builtin echo 1
  . builtin echo 2
< eval
## END

#### source
echo 'echo "\$1 = $1"' > lib.sh

shopt --set ysh:upgrade
set -x

source lib.sh a b c

# Test the quoting style.  TODO: Don't use bash style in YSH.

source lib.sh x $'\xfe' $'\xff'

## STDOUT:
$1 = a
$1 = x
## END
## STDERR:
> source lib.sh a b c
  . builtin echo '$1 = a'
< source lib.sh
> source lib.sh x $'\xfe' $'\xff'
  . builtin echo '$1 = x'
< source lib.sh
## END

#### external and builtin
shopt --set ysh:upgrade
shopt --unset errexit
set -x

{
  env false
  true
  set +x
} 2>err.txt

# normalize PIDs, assumed to be 2 or more digits
sed --regexp-extended 's/[[:digit:]]{2,}/12345/g' err.txt >&2

## stdout-json: ""
## STDERR:
| command 12345: env 'false'
; process 12345: status 1
. builtin 'true'
. builtin set '+x'
## END

#### subshell
shopt --set ysh:upgrade
shopt --unset errexit
set -x

proc p {
  : p
}

{
  : begin
  ( 
    : 1
    p
    exit 3
  )
  set +x
} 2>err.txt

# Hack: sort for determinism
sed --regexp-extended 's/[[:digit:]]{2,}/12345/g' err.txt | LANG=C sort >&2

## stdout-json: ""
## STDERR:
    . 12345 builtin ':' p
  + 12345 exit 3
  . 12345 builtin ':' 1
  < 12345 proc p
  > 12345 proc p
. builtin ':' begin
. builtin set '+x'
; process 12345: status 3
| forkwait 12345
## END

#### command sub
shopt --set ysh:upgrade
set -x

{
  echo foo=$(echo bar)
  set +x

} 2>err.txt

# HACK: sort because xtrace output has non-determinism.
# This is arguably a bug -- see issue #995.
# The real fix might be to sys.stderr.flush() in few places?
sed --regexp-extended 's/[[:digit:]]{2,}/12345/g' err.txt | LANG=C sort >&2

## STDOUT:
foo=bar
## END
## STDERR:
  . 12345 builtin echo bar
. builtin echo 'foo=bar'
. builtin set '+x'
; process 12345: status 0
| command sub 12345
## END

#### process sub (nondeterministic)
shopt --set ysh:upgrade
shopt --unset errexit
set -x

# we wait() for them all at the end

{
  : begin
  tac <(seq 3 4) <(echo 1)
  set +x
} 2>err.txt

# SORT for determinism
sed --regexp-extended 's/[[:digit:]]{2,}/12345/g; s|/fd/.|/fd/N|g' err.txt |
  LC_ALL=C sort >&2
#cat err.txt >&2

## STDOUT:
4
3
1
## END

## STDERR:
  . 12345 builtin echo 1
  . 12345 exec seq 3 4
. builtin ':' begin
. builtin set '+x'
; process 12345: status 0
; process 12345: status 0
; process 12345: status 0
| command 12345: tac /dev/fd/N /dev/fd/N
| proc sub 12345
| proc sub 12345
## END

#### pipeline (nondeterministic)
shopt --set ysh:upgrade
set -x

myfunc() {
  echo 1
  echo 2
}

{
  : begin
  myfunc | sort | wc -l
  set +x
} 2>err.txt

do_sort=1

if test -n $do_sort; then
  # SORT for determinism
  sed --regexp-extended 's/[[:digit:]]{2,}/12345/g; s|/fd/.|/fd/N|g' err.txt | 
    LC_ALL=C sort >&2
else
  cat err.txt
fi

## STDOUT:
2
## END
## STDERR:
      . 12345 builtin echo 1
      . 12345 builtin echo 2
    . 12345 exec sort
    < 12345 proc myfunc
    > 12345 proc myfunc
  ; process 12345: status 0
  ; process 12345: status 0
  ; process 12345: status 0
  | command 12345: wc -l
  | part 12345
  | part 12345
. builtin ':' begin
. builtin set '+x'
< pipeline
> pipeline
## END

#### singleton pipeline

# Hm extra tracing

shopt --set ysh:upgrade
set -x

: begin
! false
: end

## stdout-json: ""
## STDERR:
. builtin ':' begin
. builtin 'false'
. builtin ':' end
## END

#### Background pipeline (separate code path)

shopt --set ysh:upgrade
shopt --unset errexit
set -x

myfunc() {
  echo 2
  echo 1
}

{
	: begin
	myfunc | sort | grep ZZZ &
	wait
	echo status=$?
  set +x
} 2>err.txt

# SORT for determinism
sed --regexp-extended 's/[[:digit:]]{2,}/12345/g' err.txt |
  LC_ALL=C sort >&2

## STDOUT:
status=0
## END
## STDERR:
    . 12345 builtin echo 1
    . 12345 builtin echo 2
  . 12345 exec grep ZZZ
  . 12345 exec sort
  ; process 12345: status 0
  ; process 12345: status 0
  ; process 12345: status 1
  < 12345 proc myfunc
  > 12345 proc myfunc
. builtin ':' begin
. builtin echo 'status=0'
. builtin set '+x'
< wait
> wait
| part 12345
| part 12345
| part 12345
## END

#### Background process with fork and & (nondeterministic)
shopt --set ysh:upgrade
set -x

{
  sleep 0.1 &
  wait

  shopt -s ysh:upgrade

  fork {
    sleep 0.1
  }
  wait
  set +x
} 2>err.txt

# SORT for determinism
sed --regexp-extended 's/[[:digit:]]{2,}/12345/g' err.txt |
  LC_ALL=C sort >&2

## stdout-json: ""
## STDERR:
  . 12345 exec sleep 0.1
  . 12345 exec sleep 0.1
  ; process 12345: status 0
  ; process 12345: status 0
. builtin fork
. builtin set '+x'
. builtin shopt -s 'ysh:upgrade'
< wait
< wait
> wait
> wait
| fork 12345
| fork 12345
## END

# others: redirects?

#### Here doc
shopt --set ysh:upgrade
shopt --unset errexit
set -x

{
  : begin
  tac <<EOF
3
2
EOF

  set +x
} 2>err.txt

sed --regexp-extended 's/[[:digit:]]{2,}/12345/g' err.txt >&2

## STDOUT:
2
3
## END
## STDERR:
. builtin ':' begin
| command 12345: tac
; process 12345: status 0
. builtin set '+x'
## END

#### Two here docs

# BUG: This trace shows an extra process?

shopt --set ysh:upgrade
shopt --unset errexit
set -x

{
  tac - /dev/fd/3 <<EOF 3<<EOF2
xx
yy
EOF
zz
EOF2

  set +x
} 2>err.txt

sed --regexp-extended 's/[[:digit:]]{2,}/12345/g' err.txt >&2

## STDOUT:
yy
xx
zz
## END
## STDERR:
| command 12345: tac - /dev/fd/3
; process 12345: status 0
. builtin set '+x'
## END

#### Here doc greater than 4096 bytes

{
  echo 'wc -l <<EOF'
  seq 2000
  echo 'EOF'
} > big-here.sh

wc -l big-here.sh

$SH -o ysh:upgrade -x big-here.sh 2>err.txt

sed --regexp-extended 's/[[:digit:]]{2,}/12345/g' err.txt >&2

## STDOUT:
2002 big-here.sh
2000
## END
## STDERR:
| here doc 12345
| command 12345: wc -l
; process 12345: status 0
; process 12345: status 0
## END

#### Control Flow
shopt --set ysh:upgrade
set -x

for i in 1 2 3 {
  echo $i
  if (i === '2') {
    break
  }
}

for j in a b {
  for k in y z {
    echo $j $k
    if (k === 'y') {
      continue
    }
  }
}

proc zero {
  return 0
}

proc one {
  return 1
}

zero
# one

## STDOUT:
1
2
a y
a z
b y
b z
## END
## STDERR:
. builtin echo 1
. builtin echo 2
+ break 1
. builtin echo a y
+ continue 1
. builtin echo a z
. builtin echo b y
+ continue 1
. builtin echo b z
> proc zero
  + return 0
< proc zero
## END

#### use builtin and invokable module
shopt --set ysh:upgrade

# make the trace deterministic
cp $REPO_ROOT/spec/testdata/module2/for-xtrace.ysh .

set -x

source for-xtrace.ysh
echo

# problem with PS4 here
use for-xtrace.ysh # --all-provided

for-xtrace increment foo bar

## STDOUT:
[for-xtrace]
counter = 5

[for-xtrace]
counter = 5
counter = 6
## END

## STDERR:
> source for-xtrace.ysh
  . builtin echo '[for-xtrace]'
  > proc increment
    . builtin echo 'counter = 5'
  < proc increment
< source for-xtrace.ysh
. builtin echo
> use for-xtrace.ysh
  . builtin echo '[for-xtrace]'
  > proc increment
    . builtin echo 'counter = 5'
  < proc increment
< use for-xtrace.ysh
> module-invoke for-xtrace increment foo bar
  . builtin echo 'counter = 6'
< module-invoke for-xtrace
## END

#### Encoded argv uses shell encoding, not J8

shopt --set ysh:upgrade
set -x

echo $'one two\n' $'\u03bc'
## STDOUT:
one two
 μ
## END
## STDERR:
. builtin echo $'one two\n' 'μ'
## END
