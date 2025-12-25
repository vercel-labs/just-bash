# Test var / setvar / etc.

## our_shell: ysh
## oils_failures_allowed: 2

#### proc static check: const can't be mutated
proc f {
  const x = 'local'
  echo x=$x
  setvar x = 'mutated'
  echo x=$x
}
## status: 2
## STDOUT:
## END

#### top-level dynamic check: const can't be be mutated
shopt -s ysh:all

const x = 'foo'
echo x=$x
const x = 'bar'
echo x=$x
## status: 1
## STDOUT:
x=foo
## END

#### top level: var can be redefined by var/const
var x = "global"
echo x=$x
f() {
  var x = "local"
  echo x=$x
}
f
var x = "g2"
echo x=$x
const x = 'now-const'
echo x=$x
const x = 'oops'
echo x=$x
## status: 1
## STDOUT:
x=global
x=local
x=g2
x=now-const
## END

#### setvar mutates local
proc f {
  var x = 'local'
  echo x=$x
  setvar x = 'mutated'
  echo x=$x
}

var x = 'global'
echo x=$x
f
echo x=$x
## STDOUT:
x=global
x=local
x=mutated
x=global
## END

#### top level: setvar creates global
setvar x = 'global'
echo x=$x
setvar x = 'g2'
echo x=$x
## STDOUT:
x=global
x=g2
## END

#### top level: setvar mutates var
var x = 1
setvar x = 42  # this is allowed
echo $x
setvar y = 50  # error because it's not declared
echo $y
## STDOUT:
42
50
## END

#### proc static check: variable changed by setvar must be declared
shopt -s ysh:all

var x = 1
f() {
  # setting global is OK
  setglobal x = 'XX'
  echo x=$x

  # local NOT DECLARED
  setvar x = 'YY'
  echo y=$y
}
## status: 2
## STDOUT:
## END

#### setglobal
f() {
  var x = 'local'
  echo x=$x
  setglobal x = 'mutated'
}
var x = 'global'
echo x=$x
f
echo x=$x
## STDOUT:
x=global
x=local
x=mutated
## END

#### setglobal of undeclared var is allowed
var x = 'XX'
echo x=$x
setglobal x = 'xx'
echo x=$x

# fatal error
setglobal y = 'YY'

## STDOUT:
x=XX
x=xx
## END

#### var a, b  does implicit null init

var x
var a, b

var c: Int, d: Int

echo $x $a $b $c $d

## STDOUT:
null null null null null
## END

#### var x, y = f()

# The syntax consistent with JavaScript would be
# var x = 1, y = 2;

var x, y = 1, 2
echo "x=$x y=$y"

func f() {
  # this syntax would be nice, but is illegal
  # return (3, 4)
  return ([3, 4])
}

var a, b = f()
echo "a=$a b=$b"


## STDOUT:
x=1 y=2
a=3 b=4
## END

#### const x, y = f()

func f() {
  # this syntax would be nice, but is illegal
  # return (3, 4)
  return ([3, 4])
}


const a, b = f()
echo "a=$a b=$b"

setvar a = 9  # error

## status: 1
## STDOUT:
a=3 b=4
## END


#### setvar x, y = 1, 2

# Python doesn't allow you to have annotation on each variable!
# https://www.python.org/dev/peps/pep-0526/#where-annotations-aren-t-allowed
var x Int = 3
var y Int = 4
echo "x=$x y=$y"

setvar x, y = 1, 9
echo "x=$x y=$y"

setvar y, x = x, y
echo "x=$x y=$y"

setvar x, y = x*2, x*3
echo "x=$x y=$y"

## STDOUT:
x=3 y=4
x=1 y=9
x=9 y=1
x=18 y=27
## END

#### setvar to swap List and Dict elements
var x = [1, 2, 3]
echo @x

setvar x[0], x[1] = x[1], x[0]

echo @x

var d = {int: 42}

setvar x[0], d.int = d.int, x[0]

echo @x
json write (d)

## STDOUT:
1 2 3
2 1 3
42 1 3
{
  "int": 2
}
## END

#### setvar d.key = 42
shopt -s ysh:all

var d = {}
setvar d['f2'] = 42
setvar d.f3 = 43

# Use the opposite thing to retrieve
var f3 = d['f3']
var f2 = d.f2
echo f3=$f3
echo f2=$f2
## STDOUT:
f3=43
f2=42
## END

#### setvar mylist[1] = 42
shopt -s ysh:all
var mylist = [1,2,3]
setvar mylist[1] = 42

write --sep ' ' @mylist
## STDOUT:
1 42 3
## END

#### setvar mylist[99] out of range
shopt -s ysh:all
var mylist = [4,5,6]
try {
  setvar mylist[99] = 42
}
echo $[_error.code]

try {
  setvar mylist[-99] = 42
}
echo $[_error.code]

write --sep ' ' @mylist

## STDOUT:
3
3
4 5 6
## END

#### mixing assignment builtins and YSH assignment
shopt --set ysh:all parse_equals
shopt --unset no_osh_builtins

proc local-var {
  local x=1
  var x = 2
  echo x=$x
}

proc readonly-var {
  readonly x=1
  var x = 2
  echo x=$x
}

try { eval 'local-var' }
echo status=$[_error.code]
try { eval 'readonly-var' }
echo status=$[_error.code]

## STDOUT:
x=2
status=0
status=1
## END

#### circular dict - TODO 2023-06 REGRESS
var d = {name: 'foo'}
pp test_ (d)

setvar d['name'] = 123
pp test_ (d)

setvar d['name'] = 'mystr'
pp test_ (d)

setvar d['name'] = d
pp test_ (d)

# This used to print ...

## STDOUT:
(OrderedDict)   <'name': 'foo'>
(OrderedDict)   <'name': 123>
(OrderedDict)   <'name': 'mystr'>
(OrderedDict)   <'name': ...>
## END

#### circular list - TODO 2023-06 REGRESS
var L = [1,2,3]
= L
#setvar L[0] = L
#= L
## STDOUT:
(List)   [1, 2, 3]
(List)   [[...], 2, 3]
## END


#### exit code of var, const, setvar with command sub

# NOTE: This feels PROBLEMATIC without command_sub_errexit feels like it should
# be the last one ...

run() {
  $[ENV.REPO_ROOT]/bin/osh -O parse_proc -c "$@"

  # Identical
  # $[ENV.SH] +O ysh:all -O parse_proc -c "$@"
}

shopt --unset errexit

run '
var x = $(false)
echo inside1=$?
'
echo outside1=$?

run '
setvar x = $(false)
echo inside2=$?
'
echo outside2=$?

# Argument list
run '
call split( $(false) )
echo inside3=$?
'
echo outside3=$?

# Place expression
run '
var d = {}
setvar d[ $(false) ] = 42
echo inside4=$?
'
echo outside4=$?

## STDOUT:
outside1=1
outside2=1
outside3=1
outside4=1
## END

#### setvar obj[INVALID TYPE] =

shopt --unset errexit

$[ENV.SH] -c '
var d = {}
setvar d["key"] = 5
echo "d.key = $[d.key]"
setvar d[42] = 6
echo "should not get here"
'
echo outside1=$?

$[ENV.SH] -c '
var L = [42]
setvar L[0] = 43
echo "L[0] = $[L[0]]"
setvar L["key"] = 44
'
echo outside2=$?

## STDOUT:
d.key = 5
outside1=3
L[0] = 43
outside2=3
## END
