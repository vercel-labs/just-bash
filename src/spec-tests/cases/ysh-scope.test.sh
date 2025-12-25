## oils_failures_allowed: 1

#### GetValue scope and shopt --unset dynamic_scope
shopt --set parse_proc

f() {
  echo "sh x=$x"
}

proc p {
  echo "ysh x=$x"
}

demo() {
  local x=dynamic
  f
  p

  shopt --unset dynamic_scope
  f
}

x=global
demo
echo x=$x

## STDOUT:
sh x=dynamic
ysh x=global
sh x=global
x=global
## END


#### SetValue scope and shopt --unset dynamic_scope
shopt --set parse_proc

f() {
  x=f
}

proc p {
  var x = 'p'
}

demo() {
  local x=stack
  echo x=$x
  echo ---

  f
  echo f x=$x

  x=stack
  p
  echo p x=$x

  shopt --unset dynamic_scope
  x=stack
  f
  echo funset x=$x
}

x=global
demo

echo ---
echo x=$x

## STDOUT:
x=stack
---
f x=f
p x=stack
funset x=stack
---
x=global
## END

#### read scope
set -o errexit

read-x() {
  echo dynamic-scope | read x
}
demo() {
  local x=42
  echo x_before=$x
  read-x
  echo x_after=$x
}
demo
echo x=$x

echo ---

# Now 'read x' creates a local variable
shopt --unset dynamic_scope
demo
echo x=$x

## STDOUT:
x_before=42
x_after=dynamic-scope
x=
---
x_before=42
x_after=42
x=
## END

#### printf -v x respects dynamic_scope
set -o errexit

set-x() {
  printf -v x "%s" dynamic-scope
}
demo() {
  local x=42
  echo x=$x
  set-x
  echo x=$x
}
demo
echo x=$x

echo ---

shopt --unset dynamic_scope  # should NOT affect read
demo
echo x=$x

## STDOUT:
x=42
x=dynamic-scope
x=
---
x=42
x=42
x=
## END

#### printf -v a[i] respects dynamic_scope
set -o errexit

set-item() {
  printf -v 'a[1]' "%s" dynamic-scope
}
demo() {
  local -a a=(41 42 43)
  echo "a[1]=${a[1]}"
  set-item
  echo "a[1]=${a[1]}"
}
demo
echo "a[1]=${a[1]}"

echo ---

shopt --unset dynamic_scope  # should NOT affect read
demo
echo "a[1]=${a[1]}"

## STDOUT:
a[1]=42
a[1]=dynamic-scope
a[1]=
---
a[1]=42
a[1]=42
a[1]=
## END

#### ${undef=a} and shopt --unset dynamic_scope

set-x() {
  : ${x=new}
}
demo() {
  local x
  echo x=$x
  set-x
  echo x=$x
}

demo
echo x=$x

echo ---

# Now this IS affected?
shopt --unset dynamic_scope 
demo
echo x=$x
## STDOUT:
x=
x=new
x=
---
x=
x=
x=
## END

#### declare -p respects it

___g=G

show-vars() {
  local ___x=X
  declare -p | grep '___'
  echo status=$?

  echo -
  declare -p ___y | grep '___'
  echo status=$?
}

demo() {
  local ___y=Y

  show-vars
  echo ---
  shopt --unset dynamic_scope
  show-vars
}

demo

## STDOUT:
declare -- ___g=G
declare -- ___x=X
declare -- ___y=Y
status=0
-
declare -- ___y=Y
status=0
---
declare -- ___g=G
declare -- ___x=X
status=0
-
status=1
## END


#### OshLanguageSetValue constructs

f() {
  (( x = 42 ))
}
demo() {
  f
  echo x=$x
}

demo

echo ---

shopt --unset dynamic_scope

unset x

demo

echo --- global
echo x=$x
## STDOUT:
x=42
---
x=
--- global
x=
## END


#### shell assignments 'neutered' inside 'proc'
shopt --set parse_proc

# They can't mutate globals or anything higher on the stack

