
#### command sub $(echo hi)
var x = $(echo hi)
var y = $(echo '')
# Make sure we can operate on these values
echo x=${x:-default} y=${y:-default}
## STDOUT:
x=hi y=default
## END


#### Set $HOME using 'var' (i.e. YSH string var in word evaluator)
var HOME = "foo"
echo $HOME
echo ~
## STDOUT:
foo
foo
## END

#### Use shell var in YSH expression
x='abc'
var length = len(x)  # length in BYTES, unlike ${#x}
echo $length
## STDOUT:
3
## END

#### Length doesn't apply to BashArray
x=(a b c)
x[10]=A
x[20]=B

# shell style: length is 5
echo shell=${#x[@]}

shopt --set parse_ysh_expr_sub

# Length could be 20, but we may change the representation to Dict[int, str]
echo ysh=$[len(x)]

## status: 3
## STDOUT:
shell=5
## END

#### $[len(x)] inside strings
var s = "abc"

shopt --set parse_ysh_expr_sub

echo -$[len(s)]-

# This already has a meaning ...
#echo "-$len(x)-"
#echo "-${len}(x)-"

## STDOUT:
-3-
## END

#### Func with multiple args in multiple contexts
shopt --set ysh:upgrade  # needed for math.ysh

source $LIB_YSH/math.ysh

var x = max(1+2, 3+4)
echo $x $[max(1+2, 3+4)]

## STDOUT:
7 7
## END


#### Trailing Comma in Param list
shopt --set ysh:upgrade  # needed for math.ysh

source $LIB_YSH/math.ysh

var x = max(1+2, 3+4,)
echo $x $[max(1+2, 3+4,)]

## STDOUT:
7 7
## END

#### nested expr contexts
var s = "123"

shopt --set parse_ysh_expr_sub
# lex_mode_e.ShCommand -> Expr -> ShCommand -> Expr
var x = $(echo $'len\n' $[len(s)])
echo $x
## STDOUT:
len 3
## END


# TODO:
# - test keyword args
# - test splatting *args, **kwargs
# - Multiline parsing
#
# var x = max(
#   1+2,
#   3+4,
# )
# echo $x $max(
#   1+2,
#   3+4,
# )

#### YSH var used with shell arithmetic
var w = "3"
echo lt=$(( w < 4 ))
echo gt=$(( w > 4 ))

var z = 3
echo lt=$(( z < 4 ))
echo gt=$(( z > 4 ))
## STDOUT:
lt=1
gt=0
lt=1
gt=0
## END

#### Parse { var x = 42 }
shopt -s ysh:upgrade
g() { var x = 42 }

var x = 1
f() { var x = 42; setvar x = 43 }
f
echo x=$x
## STDOUT:
x=1
## END

#### double quoted
var foo = "bar"
var x = "-$foo-${foo}-${undef:-default}-"
echo $x
## STDOUT:
-bar-bar-default-
## END

#### double quoted respects strict_array
shopt -s strict:all
declare -a a=(one two three)
var x = "-${a[@]}-"
echo $x
## status: 1
## stdout-json: ""

#### simple var sub $name $0 $1 $? etc.
( exit 42 )
var status = $?
echo status=$status

set -- a b c
var one = $1
var two = $2
echo $one $two

var named = "$one"  # equivalent to 'one'
echo named=$named

## STDOUT:
status=42
a b
named=a
## END

#### braced var sub ${x:-default}

# without double quotes

var b = ${foo:-default}
echo $b
var c = ${bar:-"-$b-"}
echo $c

var d = "${bar:-"-$c-"}"  # another one
echo $d

## STDOUT:
default
-default-
--default--
## END

#### braced var sub respects strict_array
set -- a b c
var x = ${undef:-"$@"}
echo $x
shopt -s strict_array
setvar x = ${undef:-"$@"}
echo $x
## status: 1
## STDOUT:
a b c
## END


#### null / true / false
shopt -s ysh:upgrade
var n = null
if (n) {
  echo yes
} else {
  echo no
}
var t = true
if (t) {
  echo yes
} else {
  echo no
}
var f = false
if (f) {
  echo yes
} else {
  echo no
}
## STDOUT:
no
yes
no
## END

#### multiline dict

# Note: a pair has to be all on one line.  We could relax that but there isn't
# a strong reason to now.

var mydict = { a:1,
  b: 2,
}

shopt --set parse_ysh_expr_sub

echo mydict=$[len(mydict)]
## STDOUT:
mydict=2
## END

#### multiline array and command sub (only here docs disallowed)
var array = %(
  one
  two
  three
)

shopt --set parse_ysh_expr_sub

echo array=$[len(array)]

var comsub = $(
echo hi
echo bye
)
echo comsub=$[len(comsub)]

## STDOUT:
array=3
comsub=6
## END

#### obj=>method() - remove?
var s = 'hi'

# TODO: This does a bound method thing we probably don't want
var s2 = s=>upper()
echo $s2
## STDOUT:
HI
## END

#### s->upper does NOT work, should be s.upper() or =>
var s = 'hi'
var method = s->upper
echo $method
## status: 3
## stdout-json: ""

#### d.key
var d = {name: 'andy'}
var x = d.name
echo $x
## STDOUT:
andy
## END

#### a ++ b for string/list concatenation
shopt -s parse_brace parse_ysh_expr_sub

var i = 'abc'
var j = 'de'
var k = i ++ j
echo string $k


var a = [1, 2]
var b = [3]
var c = a ++ b
echo list len=$[len(c)]

echo ---

try {
  = 'ab' ++ 3
}
echo Str Int $[_error.code]

try {
  = [1, 2] ++ 3
}
echo List Int $[_error.code]

try {
  = 3 ++ 'ab'
}
echo Int Str $[_error.code]

## STDOUT:
string abcde
list len=3
---
Str Int 3
List Int 3
Int Str 3
## END

#### s ~~ glob and s !~~ glob
shopt -s ysh:all

if ('foo.py' ~~ '*.py') {
  echo yes
}
if ('foo.py' !~~ '*.sh') {
  echo no
}
## STDOUT:
yes
no
## END

#### Type Errors
shopt --set parse_brace parse_ysh_expr_sub

# TODO: It might be nice to get a message
try {
  var x = {} + []
}
echo $[_error.code]

try {
  setvar x = {} + 3
}
echo $[_error.code]

try {
  = 'foo' ++ 3
}
echo $[_error.code]

try {
  = 'foo' ++ 3
}
echo $[_error.code]

## STDOUT:
3
3
3
3
## END


#### can't use ++ on integers
var x = 12 ++ 3
echo $x
## status: 3
## STDOUT:
## END

#### can't do mystr ++ mylist
= ["s"] + "t"
## status: 3
## STDOUT:
## END


#### expression literals
var e = ^[1 + 2]

shopt --set parse_ysh_expr_sub

echo type=$[type(e)]
echo $[io->evalExpr(e)]

var e = ^[2 < 1]
echo $[io->evalExpr(e)]

var x = 42
var e = ^[42 === x and true]
echo $[io->evalExpr(e)]

var mylist = ^[3, 4]
pp test_ (io->evalExpr(mylist))

## STDOUT:
type=Expr
3
false
true
(List)   [3,4]
## END

#### No list comprehension in ^[]

var mylist = ^[x for x in y]  
pp test_ (io->evalExpr(mylist))

## status: 2
## STDOUT:
## END


#### expression literals, evaluation failure
var e = ^[1 / 0]
call io->evalExpr(e)
## status: 3
## STDOUT:
## END

#### expression literals, lazy evaluation
shopt --set parse_ysh_expr_sub

var x = 0
var e = ^[x]

setvar x = 1
echo result=$[io->evalExpr(e)]
## STDOUT:
result=1
## END

#### expression literals, sugar for strings
shopt --set parse_ysh_expr_sub

var x = 0
var e = ^"x is $x"

setvar x = 1
echo result=$[io->evalExpr(e)]
## STDOUT:
result=x is 1
## END
