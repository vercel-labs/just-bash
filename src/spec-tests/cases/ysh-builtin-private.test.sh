## compare_shells: bash
## oils_failures_allowed: 1

#### invoke usage
case $SH in bash) exit ;; esac

invoke
echo status=$?

invoke --
echo status=$?

echo

invoke sleep 0
echo status=$?

invoke -- sleep 0
echo status=$?

invoke --builtin -- sleep 0
echo status=$?

## STDOUT:
status=2
status=2

status=2
status=2
status=0
## END
## N-I bash STDOUT:
## END

#### invoke nonexistent name
case $SH in bash) exit ;; esac

invoke zz
echo status=$?

invoke --builtin zz
echo status=$?

invoke --builtin -- zz
echo status=$?

## STDOUT:
status=2
status=127
status=127
## END
## N-I bash STDOUT:
## END

#### invoke fails to find tools
case $SH in bash) exit ;; esac

invoke --builtin ls
echo status=$?

invoke --sh-func ls
echo status=$?

invoke --proc ls
echo status=$?

invoke --extern zzz
echo status=$?

## STDOUT:
status=127
status=127
status=127
status=127
## END
## N-I bash STDOUT:
## END

#### invoke --proc --sh-func --builtin --extern
case $SH in bash) exit ;; esac

true() {
  echo 'sh-func true'
}

shopt --set ysh:all

proc true {
  echo 'proc true'
}

# Now INVOKE each one

echo --sh-func
invoke --sh-func true
echo status=$?
echo

echo --proc
invoke --proc true
echo status=$?
echo

echo --builtin
invoke --builtin true --help || true
echo status=$?
echo

echo --extern
invoke --extern true
echo status=$?
echo

## STDOUT:
--sh-func
sh-func true
status=0

--proc
proc true
status=0

--builtin
status=0

--extern
status=0

## END
## N-I bash STDOUT:
## END

#### invoke --proc doesn't run shell functions
case $SH in bash) exit ;; esac

true() {
  echo sh-func true
}

invoke --proc true
echo status=$?

## STDOUT:
status=127
## END
## N-I bash STDOUT:
## END

#### type and command builtin don't find private sleep

remove-path() { sed 's;/.*/;;'; }

type -t sleep
type sleep | remove-path
echo

# this is meant to find the "first word"
type -a sleep | remove-path | uniq
echo

command -v sleep | remove-path

## STDOUT:
file
sleep is sleep

sleep is sleep

sleep
## END

#### but invoke --show finds the private builtin
case $SH in bash) exit ;; esac

invoke --show sleep | grep builtin

## STDOUT:
        sleep       builtin     private
## END

## N-I bash STDOUT:
## END

#### invoke --show with many types
case $SH in bash) exit ;; esac

shopt --unset no_osh_builtins  # for alias

# TODO: CRASH bug!
# use ///osh/bash-strict.sh

my-name() { echo sh-func; }

alias my-name=$'echo my \u03bc \xff alias'

mkdir -p dir
echo 'echo hi' > dir/my-name
chmod +x dir/my-name

# BUG:
# 1. we start with OSH, and initialize $PATH
# 2. then we mutate $PATH
# 3. shopt --set ysh:all
# 4. now we look at ENV.PATH, which isn't changed
PATH=$PWD/dir:$PATH
#echo $PATH

if false; then
  command -v my-name
  echo
  type -a my-name  #bash-strict
  echo
fi

shopt --set ysh:all

proc my-name { echo proc }

proc myInvoke { echo hi }
var methods = Obj.new({__invoke__: myInvoke})
var myobj = Obj.new({}, methods)

if false {
  type -a my-name  #bash-strict
  echo
}

invoke --show my-name myobj eval cd zzz | sed 's/#.qtt8/%.qtt8/'

## STDOUT:
%.qtt8  name        kind        detail
        my-name     alias       b'echo my μ \yff alias'
        my-name     proc        -
        my-name     sh-func     -
        myobj       proc        invokable
        eval        builtin     special
        cd          builtin     -
        zzz         -           -
## END

## N-I bash STDOUT:
## END


#### invoke --show does proper quoting
case $SH in bash) exit ;; esac

alias $'bad-alias=echo \xff\necho z'

bad-alias | od -A n -t x1

# sed hack for test framework bug
invoke --show bad-alias | sed 's/#.qtt8/%.qtt8/'

#alias $'bad=hi\xffname=echo hi'
#$'bad\xffname'

## STDOUT:
 ff 0a 7a 0a
%.qtt8  name        kind        detail
        bad-alias   alias       b'echo \yff\necho z'
## END

## N-I bash STDOUT:
## END

#### builtin sleep behaves like external sleep
case $SH in
  *osh) prefix='builtin' ;;
  *) prefix='' ;;
esac

$prefix sleep
if test "$?" != 0; then
  echo ok
fi

# This is different!  OSH is stricter
if false; then
$prefix sleep --
if test "$?" != 0; then
  echo ok
fi
fi

$prefix sleep -2
if test "$?" != 0; then
  echo ok
fi

$prefix sleep -- -2
if test "$?" != 0; then
  echo ok