proc p {
  # TODO: declare should be disallowed in YSH, just like shell functions.

  #declare g=PROC
  #export e=PROC
  var g = 'PROC'
  var e = 'PROC'
}

f() {
  g=SH
  export e=SH
}

e=E
g=G
p
echo e=$e g=$g

p
echo e=$e g=$g

f
echo e=$e g=$g

## STDOUT:
e=E g=G
e=E g=G
e=SH g=SH
## END

#### setglobal still allows setting globals
shopt --set parse_proc

proc p {
  setglobal new_global = 'p'
  setglobal g = 'p'
}

var g = 'G'

p

echo g=$g new_global=$new_global
## STDOUT:
g=p new_global=p
## END

#### setglobal d[key] inside proc should mutate global (bug #1841)

shopt -s ysh:upgrade

var g = {}

proc mutate {
  var g = {'local': 1}  # shadows global var

  setglobal g.key = 'mutated'
  setglobal g['key2'] = 'mutated'

  echo 'local that is ignored'
  pp test_ (g)
}

echo 'BEFORE mutate global'
pp test_ (g)

mutate

echo 'AFTER mutate global'
pp test_ (g)

## STDOUT:
BEFORE mutate global
(Dict)   {}
local that is ignored
(Dict)   {"local":1}
AFTER mutate global
(Dict)   {"key":"mutated","key2":"mutated"}
## END

#### setglobal a[i] inside proc
shopt -s ysh:upgrade

var a = [0]

proc mutate {
  var a = [1]  # shadows global var

  echo 'local that is ignored'
  setglobal a[0] = 42

  pp test_ (a)
}

echo 'BEFORE mutate global'
pp test_ (a)

mutate

echo 'AFTER mutate global'
pp test_ (a)

## STDOUT:
BEFORE mutate global
(List)   [0]
local that is ignored
(List)   [1]
AFTER mutate global
(List)   [42]
## END

#### setglobal a[i] += and d.key +=
shopt -s ysh:upgrade

var mylist = [0]
var mydict = {k: 0}

proc mutate {
  # these locals are ignored
  var mylist = []
  var mydict = {}

  setglobal mylist[0] += 5
  setglobal mydict['k'] += 5
}

mutate

pp test_ (mylist)
pp test_ (mydict)

## STDOUT:
(List)   [5]
(Dict)   {"k":5}
## END

#### setglobal a[i] - i can be local or global
shopt -s ysh:upgrade

var mylist = [0, 1]
var mydict = {k: 0, n: 1}

var i = 0
var key = 'k'

proc mutate1 {
  var mylist = []  # IGNORED
  var mydict = {}  # IGNORED

  var i = 1
  var key = 'n'

  setglobal mylist[i] = 11
  setglobal mydict[key] = 11
}

# Same thing without locals
proc mutate2 {
  var mylist = []  # IGNORED
  var mydict = {}  # IGNORED

  setglobal mylist[i] = 22
  setglobal mydict[key] = 22
}

mutate1

pp test_ (mylist)
pp test_ (mydict)
echo

mutate2

pp test_ (mylist)
pp test_ (mydict)

## STDOUT:
(List)   [0,11]
(Dict)   {"k":0,"n":11}

(List)   [22,11]
(Dict)   {"k":22,"n":11}
## END

#### unset inside proc - closures and dynamic scope
shopt --set parse_brace
shopt --set parse_proc

shellfunc() {
  unset x
}

proc unset-proc() {
  unset x
}

proc unset-proc-dynamic-scope() {
  shopt --set dynamic_scope {  # turn it back on
    unset x
  }
}

x=foo
shellfunc
echo shellfunc x=$x

x=bar
unset-proc
echo unset-proc x=$x

x=spam
unset-proc
echo unset-proc-dynamic-scope x=$x

## STDOUT:
shellfunc x=
unset-proc x=
unset-proc-dynamic-scope x=
## END

#### unset composes when you turn on dynamic scope
shopt -s ysh:all
shopt --unset no_osh_builtins

