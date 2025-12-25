## oils_failures_allowed: 0

#### Minus operator is left associative

var a = 1 - 0 - 1
var b = (1 - 0) - 1
echo a=$a b=$b

var a = 3 - 1 - 2
var b = (3 - 1) - 2
echo a=$a b=$b

## STDOUT:
a=0 b=0
a=0 b=0
## END

#### Division operators are left associative

var a = 10 / 4 / 2
var b = 10 / 4 / 2
echo a=$a b=$b

var a = 9 // 3 // 3
var b = (9 // 3) // 3
echo a=$a b=$b

var a = 11 % 6 % 3
var b = (11 % 6) % 3
echo a=$a b=$b

## STDOUT:
a=1.25 b=1.25
a=1 b=1
a=2 b=2
## END

#### Exponentiation is right associative

var a = 3 ** 2 ** 2
var b = 3 ** (2 ** 2)
echo a=$a b=$b

## STDOUT:
a=81 b=81
## END

#### Binary operators, with conversions from string
shopt --set parse_ysh_expr_sub

echo ' i  i' $[1 + 2]
echo 'si  i' $['1' + 2]
echo ' i si' $[1 + '2']
echo ---

echo ' f  f' $[2.5 - 1.5]
echo 'sf  f' $['2.5' - 1.5]
echo ' f sf' $[2.5 - '1.5']
echo ---

echo ' i  f' $[4 * 1.5]
echo 'si  f' $['4' * 1.5]
echo ' i sf' $[4 * '1.5']
echo ---

echo ' f  i' $[5.0 / 2]
echo 'sf  i' $['5.0' / 2]
echo ' f si' $[5.0 / '2']

## STDOUT:
 i  i 3
si  i 3
 i si 3
---
 f  f 1.0
sf  f 1.0
 f sf 1.0
---
 i  f 6.0
si  f 6.0
 i sf 6.0
---
 f  i 2.5
sf  i 2.5
 f si 2.5
## END

#### Floating Point Division with /

var i = '1.0' / '0.05'

echo $i

## STDOUT:
20.0
## END


#### Operations That Convert to Integer: // % **
shopt -s parse_brace parse_ysh_expr_sub

var m = ' 5 ' // 2

var n = ' 5 ' %  2

var p = ' 5 ' ** 2

write -- $m $n $p

try {
  var z = 'a' // 3
}
echo _status $[_error.code]

try {
  var z = 'z' % 3
}
echo _status $[_error.code]

## STDOUT:
2
1
25
_status 3
_status 3
## END

#### Division by zero
shopt -s parse_brace parse_ysh_expr_sub

try {
  = 42 / 0
}
echo "status / is $[_error.code]"

try {
  = 42 // 0
}
echo "status // is $[_error.code]"

try {
  = 42 % 0
}
echo "status % is $[_error.code]"

## STDOUT:
status / is 3
status // is 3
status % is 3
## END

#### Unary Operations

var a = ~1

var b = -1
var c = -2.3

var d = not true


write -- $a $b $c $d

## STDOUT:
-2
-1
-2.3
false
## END

#### Unary plus on integers and floats

var a = +1
var b = +42
var c = +2.5

var d = -10
var e = +d

write -- $a $b $c $e

## STDOUT:
1
42
2.5
-10
## END

#### unary plus and minus combined

var a = +-5
var b = -+5
var c = +(-3)

write -- $a $b $c

## STDOUT:
-5
-5
-3
## END

#### unary minus on strings
json write (-3)
json write (-'4')
json write (-'5.5')

# Not accepted
json write (-'abc')

## status: 3
## STDOUT:
-3
-4
-5.5
## END

#### unary plus on strings
json write (+3)
json write (+'4')
json write (+'5.5')

# Not accepted
json write (+'abc')

## status: 3
## STDOUT:
3
4
5.5
## END

#### unary ~ complement on strings
json write (~0)
json write (~'1')
json write (~' 2 ')
# Not accepted
json write (~'3.5')

## status: 3
## STDOUT:
-1
-2
-3
## END

#### unary ~ doesn't work on bool
= ~false
## status: 3
## STDOUT:
## END

#### unary ~ doesn't work on float
= ~1.0
## status: 3
## STDOUT:
## END

#### unary - applied to bool is not allowed
= ~false
## status: 3
## STDOUT:
## END

#### Big float constants becomes inf and -inf, tiny become 0.0 and -0.0

$SH -c '
var x = 0.12345
pp test_ (x)
'
echo float=$?

$SH -c '
# Becomes infinity
var x = 0.123456789e1234567
pp test_ (x)

var x = -0.123456789e1234567
pp test_ (x)
'
echo float=$?

$SH -c '
# Becomes infinity
var x = 0.123456789e-1234567
pp test_ (x)

var x = -0.123456789e-1234567
pp test_ (x)
'
echo float=$?

## STDOUT:
(Float)   0.12345
float=0
(Float)   INFINITY
(Float)   -INFINITY
float=0
(Float)   0.0
(Float)   -0.0
float=0
## END

#### Int constants bigger than 64 bits

# Decimal
$SH -c '
var x = 1111
pp test_ (x)
'
echo dec=$?

$SH -c '
var x = 1111_2222_3333_4444_5555_6666
pp test_ (x)
'
echo dec=$?

# Binary
$SH -c '
var x = 0b11
pp test_ (x)
'
echo bin=$?

$SH -c '
var x = 0b1111_1111_1111_1111_1111_1111_1111_1111_1111_1111_1111_1111_1111_1111_1111_1111_1111_1111
pp test_ (x)
'
echo bin=$?

# Octal
$SH -c '
var x = 0o77
pp test_ (x)
'
echo oct=$?

$SH -c '
var x = 0o1111_2222_3333_4444_5555_6666
pp test_ (x)
'
echo oct=$?

# Hex
$SH -c '
var x = 0xff
pp test_ (x)
'
echo hex=$?

$SH -c '
var x = 0xaaaa_bbbb_cccc_dddd_eeee_ffff
pp test_ (x)
'
echo hex=$?

## STDOUT:
(Int)   1111
dec=0
dec=2
(Int)   3
bin=0
bin=2
(Int)   63
oct=0
oct=2
(Int)   255
hex=0
hex=2
## END

#### Bit shift by negative number is not allowed

shopt -s ysh:upgrade

pp test_ (1 << 1)
pp test_ (1 << 0)
try {
  pp test_ (1 << -1)
}
echo failed $[_error.code]
echo

pp test_ (16 >> 2)
pp test_ (16 >> 1)
pp test_ (16 >> 0)
try {
  pp test_ (16 >> -1)
}
echo failed $[_error.code]

## STDOUT:
(Int)   2
(Int)   1
failed 3

(Int)   4
(Int)   8
(Int)   16
failed 3
## END

#### 64-bit operations

shopt -s ysh:upgrade

var i = 1 << 32
var s = str(i)

echo "i = $i, s = $s"

if (s ~== i) {
  echo equal
}

## STDOUT:
i = 4294967296, s = 4294967296
equal
## END

#### 64-bit integer doesn't overflow

# same as spec/arith.test.sh case 38

var a= 1 << 31 
echo $a

var b = a + a
echo $b

var c = b + a  
echo $c

var x = 1 << 62
var y = x - 1
echo "max positive = $[ x + y ]"

#echo "overflow $[ x + x ]"

## STDOUT:
2147483648
4294967296
6442450944
max positive = 9223372036854775807
## END

#### Integer literals
var d = 123
var b = 0b11
var o = 0o123
var h = 0xff
echo $d $b $o $h
## STDOUT:
123 3 83 255
## END

#### Integer literals with underscores
const dec = 65_536
const bin = 0b0001_0101
const oct = 0o001_755
const hex = 0x0001_000f

echo SHELL
echo $dec
echo $bin
echo $oct
echo $hex
const x = 1_1 + 0b1_1 + 0o1_1 + 0x1_1
echo sum $x

# This works under Python 3.6, but the continuous build has earlier versions
if false; then
  echo ---
  echo PYTHON

  python3 -c '
  print(65_536)
  print(0b0001_0101)
  print(0o001_755)
  print(0x0001_000f)

  # Weird syntax
  print("sum", 1_1 + 0b1_1 + 0o1_1 + 0x1_1)
  '
fi

## STDOUT:
SHELL
65536
21
1005
65551
sum 40
## END

#### Exponentiation with **
var x = 2**3
echo $x

var y = 2.0 ** 3.0  # NOT SUPPORTED
echo 'should not get here'

## status: 3
## STDOUT:
8
## END

#### Float Division
pp test_ (5/2)
pp test_ (-5/2)
pp test_ (5/-2)
pp test_ (-5/-2)

echo ---

var x = 9
setvar x /= 2
pp test_ (x)

var x = -9
setvar x /= 2
pp test_ (x)

var x = 9
setvar x /= -2
pp test_ (x)

var x = -9
setvar x /= -2
pp test_ (x)


## STDOUT:
(Float)   2.5
(Float)   -2.5
(Float)   -2.5
(Float)   2.5
---
(Float)   4.5
(Float)   -4.5
(Float)   -4.5
(Float)   4.5
## END

#### Integer Division (rounds toward zero)
pp test_ (5//2)
pp test_ (-5//2)
pp test_ (5//-2)
pp test_ (-5//-2)

echo ---

var x = 9
setvar x //= 2
pp test_ (x)

var x = -9
setvar x //= 2
pp test_ (x)

var x = 9
setvar x //= -2
pp test_ (x)

var x = -9
setvar x //= -2
pp test_ (x)

## STDOUT:
(Int)   2
(Int)   -2
(Int)   -2
(Int)   2
---
(Int)   4
(Int)   -4
(Int)   -4
(Int)   4
## END

#### % operator is remainder
pp test_ ( 5 % 3)
pp test_ (-5 % 3)

# negative divisor illegal (tested in test/ysh-runtime-errors.sh)
#pp test_ ( 5 % -3)
#pp test_ (-5 % -3)

var z = 10
setvar z %= 3
pp test_ (z)

var z = -10
setvar z %= 3
pp test_ (z)

## STDOUT:
(Int)   2
(Int)   -2
(Int)   1
(Int)   -1
## END

#### Bitwise logical
var a = 0b0101 & 0b0011
echo $a
var b = 0b0101 | 0b0011
echo $b
var c = 0b0101 ^ 0b0011
echo $c
var d = ~b
echo $d
## STDOUT:
1
7
6
-8
## END

#### Shift operators
var a = 1 << 4
echo $a
var b = 16 >> 4
echo $b
## STDOUT:
16
1
## END

#### multiline strings, list, tuple syntax for list, etc.
shopt --set parse_ysh_expr_sub

var dq = "
dq
2
"
echo dq=$[len(dq)]

var sq = '
sq
2
'
echo sq=$[len(sq)]

var mylist = [
  1,
  2,
  3,
]
echo mylist=$[len(mylist)]

var mytuple = (1,
  2, 3)
echo mytuple=$[len(mytuple)]

## STDOUT:
dq=6
sq=6
mylist=3
mytuple=3
## END