fi

$prefix sleep zz
if test "$?" != 0; then
  echo ok
fi

$prefix sleep 0
echo status=$?

$prefix sleep -- 0
echo status=$?

$prefix sleep '0.0005'
echo status=$?

$prefix sleep '+0.0005'
echo status=$?

## STDOUT:
ok
ok
ok
ok
status=0
status=0
status=0
status=0
## END

#### builtin sleep usage errors
case $SH in bash) exit ;; esac

builtin sleep 0.5s
echo status=$?

builtin sleep 0.1 extra
echo status=$?

## STDOUT:
status=2
status=2
## END
## N-I bash STDOUT:
## END

#### sleep without prefix is still external

# should not work
builtin sleep --version
if test "$?" != '0'; then
  echo ok
fi

sleep --version | head -n 1 >& 2
echo status=$?

## STDOUT:
ok
status=0
## END

#### builtin cat 

case $SH in
  *osh) prefix='builtin' ;;
  *) prefix='' ;;
esac

seq 2 3 | $prefix cat
echo ---

# from file
#echo FOO > foo
#$prefix cat foo foo

## STDOUT:
2
3
---
## END

#### builtin cat usage
case $SH in
  *osh) prefix='builtin' ;;
  *) prefix='' ;;
esac

$prefix cat --bad >/dev/null
if test "$?" != 0; then
  echo ok
fi

$prefix cat -z
if test "$?" != 0; then
  echo ok
fi

seq 3 4 | $prefix cat --
echo status=$?

## STDOUT:
ok
ok
3
4
status=0
## END

#### builtin cat non nonexistent file
case $SH in
  *osh) prefix='builtin' ;;
  *) prefix='' ;;
esac

echo FOO > foo

$prefix cat foo nonexistent foo
echo status=$?

## STDOUT:
FOO
FOO
status=1
## END

#### builtin cat accept - for stdin
case $SH in
  *osh) prefix='builtin' ;;
  *) prefix='' ;;
esac

echo FOO > foo
seq 3 4 | $prefix cat foo - foo foo

echo ---

# second - is a no-op
seq 5 6 | $prefix cat - -

## STDOUT:
FOO
3
4
FOO
FOO
---
5
6
## END

#### builtin rm: usage, removing files
case $SH in
  *osh) prefix='builtin' ;;
  *) prefix='' ;;
esac

$prefix rm 
if test "$?" != 0; then echo ok; fi

$prefix rm --
if test "$?" != 0; then echo ok; fi

$prefix rm -- nonexistent
echo status=$?

touch foo bar
$prefix rm -- foo bar
echo status=$?

if test -f foo; then echo fail; fi
if test -f bar; then echo fail; fi

## STDOUT:
ok
ok
status=1
status=0
## END

#### builtin rm -f - ignores arguments that don't exist
case $SH in
  *osh) prefix='builtin' ;;
  *) prefix='' ;;
esac

touch foo bar
$prefix rm -- foo OOPS bar
echo status=$?

if test -f foo; then echo fail; fi
if test -f bar; then echo fail; fi

touch foo bar
$prefix rm -f -- foo OOPS bar
echo status=$?

if test -f foo; then echo fail; fi
if test -f bar; then echo fail; fi

## STDOUT:
status=1
status=0
## END

#### builtin rm -f - still fails when file can't be removed

mkdir read-only
touch read-only/stuck
chmod -w read-only
ls -l stuck

touch foo bar
$prefix rm -- read-only/stuck foo bar
echo status=$?

if test -f foo; then echo fail; fi
if test -f bar; then echo fail; fi

ls read-only/stuck

touch foo bar
$prefix rm -- read-only/stuck foo bar
echo status=$?

# Clean up for real
chmod +w read-only
$prefix rm -- read-only/stuck
echo status=$?

if test -f read-only/stuck; then echo fail; fi

## STDOUT:
status=1
read-only/stuck
status=1
status=0
## END

#### builtin rm -f allows empty arg list
case $SH in
  *osh) prefix='builtin' ;;
  *) prefix='' ;;
esac

$prefix rm -f
echo status=$?

## STDOUT:
status=0
## END

#### builtin rm always fails on directories (regardless of -f)
case $SH in
  *osh) prefix='builtin' ;;
  *) prefix='' ;;
esac

touch foo bar
mkdir -p tmp
$prefix rm -- foo tmp bar
echo status=$?

if test -f foo; then echo fail; fi
if test -f bar; then echo fail; fi

touch foo bar
mkdir -p tmp
$prefix rm -f -- foo tmp bar
echo status=$?

if test -f foo; then echo fail; fi
if test -f bar; then echo fail; fi

## STDOUT:
status=1
status=1
## END

#### builtin readlink
case $SH in bash) exit ;; esac

echo TODO

# turn this into a builtin
# does that mean any builtin can be externalized?
# - [ aka test is a good candiate
# - we have stubs from true/false

## STDOUT:
## END

## N-I bash STDOUT:
## END

#### compgen -A builtin doesn't find private builtins

compgen -A builtin slee
echo status=$?

## STDOUT:
status=1
## END