proc unset-two (v, w) {
  shopt --set dynamic_scope {
    unset $v
    unset $w
  }
}

demo() {
  local x=X
  local y=Y

  echo "x=$x y=$y"

  unset-two x y

  shopt --unset nounset
  echo "x=$x y=$y"
}

demo
## STDOUT:
x=X y=Y
x= y=
## END

#### Temp Bindings
shopt --set parse_proc

myfunc() {
  echo myfunc FOO=$FOO
}
proc myproc() {
  echo myproc FOO=$FOO
}

FOO=bar myfunc
FOO=bar myproc
FOO=bar echo inline FOO=$FOO
FOO=bar printenv.py FOO

## STDOUT:
myfunc FOO=bar
myproc FOO=
inline FOO=
bar
## END

#### cd blocks don't introduce new scopes
shopt --set ysh:upgrade

var x = 42
cd / {
  var y = 0
  var z = 1
  echo $x $y $z
  setvar y = 43
}
setvar z = 44
echo $x $y $z

## STDOUT:
42 0 1
42 43 44
## END

#### shvar IFS=x { myproc } rather than IFS=x myproc - no dynamic scope

# Note: osh/split.py uses dynamic scope to look up IFS
# TODO: Should use LANG example to demonstrate

#shopt --set ysh:upgrade  # this would disable word splitting

shopt --set parse_proc
shopt --set parse_brace
#shopt --set env_obj

s='xzx zxz'

shellfunc() {
  echo shellfunc IFS="$IFS"
  argv.py $s
}

proc myproc() {
  echo myproc IFS="$IFS"
  argv.py $s
}

IFS=: $REPO_ROOT/spec/bin/printenv.py IFS

# default value
echo "$IFS" | od -A n -t x1

IFS=' z'
echo IFS="$IFS"
echo

shellfunc
echo

IFS=' x' shellfunc
echo

# Problem: $IFS in procs only finds GLOBAL values, so we get IFS=' z' rather than IFS=' x'.
# But when actually splitting, $IFS is a 'shvar' which respects DYNAMIC scope.
#
# Can use shvarGet('IFS') instead

IFS=' x' myproc
echo

# YSH solution to the problem
shvar IFS=' x' {
  myproc
}

## STDOUT:
:
 20 09 0a 0a
IFS= z

shellfunc IFS= z
['x', 'x', 'x']

shellfunc IFS= x
['', 'z', 'z', 'z']

myproc IFS= z
['x', 'x', 'x']

myproc IFS= x
['', 'z', 'z', 'z']
## END

#### shvar builtin syntax
shopt --set ysh:upgrade
shopt --unset errexit

# no block
shvar
echo status=$?

shvar {  # no arg
  true
}
echo status=$?

shvar foo {  # should be name=value
  true
}
echo status=$?
## STDOUT:
status=2
status=2
status=2
## END


#### shvar and shvarGet() obey dynamic scope

# On the other hand, in YSH
# - $x does local/closure/global scope
# - FOO=foo mycommand modifies the ENV object - shopt --set env_obj

shopt --set ysh:all

proc p3 {
  echo FOO=$[shvarGet('FOO')]  # dynamic scope
  echo FOO=$FOO                # fails, not dynamic scope
}

proc p2 {
  p3
}

proc p {
  shvar FOO=foo {
    p2
  }
}

p

## status: 1
## STDOUT:
FOO=foo
## END


#### shvar global
shopt --set ysh:upgrade
shopt --unset nounset

echo _ESCAPER=$_ESCAPER
echo _DIALECT=$_DIALECT

shvar _ESCAPER=html _DIALECT=ninja {
  echo block _ESCAPER=$_ESCAPER
  echo block _DIALECT=$_DIALECT
}

echo _ESCAPER=$_ESCAPER
echo _DIALECT=$_DIALECT

# Now set them
_ESCAPER=foo
_DIALECT=bar

echo ___

echo _ESCAPER=$_ESCAPER
echo _DIALECT=$_DIALECT

