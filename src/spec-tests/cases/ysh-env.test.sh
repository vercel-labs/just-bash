## oils_failures_allowed: 0

#### Can read from ENV Obj
shopt -s ysh:upgrade

pp test_ (type(ENV))
#pp test_ (ENV)

# Set by the spec test harness

if (ENV.SH ~~ '*osh') {
  echo ok
}
#echo SH=$[ENV.SH]

## STDOUT:
(Str)   "Obj"
ok
## END

#### ENV works in different modules
shopt -s ysh:upgrade

setglobal ENV.PS4 = '%%% '

use $[ENV.REPO_ROOT]/spec/testdata/module2/env.ysh

## STDOUT:
env.ysh
OSH ok
## END

#### bin/ysh doesn't have exported vars (declare -x)

osh=$SH  # this file is run by OSH

case $osh in
  *osh)
    echo 'OSH ok'
    ;;
esac

var ysh = osh.replace('osh', 'ysh')

# NOT exported
$ysh -c 'echo sh=$[getVar("SH")]'

## STDOUT:
OSH ok
sh=null
## END

#### Temp bindings A=a B=b my-command push to ENV Obj (ysh:all)
shopt -s ysh:all

_A=a _B=b env | grep '^_' | sort

## STDOUT:
_A=a
_B=b
## END

#### Nested temp bindings

f2() {
  echo "  f2 AA=$AA BB=$BB"
  env | egrep 'AA|BB'
}

f1() {
  echo "> f1 AA=$AA"
  AA=aaaa BB=bb f2
  echo "< f1 AA=$AA"
}

AA=a f1

#
# Now with ysh:upgrade
#

shopt --set ysh:upgrade
echo

proc p2 {
  echo "  p2 AA=$[get(ENV, 'AA')] BB=$[get(ENV, 'BB')]"
  env | egrep 'AA|BB'
}

proc p1 {
  echo "> p1 AA=$[get(ENV, 'AA')]"
  AA=aaaa BB=bb p2
  echo "< p1 AA=$[get(ENV, 'AA')]"
}

AA=a p1

#
# Now with ysh:all
#

shopt --set ysh:all
echo

AA=a p1

## STDOUT:
> f1 AA=a
  f2 AA=aaaa BB=bb
AA=aaaa
BB=bb
< f1 AA=a

> p1 AA=a
  p2 AA=aaaa BB=bb
AA=aaaa
BB=bb
< p1 AA=a

> p1 AA=a
  p2 AA=aaaa BB=bb
AA=aaaa
BB=bb
< p1 AA=a
## END

#### Temp bindings can use locals in the same frame,(don't introduce new frame)

# OSH: FOO can use x, but FOO is also bound
shfunc() {
  local x='zzz'
  # There is no FOO here, because the argument to echo is evaluated first
  FOO=$x echo      "shfunc x=$x FOO=${FOO:-}"
  FOO=$x eval 'echo shfunc x=$x FOO=$FOO'
}

shfunc
echo

shopt --set ysh:upgrade

# YSH: FOO can use x, but FOO is also bound
proc p {
  var x = 'zzz'
  # There is no ENV.FOO here, because the argument to echo is evaluated first
  FOO=$x echo         "ysh x=$x FOO=${FOO:-} ENV.FOO=$[get(ENV, 'FOO')]"
  FOO=$x eval    'echo ysh x=$x FOO=${FOO:-} ENV.FOO=$[get(ENV, "FOO")]'
  FOO=$x redir { echo "ysh x=$x FOO=${FOO:-} ENV.FOO=$[get(ENV, 'FOO')]" }
}

p

## STDOUT:
shfunc x=zzz FOO=
shfunc x=zzz FOO=zzz

ysh x=zzz FOO= ENV.FOO=null
ysh x=zzz FOO= ENV.FOO=zzz
ysh x=zzz FOO= ENV.FOO=zzz
## END


#### setglobal ENV.PYTHONPATH = 'foo' changes child process state
shopt -s ysh:upgrade

setglobal ENV.PYTHONPATH = 'foo'

#pp test_ (ENV)
#export PYTHONPATH=zz

# execute POSIX shell
sh -c 'echo pythonpath=$PYTHONPATH'

## STDOUT:
pythonpath=foo
## END

#### export builtin is disabled in ysh:all, in favor of setglobal
shopt -s ysh:all

setglobal ENV.ZZ = 'setglobal'

# execute POSIX shell
sh -c 'echo ZZ=$ZZ'

export ZZ='export'  # fails

sh -c 'echo ZZ=$ZZ'  # not reached

## status: 1
## STDOUT:
ZZ=setglobal
## END

#### ysh:upgrade can use both export builtin and setglobal ENV
shopt -s ysh:upgrade

export ZZ='export'  # fails

sh -c 'echo ZZ=$ZZ'  # not reached

setglobal ENV.ZZ = 'setglobal'  # this takes precedence

# execute POSIX shell
sh -c 'echo ZZ=$ZZ'

## STDOUT:
ZZ=export
ZZ=setglobal
## END


#### PS4 environment variable is respected
shopt -s ysh:upgrade

setglobal ENV.PS4 = '%%% '

$[ENV.SH] -c 'set -x; echo 1; echo 2'

## STDOUT:
1
2
## END
## STDERR:
%%% echo 1
%%% echo 2
## END


#### ENV.HOME is respected

HOME=zz-osh
echo ~/src

shopt --set ysh:upgrade

setvar ENV.HOME = 'ysh-zz'

# TODO: this should consult ENV.HOME
echo ~/src

# not set by spec test framework
#echo $[ENV.HOME]

## STDOUT:
zz-osh/src
ysh-zz/src
## END

#### exec builtin respects ENV

shopt --set ysh:upgrade

#export ZZ=zzz
setglobal ENV.ZZ = 'zz'

env sh -c 'echo child ZZ=$ZZ'

exec env sh -c 'echo exec ZZ=$ZZ'

## STDOUT:
child ZZ=zz
exec ZZ=zz
## END

#### setglobal quirk - do we need setenv?
shopt --set ysh:all

proc p {
  # quirk: MOST visible Dict is mutated
  setglobal ENV.perm = 'perm'
}  

FOO=bar p

# quirk: that Dict is gone
# we could add 'setenv' to work around this
pp test_ (get(ENV, 'perm'))

p
pp test_ (get(ENV, 'perm'))


## STDOUT:
(Null)   null
(Str)   "perm"
## END

#### try to corrupt ENV var from user code
shopt --set ysh:all

setglobal ENV.AA = 'aa'

proc p {
  # this doesn't do anything, because Mem still have self.env_object
  setglobal ENV = null

  # TODO: there could be other ways to mess it up, and hit e_die()
  # Right now, it's not possible to mutate 'prototype'.  But if so we could
  # mess up ENV.
}  

FOO=bar p

= ENV.AA

## STDOUT:
(Str)   'aa'
## END
