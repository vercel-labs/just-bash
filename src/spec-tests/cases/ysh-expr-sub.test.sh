## our_shell: ysh

# Test YSH expressions within $[]

#### $[f(x)]
var a = %(a b c)
echo $[len(a)]
## STDOUT:
3
## END

#### $[d['key']]
var d = {}
setvar d['key'] = 42
echo $[d['key']]
## STDOUT:
42
## END

#### $[d.key]
var d = {}
setvar d['key'] = 42
echo $[d.key]
## STDOUT:
42
## END

#### In Double quotes
var a = %(a b c)
var obj = /d+/
var d = {}
setvar d['key'] = 42
echo "func $[len(a)]"
echo "key $[d['key']]"
echo "key $[d.key]"
echo "dq $[d["key"]]"
## STDOUT:
func 3
key 42
key 42
dq 42
## END

#### @[expr_splice] in expression mode

# In addition to:
#   write -- @[x]
#
# We can also do:
#   var y = @[x]
#   write -- @y

var x = [1, 2, 3]

var y = @[x] ++ ['99']

#= y

# note: related bug in parsing [[ in test/ysh-parse-errors.sh
#assert [['1', '2', '3'] === y]

assert [ ['1', '2', '3', '99'] === y]

pp test_ (y)

pp test_ (@[[4, 5, 6]])

var bad = [42, []]
pp test_ (@[ bad ])  # cannot be stringified

## status: 3
## STDOUT:
(List)   ["1","2","3","99"]
(List)   ["4","5","6"]
## END


#### $[expr_sub] in expression mode

# Test that $[...] works in expression mode, not just in command/word mode

# Basic integer expression
var a = $[42]
pp test_ (a)

# Arithmetic expression
var b = $[1 + 2]
pp test_ (b)

# Function call
var arr = [1, 2, 3]
var c = $[len(arr)]
pp test_ (c)

# Nested expression
var d = $[$[5] + $[10]]
echo "d = $d"

# Combined with @[] splice
var items = [10, 20, 30]
var e = @[items]
echo "len(e) = $[len(e)]"

# Error case: list cannot be stringified
var x = $[ [42] ]

## status: 3
## STDOUT:
(Str)   "42"
(Str)   "3"
(Str)   "3"
d = 15
len(e) = 3
## END

#### $[$var] is not allowed
var=1
echo $[$var+2]
echo status=$?

## status: 2