shvar _ESCAPER=html _DIALECT=ninja {
  echo block _ESCAPER=$_ESCAPER
  echo block _DIALECT=$_DIALECT

  shvar _ESCAPER=nested {
    echo nested _ESCAPER=$_ESCAPER
    echo nested _DIALECT=$_DIALECT
  }
}

echo _ESCAPER=$_ESCAPER
echo _DIALECT=$_DIALECT

## STDOUT:
_ESCAPER=
_DIALECT=
block _ESCAPER=html
block _DIALECT=ninja
_ESCAPER=
_DIALECT=
___
_ESCAPER=foo
_DIALECT=bar
block _ESCAPER=html
block _DIALECT=ninja
nested _ESCAPER=nested
nested _DIALECT=ninja
_ESCAPER=foo
_DIALECT=bar
## END

#### shvar local
shopt --set ysh:upgrade  # blocks
shopt --unset simple_word_eval  # test word splitting

proc foo {
  shvar IFS=x MYTEMP=foo {
    echo IFS="$IFS"
    argv.py $s
    echo MYTEMP=${MYTEMP:-undef}
  }
}
var s = 'a b c'
argv.py $s
foo
argv.py $s
echo MYTEMP=${MYTEMP:-undef}
## STDOUT:
['a', 'b', 'c']
IFS=x
['a b c']
MYTEMP=foo
['a', 'b', 'c']
MYTEMP=undef
## END

#### shvar IFS
shopt --set ysh:upgrade

proc myproc() {
  echo "$IFS" | od -A n -t x1

  local mylocal=x
  shvar IFS=w {
    echo inside IFS="$IFS"
    echo mylocal="$mylocal"  # I do NOT want a new scope!
  }
  echo "$IFS" | od -A n -t x1
}

myproc
## STDOUT:
 20 09 0a 0a
inside IFS=w
mylocal=x
 20 09 0a 0a
## END

#### Compare shell func vs. proc, $IFS vs. shvarGet('IFS')

shopt --set parse_proc parse_ysh_expr_sub

s='xzx zxz'

shellfunc() {  # dynamic scope everywhere
  echo shellfunc
  echo IFS="$IFS"
  echo shvarGet IFS=$[shvarGet('IFS')]
  argv.py $s
}

proc myproc {  # no dynamic scope

  # Subtle behavior: we see 'x' rather than "temp frame" 'z' - I think because
  # there is a CHAIN of __E__ enclosed scopes, up to the global frame.
  #
  # That frame comes FIRST.   That seems OK, but it changed when procs became closures.
  proc p2 {
    echo "myproc -> p2"
    echo IFS="$IFS"  
    echo shvarGet IFS=$[shvarGet('IFS')]  # dynamic scope opt-in
    argv.py $s  # dynamic scope in osh/split.py
  }

  p2 
}

IFS=x

IFS=z shellfunc
echo

# this makes a temp frame, but the proc can't see it?
IFS=z myproc
echo

# null
echo $[shvarGet('nonexistent')]

## STDOUT:
shellfunc
IFS=z
shvarGet IFS=z
['x', 'x ', 'x']

myproc -> p2
IFS=x
shvarGet IFS=x
['', 'z', ' z', 'z']

null
## END

#### func and proc are like var, with respect to closures
shopt --set ysh:all

proc test-var {
  var x = 'outer'
  proc inner {
    var x = 'inner'
    # note: static check is broken now
    #setvar x = 'inner'
    echo "inner $x"
  }
  inner
  echo "outer $x"
}

# Note: state.YshDecl flag somehow doesn't make a difference here?
proc test-func {
  func x() { return ('outer') }
  proc inner2 {
    func x() { return ('inner') }
    echo "inner $[x()]"
  }
  inner2
  echo "outer $[x()]"
}

proc test-proc {
  proc x { echo 'outer' }
  proc inner3 {
    proc x { echo 'inner' }
    x
  }
  inner3
  x
}


test-var
echo

test-func
echo

test-proc

## STDOUT:
inner inner
outer outer

inner inner
outer outer

inner
outer
## END
