## oils_failures_allowed: 1

# Test a[1]

#### precedence of 1:3 vs comparison

# This test exposed nondeterminism in CPython itself!  Gah.  Is this because of
# the hashing?
# Python xrange objects probably shouldn't even be comparable!
#
# = 1..3 < 1..4
# >>> xrange(1,3)  < xrange(1,4)
# False
# >>> xrange(1,3)  < xrange(1,4)
# True

= 1..<3

## STDOUT:
(Range 1 ..< 3)
## END

#### precedence of 1:3 vs bitwise operator
= 3..<3|4
## STDOUT:
(Range 3 ..< 7)
## END

#### subscript and slice :| 1 2 3 4 |
var myarray = :|1 2 3 4|
pp test_ (myarray[1])
pp test_ (myarray[1:3])

echo 'implicit'
pp test_ (myarray[:2])
pp test_ (myarray[2:])

echo 'out of bounds'
pp test_ (myarray[:5])
pp test_ (myarray[-5:])

# Stride not supported
#= myarray[1:4:2]

# Now try omitting some
#= myarray[1:4:2]
## STDOUT:
(Str)   "2"
(List)   ["2","3"]
implicit
(List)   ["1","2"]
(List)   ["3","4"]
out of bounds
(List)   ["1","2","3","4"]
(List)   ["1","2","3","4"]
## END

#### Range end points can be int-looking Strings

pp test_ (list('3' ..< '6'))

var i = '5'

pp test_ (list(i ..< 7))
pp test_ (list(3 ..< i))

var i = '-5'

pp test_ (list(i ..< -3))
pp test_ (list(-7 ..< i))

# Not allowed
pp test_ ('a' ..< 'z')

## status: 3
## STDOUT:
(List)   [3,4,5]
(List)   [5,6]
(List)   [3,4]
(List)   [-5,-4]
(List)   [-7,-6]
## END

#### Slice indices can be int-looking strings

var a = list(0..<10)
#pp test_ (a)

pp test_ (a['3': '6'])

var i = '5'

pp test_ (a[i : 7])
pp test_ (a[3 : i])

var i = '-5'

pp test_ (a[i : -3])
pp test_ (a[-7 : i])

# Not allowed
pp test_ (a['a' : 'z'])

## status: 3
## STDOUT:
(List)   [3,4,5]
(List)   [5,6]
(List)   [3,4]
(List)   [5,6]
(List)   [3,4]
## END


#### slice subscripts are adjusted like Python

show-py() {
  python3 -c '
import json, sys; a = [1, 2, 3, 4, 5]; print(json.dumps(eval(sys.argv[1])))' $1
}

show-ysh() {
  eval "var a = [1, 2, 3, 4, 5]; json write ($1, space=0)"
}

compare() {
  local expr=$1
  show-py "$1" | sed 's/ //g'
  show-ysh "$1"
  echo
}

compare 'a[1:3]'
compare 'a[1:100]'  # big number
compare 'a[100:1]'  # inverted
compare 'a[1:-1]'
compare 'a[-3:-1]'
compare 'a[-100:-1]'  # very negative
compare 'a[-1:-100]'  # inverted
compare 'a[4:5]'

## STDOUT:
[2,3]
[2,3]

[2,3,4,5]
[2,3,4,5]

[]
[]

[2,3,4]
[2,3,4]

[3,4]
[3,4]

[1,2,3,4]
[1,2,3,4]

[]
[]

[5]
[5]

## END


#### subscript and slice of List
var mylist = [1,2,3,4]
pp test_ (mylist[1])
pp test_ (mylist[1:3])

echo 'implicit'
pp test_ (mylist[:2])
pp test_ (mylist[2:])
## STDOUT:
(Int)   2
(List)   [2,3]
implicit
(List)   [1,2]
(List)   [3,4]
## END

#### expressions and negative indices
var myarray = :|1 2 3 4 5|
pp test_ (myarray[-1])
pp test_ (myarray[-4:-2])

echo 'implicit'
pp test_ (myarray[:-2])
pp test_ (myarray[-2:])
## STDOUT:
(Str)   "5"
(List)   ["2","3"]
implicit
(List)   ["1","2","3"]
(List)   ["4","5"]
## END

#### Index with expression
var mydict = {['5']: 3}
var val = mydict["$[2+3]"]
echo $val
## STDOUT:
3
## END

#### Copy with a[:]
var a = [1,2,3]
var b = a[:]
pp test_ (b)
## STDOUT:
(List)   [1,2,3]
## END

#### Iterate over range
for i in (1..<5) {
    echo $[i]
}
for i, n in (1..<4) {
    echo "$[i], $[n]"
}
## STDOUT:
1
2
3
4
0, 1
1, 2
2, 3
## END

#### Loops over bogus ranges terminate
# Regression test for bug found during dev. Loops over backwards ranges should
# terminate immediately.
for i in (5..<1) {
    echo $[i]
}
## STDOUT:
## END

#### Slices with Multiple Dimensions (for TSV8?)

qtt pretty :mytable <<< '''
name  age:Int
alice 42
bob   31
carol 20
'''

# Cut off the first two rows
var t1 = mytable[2:, :]
= t1

var t2 = mytable[:2, 3:4]
= t2

var t3 = mytable[:2, %(name age)]
= t3

## STDOUT:
(Str)   'TODO: Table Slicing'
(Str)   'TODO: Table Slicing'
## END

#### Closed ranges

for x in (1..=2) {
  echo $x
}

= 1..=2
## STDOUT:
1
2
(Range 1 ..< 3)
## END
