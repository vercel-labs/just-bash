## compare_shells: bash dash mksh ash

# OSH mechanisms:
#
# - shopt -s strict_errexit 
# - shopt -s command_sub_errexit
# - inherit_errexit (bash)
#
# Summary:
# - local assignment is different than global!  The exit code and errexit
#   behavior are different because the concept of the "last command" is
#   different.
# - ash has copied bash behavior!

#### command sub: errexit is NOT inherited and outer shell keeps going

# This is the bash-specific bug here:
# https://blogs.janestreet.com/when-bash-scripts-bite/
# See inherit_errexit below.
#
# I remember finding a script that relies on bash's bad behavior, so OSH copies
# it.  But you can opt in to better behavior.

set -o errexit
echo $(echo one; false; echo two)  # bash/ash keep going
echo parent status=$?
## STDOUT:
one two
parent status=0
## END
# dash and mksh: inner shell aborts, but outer one keeps going!
## OK dash/mksh STDOUT:
one
parent status=0
## END

#### command sub with inherit_errexit only
set -o errexit
shopt -s inherit_errexit || true
echo zero
echo $(echo one; false; echo two)  # bash/ash keep going
echo parent status=$?
## STDOUT:
zero
one
parent status=0
## END
## N-I ash STDOUT:
zero
one two
parent status=0
## END

#### strict_errexit and assignment builtins (local, export, readonly ...)
set -o errexit
shopt -s strict_errexit || true
#shopt -s command_sub_errexit || true

f() {
  local x=$(echo hi; false)
  echo x=$x
}

eval 'f'
echo ---

## status: 1
## STDOUT:
## END
## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
x=hi
---
## END

#### strict_errexit and command sub in export / readonly
case $SH in dash|bash|mksh|ash) exit ;; esac

$SH -o errexit -O strict_errexit -c 'echo a; export x=$(might-fail); echo b'
echo status=$?
$SH -o errexit -O strict_errexit -c 'echo a; readonly x=$(might-fail); echo b'
echo status=$?
$SH -o errexit -O strict_errexit -c 'echo a; x=$(true); echo b'
echo status=$?

## STDOUT:
a
status=1
a
status=1
a
b
status=0
## END
## N-I dash/bash/mksh/ash stdout-json: ""


#### strict_errexit disallows pipeline
set -o errexit
shopt -s strict_errexit || true

if echo 1 | grep 1; then
  echo one
fi

## status: 1
## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
1
one
## END

#### strict_errexit allows singleton pipeline
set -o errexit
shopt -s strict_errexit || true

if ! false; then
  echo yes
fi

## STDOUT:
yes
## END

#### strict_errexit with && || !
set -o errexit
shopt -s strict_errexit || true

if true && true; then
  echo A
fi

if true || false; then
  echo B
fi

if ! false && ! false; then
  echo C
fi

## STDOUT:
A
B
C
## END

#### strict_errexit detects proc in && || !
set -o errexit
shopt -s strict_errexit || true

myfunc() {
  echo 'failing'
  false
  echo 'should not get here'
}

if true && ! myfunc; then
  echo B
fi

if ! myfunc; then
  echo A
fi

## status: 1
## STDOUT:
## END

# POSIX shell behavior:

## OK bash/dash/mksh/ash status: 0
## OK bash/dash/mksh/ash STDOUT:
failing
should not get here
failing
should not get here
## END



#### strict_errexit without errexit proc
myproc() {
  echo myproc
}
myproc || true

# This should be a no-op I guess
shopt -s strict_errexit || true
myproc || true

## status: 1
## STDOUT:
myproc
## END
## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
myproc
myproc
## END

#### strict_errexit without errexit proc / command sub

# Implementation quirk:
# - The proc check happens only if errexit WAS on and is disabled
# - But 'shopt --unset allow_csub_psub' happens if it was never on

shopt -s strict_errexit || true

p() {
  echo before
  local x
  # This line fails, which is a bit weird, but errexit
  x=$(false)
  echo x=$x
}

if p; then
  echo ok
fi

## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
before
x=
ok
## END
## status: 1
## STDOUT:
## END

#### strict_errexit and errexit disabled
case $SH in dash|bash|mksh|ash) exit ;; esac

shopt -s parse_brace strict_errexit || true

p() {
  echo before
  local x
  # This line fails, which is a bit weird, but errexit
  x=$(false)
  echo x=$x
}

set -o errexit
shopt --unset errexit {
  # It runs normally here, because errexit was disabled (just not by a
  # conditional)
  p
}
## N-I dash/bash/mksh/ash STDOUT:
## END
## STDOUT:
before
x=
## END


