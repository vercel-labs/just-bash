## oils_failures_allowed: 1

#### Exact equality with === and !==
shopt -s ysh:all

if (3 === 3) {
  echo 'ok'
}
if (3 === '3') {
  echo 'FAIL'
}

if (3 !== 3) {
  echo 'FAIL'
}
if (3 !== '3') {
  echo 'ok'
}

# dicts
var d1 = {'a': 1, 'b': 2}
var d2 = {'a': 1, 'b': 2}
var d3 = {'a': 1, 'b': 3}
if (d1 === d2) {
  echo 'ok'
}
if (d1 === d3) {
  echo 'FAIL'
}
if (d1 !== d3) {
  echo 'ok'
}

## STDOUT:
ok
ok
ok
ok
## END

#### Approximate equality of Str x {Str, Int, Bool} with ~==
shopt -s ysh:all

# Note: for now there's no !~== operator.  Use:   not (a ~== b)

if (' foo ' ~== 'foo') {
  echo Str-Str
}
if (' BAD ' ~== 'foo') {
  echo FAIL
}

if ('3 ' ~== 3) {
  echo Str-Int
}

if ('-3 ' ~== -3) {
  echo Str-Negative
}

if ('-3_456' ~== -3456) {
  echo Str-Underscore
}

if ('4 ' ~== '3') {
  echo FAIL
}

if (' true ' ~== true) {
  echo Str-Bool
}
if (' true ' ~== false) {
  echo FAIL
}

const matrix = [
  ' TRue ' ~== true,  # case insentiive
  ' FALse ' ~== false,
]

# = matrix
if (matrix === [true, true]) {
  echo 'bool matrix'
}

## STDOUT:
Str-Str
Str-Int
Str-Negative
Str-Underscore
Str-Bool
bool matrix
## END

#### Wrong Types with ~==
shopt -s ysh:all

# The LHS side should be a string

echo one
if (['1'] ~== ['1']) {
  echo bad
}
echo two

if (3 ~== 3) {
  echo bad
}

## status: 1
## STDOUT:
one
## END

#### === on float not allowed

$SH -c '
shopt -s ysh:upgrade
pp test_ (1.0 === 2.0)
echo ok
'
echo status=$?

$SH -c '
shopt -s ysh:upgrade
pp test_ (42 === 3.0)
echo ok
'
echo status=$?

## STDOUT:
status=3
status=3
## END


#### floatsEqual()

var x = 42.0
pp test_ (floatsEqual(42.0, x))

pp test_ (floatsEqual(42.0, x + 1))

## STDOUT:
(Bool)   true
(Bool)   false
## END

#### Comparison converts from Str -> Int or Float
shopt --set parse_ysh_expr_sub

echo ' i  i' $[1 < 2]
echo 'si  i' $['1' < 2]
echo ' i si' $[1 < '2']
echo ---

echo ' f  f' $[2.5 > 1.5]
echo 'sf  f' $['2.5' > 1.5]
echo ' f sf' $[2.5 > '1.5']
echo ---

echo ' i  f' $[4 <= 1.5]
echo 'si  f' $['4' <= 1.5]
echo ' i sf' $[4 <= '1.5']
echo ---

echo ' f  i' $[5.0 >= 2]
echo 'sf  i' $['5.0' >= 2]
echo ' f si' $[5.0 >= '2']

## STDOUT:
 i  i true
si  i true
 i si true
---
 f  f true
sf  f true
 f sf true
---
 i  f false
si  f false
 i sf false
---
 f  i true
sf  i true
 f si true
## END

#### Comparison of Int 
shopt -s ysh:upgrade

if (1 < 2) {
  echo '<'
}
if (2 <= 2) {
  echo '<='
}
if (5 > 4) {
  echo '>'
}
if (5 >= 5) {
  echo '>='
}

if (2 < 1) {
  echo no
}

## STDOUT:
<
<=
>
>=
## END

#### Comparison of Str does conversion to Int
shopt -s ysh:upgrade

if ('2' < '11') {
  echo '<'
}
if ('2' <= '2') {
  echo '<='
}
if ('11' > '2') {
  echo '>'
}
if ('5' >= '5') {
  echo '>='
}

if ('2' < '1') {
  echo no
}

## STDOUT:
<
<=
>
>=
## END


#### Mixed Type Comparison does conversion to Int
shopt -s ysh:upgrade

if (2 < '11') {
  echo '<'
}
if (2 <= '2') {
  echo '<='
}
if (11 > '2') {
  echo '>'
}
if (5 >= '5') {
  echo '>='
}

if (2 < '1') {
  echo no
}

## STDOUT:
<
<=
>
>=
## END


#### Invalid String is an error
shopt -s ysh:upgrade

try {
  = '3' < 'bar'
}
echo code=$[_error.code]

try {
  = '3' < '123_4'
}
echo code=$[_error.code]

## status: 3
## STDOUT:
## END


#### Bool conversion -- explicit allowed, implicit not allowed

shopt -s ysh:upgrade

if (int(false) < int(true)) {
  echo '<'
}

if (int(false) <= int(false) ) {
  echo '<='
}

# JavaScript and Python both have this, but YSH prefers being explicit

if (true < false) {
  echo 'BAD'
}
echo 'should not get here'

## status: 3
## STDOUT:
<
<=
## END


#### Chained Comparisons
shopt -s ysh:upgrade

if (1 < 2 < 3) {
  echo '123'
}
if (1 < 2 <= 2 <= 3 < 4) {
  echo '123'
}

if (1 < 2 < 2) {
  echo '123'
} else {
  echo 'no'
}
## STDOUT:
123
123
no
## END

#### List / "Tuple" comparison is not allowed

shopt -s ysh:upgrade

var t1 = 3, 0
var t2 = 4, 0
var t3 = 3, 1

if (t2 > t1) { echo yes1 }
if (t3 > t1) { echo yes2 }
if ( (0,0) > t1) { echo yes3 }

## status: 3
## STDOUT:
## END

#### Ternary op behaves like if statement
shopt -s ysh:upgrade

if ([1]) {
  var y = 42
} else {
  var y = 0
}
echo y=$y

var x = 42 if [1] else 0
echo x=$x

## STDOUT:
y=42
x=42
## END

#### Undefined comparisons
shopt -s ysh:all

func f() { true }
var mydict = {}
var myexpr = ^[123]

var unimpl = [
    / [a-z]+ /,  # Eggex
    myexpr,  # Expr
    ^(echo hello),  # Block
    f,  # Func
    ''.upper,  # BoundFunc
    # These cannot be constructed
    # - Proc
    # - Slice
    # - Range
]

for val in (unimpl) {
  try { = val === val }
  if (_error.code !== 3) {
    exit 1
  }
}
## STDOUT:
## END

#### Non-comparable types in case arms
var myexpr = ^[123]

case (myexpr) {
  (myexpr) { echo 123; }
}
## status: 3
## STDOUT:
## END

#### object identity

var d = {}
var s = 'str'

pp test_ (d is d)
pp test_ (d is not {})
echo

pp test_ (d is s)
pp test_ (d is not s)

## STDOUT:
(Bool)   true
(Bool)   true

(Bool)   false
(Bool)   true
## END


