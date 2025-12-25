## oils_failures_allowed: 1
## our_shell: ysh

#### join()
var x = :|a b 'c d'|

var y = join(x)
argv.py $y

var z = join(x, ":")
argv.py $z
## STDOUT:
['abc d']
['a:b:c d']
## END

#### @[split(x)] respects IFS
setvar IFS = ":"
var x = "one:two:three"
argv.py @[split(x)]
## STDOUT:
['one', 'two', 'three']
## END

#### @[maybe(x)]
setvar empty = ''
setvar x = 'X'
argv.py a @[maybe(empty)] @[maybe(x)] b

setvar n = null
argv.py a @[maybe(n)] b

## STDOUT:
['a', 'X', 'b']
['a', 'b']
## END

#### maybe() on invalid type is fatal error

# not allowed
setvar marray = :||
argv.py a @[maybe(marray)] b
echo done
## status: 3
## STDOUT:
## END

#### split() on invalid type is fatal error
var myarray = :| --all --long |
write -- @[myarray]
write -- @[split(myarray)]
## status: 3
## STDOUT:
--all
--long
## END

#### @[glob(x)]

# empty glob
write -- A @[glob('__nope__')] B
echo ___

touch -- a.z b.z -.z
write -- @[glob('?.z')]
echo ___

# add it back
shopt --unset no_dash_glob
write -- @[glob('?.z')]

## STDOUT:
A
B
___
a.z
b.z
___
-.z
a.z
b.z
## END

#### shSplit() respects IFS

var s = ' aa a bb b   '

argv.py @[shSplit(s)]

setvar IFS = 'a'

argv.py @[shSplit(s)]

setvar IFS = 'b'

argv.py @[shSplit(s)]

## STDOUT:
['aa', 'a', 'bb', 'b']
[' ', '', ' ', ' bb b   ']
[' aa a ', '', ' ', '   ']
## END


#### getVar() gets global or local vars

# compare with shvarGet(), which does dynamic scope

proc my-proc {
  var mylocal = 43

  echo g=$[getVar('g')]
  echo mylocal=$[getVar('mylocal')]

  # the whole purpose is dynamic variable names / dynamic binding
  var prefix = 'my'
  echo mylocal=$[getVar(prefix ++ 'local')]

  echo not_global_or_local=$[getVar('not_global_or_local')]
}

proc main {
  var not_global_or_local = 42
  my-proc
}

var g = 'global'

main

## STDOUT:
g=global
mylocal=43
mylocal=43
not_global_or_local=null
## END

#### ASCII upper() lower()

var x = 'abc-'
var y = 'XYZ!'

echo $x
echo $y
echo

echo $[x => upper()]
echo $[x => lower()]
echo $[y => upper()]
echo $[y => lower()]

## STDOUT:
abc-
XYZ!

ABC-
abc-
XYZ!
xyz!
## END

#### Unicode upper() lower()

# Adapted from spec/var-op-bash

# https://www.utf8-chartable.de/unicode-utf8-table.pl

var x = u'\u{C0}\u{C8}'  # upper grave
var y = u'\u{E1}\u{E9}'  # lower acute

echo $x
echo $y
echo

echo $[x => upper()]
echo $[x => lower()]
echo $[y => upper()]
echo $[y => lower()]

## STDOUT:
ÀÈ
áé
## END