#### command sub with command_sub_errexit only
set -o errexit
shopt -s command_sub_errexit || true
echo zero
echo $(echo one; false; echo two)  # bash/ash keep going
echo parent status=$?
## STDOUT:
zero
one two
parent status=0
## END
## N-I dash/mksh STDOUT:
zero
one
parent status=0
## END

#### command_sub_errexit stops at first error
case $SH in dash|bash|mksh|ash) exit ;; esac

set -o errexit
shopt --set parse_brace command_sub_errexit verbose_errexit || true

rm -f BAD

try {
  echo $(date %d) $(touch BAD)
}
if ! test -f BAD; then  # should not exist
  echo OK
fi

## STDOUT:
OK
## END
## N-I dash/bash/mksh/ash STDOUT:
## END

#### command sub with inherit_errexit and command_sub_errexit
set -o errexit

# bash implements inherit_errexit, but it's not as strict as OSH.
shopt -s inherit_errexit || true
shopt -s command_sub_errexit || true
echo zero
echo $(echo one; false; echo two)  # bash/ash keep going
echo parent status=$?
## STDOUT:
zero
## END
## status: 1
## N-I dash/mksh/bash status: 0
## N-I dash/mksh/bash STDOUT:
zero
one
parent status=0
## END
## N-I ash status: 0
## N-I ash STDOUT:
zero
one two
parent status=0
## END

#### command sub: last command fails but keeps going and exit code is 0
set -o errexit
echo $(echo one; false)  # we lost the exit code
echo status=$?
## STDOUT:
one
status=0
## END

#### global assignment with command sub: middle command fails
set -o errexit
s=$(echo one; false; echo two;)
echo "$s"
## status: 0
## STDOUT:
one
two
## END
# dash and mksh: whole thing aborts!
## OK dash/mksh stdout-json: ""
## OK dash/mksh status: 1

#### global assignment with command sub: last command fails and it aborts
set -o errexit
s=$(echo one; false)
echo status=$?
## stdout-json: ""
## status: 1

#### local: middle command fails and keeps going
set -o errexit
f() {
  echo good
  local x=$(echo one; false; echo two)
  echo status=$?
  echo $x
}
f
## STDOUT:
good
status=0
one two
## END
# for dash and mksh, the INNER shell aborts, but the outer one keeps going!
## OK dash/mksh STDOUT:
good
status=0
one
## END

#### local: last command fails and also keeps going
set -o errexit
f() {
  echo good
  local x=$(echo one; false)
  echo status=$?
  echo $x
}
f
## STDOUT:
good
status=0
one
## END

#### local and inherit_errexit / command_sub_errexit
# I've run into this problem a lot.
set -o errexit
shopt -s inherit_errexit || true  # bash option
shopt -s command_sub_errexit || true  # oil option
f() {
  echo good
  local x=$(echo one; false; echo two)
  echo status=$?
  echo $x
}
f
## status: 1
## STDOUT:
good
## END
## N-I ash status: 0
## N-I ash STDOUT:
good
status=0
one two
## END
## N-I bash/dash/mksh status: 0
## N-I bash/dash/mksh STDOUT:
good
status=0
one
## END

#### global assignment when last status is failure
# this is a bug I introduced
set -o errexit
x=$(false) || true   # from abuild
[ -n "$APORTSDIR" ] && true
BUILDDIR=${_BUILDDIR-$BUILDDIR}
echo status=$?
## STDOUT:
status=0
## END

#### strict_errexit prevents errexit from being disabled in function
set -o errexit
fun() { echo fun; }

fun || true  # this is OK

shopt -s strict_errexit || true

echo 'builtin ok' || true
env echo 'external ok' || true

fun || true  # this fails

## status: 1
## STDOUT:
fun
builtin ok
external ok
## END
## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
fun
builtin ok
external ok
fun
## END

#### strict_errexit prevents errexit from being disabled in brace group
set -o errexit
# false failure is NOT respected either way
{ echo foo; false; echo bar; } || echo "failed"

shopt -s strict_errexit || true
{ echo foo; false; echo bar; } || echo "failed"
## status: 1
## STDOUT:
foo
bar
## END

## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
foo
bar
foo
bar
## END

#### strict_errexit prevents errexit from being disabled in subshell
set -o errexit
shopt -s inherit_errexit || true

# false failure is NOT respected either way
( echo foo; false; echo bar; ) || echo "failed"

shopt -s strict_errexit || true
( echo foo; false; echo bar; ) || echo "failed"
## status: 1
## STDOUT:
foo
bar
## END

## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
foo
bar
foo
bar
## END

#### strict_errexit and ! && || if while until
prelude='set -o errexit
shopt -s strict_errexit || true
fun() { echo fun; }'

$SH -c "$prelude; ! fun; echo 'should not get here'"
echo bang=$?
echo --

$SH -c "$prelude; fun || true"
echo or=$?
echo --

$SH -c "$prelude; fun && true"
echo and=$?
echo --

