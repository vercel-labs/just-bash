#### Augmented assignment doesn't work on List

# I suppose the logic is that string and array concat is ++
#
# I wonder if a ++= operator makes sense?

shopt -s parse_at simple_word_eval
var x = :| a 'b c' |
argv.py @x

setvar x += :| d e |  # fatal error
argv.py @x
## status: 3
## STDOUT:
['a', 'b c']
## END

#### Augmented assignment respects command_sub_errexit


var x = '42'
setvar x += $(echo 3)
echo x=$x

setvar x += $(echo 3; false)
echo x=$x

## status: 1
## STDOUT:
x=45
## END


#### Augmented assignment with integers
var x = 1 + 2 * 3
echo x=$x

setvar x += 4 * 1
echo x=$x
## STDOUT:
x=7
x=11
## END

#### Augmented assignment on string changes to Int Float

var x = '42'
pp test_ (x)

setvar x += 4 * 1
pp test_ (x)

setvar x += '9'
pp test_ (x)

setvar x = '42'
setvar x /= 4
pp test_ (x)

## STDOUT:
(Str)   "42"
(Int)   46
(Int)   55
(Float)   10.5
## END

#### Augmented assignment with floats

var x = 42

setvar x += 1.5
echo $x

setvar x += '1.5'
echo $x

setvar x += '3'
echo $x
## STDOUT:
43.5
45.0
48.0
## END

#### Int/Float augmented += -= *= /=

var x = 0

setvar x = 10
setvar x -= 3
echo x=$x

setvar x = 10
setvar x *= 3
echo x=$x

var x = 0
setvar x = 10
setvar x /= 2
echo x=$x

## STDOUT:
x=7
x=30
x=5.0
## END

#### Int Augmented //= %= **= and bitwise ops

var x = 0

setvar x = 10
setvar x //= 3
echo x=$x

setvar x = 10
setvar x %= 3
echo x=$x

setvar x = 10
setvar x **= 3
echo x=$x

echo
echo bitwise

setvar x  = 0b1111
setvar x &= 0b0101
echo x=$x

setvar x  = 0b1000
setvar x |= 0b0111
echo x=$x

setvar x = 0b1010
setvar x ^= 0b1001
echo x=$x

echo
echo shift

setvar x = 0b1000
setvar x <<= 1
echo x=$x

setvar x = 0b1000
setvar x >>= 1
echo x=$x

## STDOUT:
x=3
x=1
x=1000

bitwise
x=5
x=15
x=3

shift
x=16
x=4
## END

#### Augmented assignment of Dict

shopt -s parse_ysh_expr_sub

var d = {x: 42}

setvar d['x'] += 1.5
echo $[d.x]

setvar d.x += '1.5'
echo $[d.x]

setvar d.x += '3'
echo $[d.x]

## STDOUT:
43.5
45.0
48.0
## END

#### Augmented assignment of List

shopt -s parse_at

var mylist = :| 32 42 |

setvar mylist[0] -= 1
echo @mylist

setvar mylist[1] //= 2
echo @mylist

setvar mylist[1] /= 2
echo @mylist


## STDOUT:
31 42
31 21
31 10.5
## END

#### Dict with nonexistent key (bug fix)

shopt -s parse_ysh_expr_sub

var d = {x: 42}

setvar d.x += 1
setglobal d.x += 1
echo $[d.x]

setvar d.missing -= 1
setglobal d.missing -= 1


## status: 3
## STDOUT:
44
## END


#### List with nonexistent elemnt
var L = [42]
setvar L[99] += 1

## status: 3
## STDOUT:
## END


#### Augmented assignment doesn't work with multiple LHS

var x = 3
var y = 4
setvar x, y += 2
echo $x $y

## status: 2
## STDOUT:
## END