$SH -c "$prelude; if fun; then true; fi"
echo if=$?
echo --

$SH -c "$prelude; while fun; do echo while; exit; done"
echo while=$?
echo --

$SH -c "$prelude; until fun; do echo until; exit; done"
echo until=$?
echo --


## STDOUT:
bang=1
--
or=1
--
and=1
--
if=1
--
while=1
--
until=1
--
## END
## N-I dash/bash/mksh/ash STDOUT:
fun
should not get here
bang=0
--
fun
or=0
--
fun
and=0
--
fun
if=0
--
fun
while
while=0
--
fun
until=0
--
## END

#### if pipeline doesn't fail fatally
set -o errexit
set -o pipefail

f() {
  local dir=$1
	if ls $dir | grep ''; then
    echo foo
		echo ${PIPESTATUS[@]}
	fi
}
rmdir $TMP/_tmp || true
rm -f $TMP/*
f $TMP
f /nonexistent # should fail
echo done

## N-I dash status: 2
## N-I dash stdout-json: ""
## STDOUT:
done
## END

#### errexit is silent (verbose_errexit for Oils)
shopt -u verbose_errexit 2>/dev/null || true
set -e
false
## stderr-json: ""
## status: 1

#### command sub errexit preserves exit code
set -e
shopt -s command_sub_errexit || true

echo before
echo $(exit 42)
echo after
## STDOUT:
before
## END
## status: 42
## N-I dash/bash/mksh/ash STDOUT:
before

after
## N-I dash/bash/mksh/ash status: 0

#### What's in strict:all?

# inherit_errexit, strict_errexit, but not command_sub_errexit!
# for that you need oil:upgrade!

set -o errexit
shopt -s strict:all || true

# inherit_errexit is bash compatible, so we have it
#echo $(date %x)

# command_sub_errexit would hide errors!
f() {
  local d=$(date %x)
}
f

deploy_func() {
  echo one
  false
  echo two
}

if ! deploy_func; then
  echo failed
fi

echo 'should not get here'

## status: 1
## STDOUT:
## END
## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
one
two
should not get here
## END

#### command_sub_errexit causes local d=$(date %x) to fail
set -o errexit
shopt -s inherit_errexit || true
#shopt -s strict_errexit || true
shopt -s command_sub_errexit || true

myproc() {
  # this is disallowed because we want a runtime error 100% of the time
  local x=$(true)

  # Realistic example.  Should fail here but shells don't!
  local d=$(date %x)
  echo hi
}
myproc

## status: 1
## STDOUT:
## END
## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
hi
## END

#### command_sub_errexit and command sub in array
case $SH in dash|ash|mksh) exit ;; esac

set -o errexit
shopt -s inherit_errexit || true
#shopt -s strict_errexit || true
shopt -s command_sub_errexit || true

# We don't want silent failure here
readonly -a myarray=( one "$(date %x)" two )

#echo len=${#myarray[@]}
argv.py "${myarray[@]}"
## status: 1
## STDOUT:
## END
## N-I bash status: 0
## N-I bash STDOUT:
['one', '', 'two']
## END
## N-I dash/ash/mksh status: 0

#### OLD: command sub in conditional, with inherit_errexit
set -o errexit
shopt -s inherit_errexit || true
if echo $(echo 1; false; echo 2); then
  echo A
fi
echo done

## STDOUT:
1 2
A
done
## END
## N-I dash/mksh STDOUT:
1
A
done
## END

#### OLD: command sub in redirect in conditional
set -o errexit

if echo tmp_contents > $(echo tmp); then
  echo 2
fi
cat tmp
## STDOUT:
2
tmp_contents
## END

#### Regression
case $SH in bash|dash|ash|mksh) exit ;; esac

shopt --set oil:upgrade

shopt --unset errexit {
  echo hi
}

proc p {
  echo p
}

shopt --unset errexit {
  p
}
## STDOUT:
hi
p
## END
## N-I bash/dash/ash/mksh stdout-json: ""

#### ShAssignment used as conditional

while x=$(false)
do   
  echo while
done

if x=$(false)
then
  echo if
fi

if x=$(true)
then
  echo yes
fi

# Same thing with errexit -- NOT affected
set -o errexit

while x=$(false)
do   
  echo while
done

if x=$(false)
then
  echo if
fi

if x=$(true)
then
  echo yes
fi

# Same thing with strict_errexit -- NOT affected
shopt -s strict_errexit || true

while x=$(false)
do   
  echo while
done

if x=$(false)
then
  echo if
fi

if x=$(true)
then
  echo yes
fi

## status: 1
## STDOUT:
yes
yes
## END
## N-I dash/bash/mksh/ash status: 0
## N-I dash/bash/mksh/ash STDOUT:
yes
yes
yes
## END
