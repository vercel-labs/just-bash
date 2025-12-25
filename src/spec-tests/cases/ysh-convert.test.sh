#### bool() conversion
shopt --set parse_ysh_expr_sub

echo "$[bool(1234)]"
echo "$[bool(0)]"
echo "$[bool('foo')]"
echo "$[bool(true)]"
echo "$[bool(1.234)]"
echo "$[bool([])]"
echo "$[bool({})]"
echo "$[bool(null)]"
echo "$[bool(len)]"
echo "$[bool('foo'=>startsWith)]"
echo "$[bool(1..<3)]"
## STDOUT:
true
false
true
true
true
false
false
false
true
true
true
## END

#### bool() more
var a = bool( :|| )
var b = bool( :|foo| )
write $a $b
## STDOUT:
false
true
## END


#### int() conversion
shopt --set parse_ysh_expr_sub

echo "$[int(1234)]"
echo "$[int('1234')]"
echo "$[int(1.234)]"
## STDOUT:
1234
1234
1
## END

#### int() more
pp test_ (int("3"))
pp test_ (int("-35"))
pp test_ (int('5_6'))

shopt -s ysh:upgrade

try {
  var c = int("bad")
}
echo code=$[_error.code]

## STDOUT:
(Int)   3
(Int)   -35
(Int)   56
code=3
## END

#### float() conversion
shopt --set parse_ysh_expr_sub

echo "$[float(1234)]"
echo "$[float('1.234')]"
echo "$[float(2.345)]"
## STDOUT:
1234.0
1.234
2.345
## END

#### float() overflow / underflow

var a = float("1.2")
var b = float("3.4")

var c = float("42.1e500")
var d = float("-42.1e500")

write $a $b $c $d
## STDOUT:
1.2
3.4
inf
-inf
## END

#### str() conversion
shopt --set parse_ysh_expr_sub

echo $[str(1234)]
echo $[str(1.234)]
echo $[str('foo')]

echo

# Added with Stringify()

echo $[str(true)]
echo $[str(null)]
echo $[str(/d+/)]

echo $[str([1,2,3])]

## status: 3
## STDOUT:
1234
1.234
foo

true
null
[[:digit:]]+
## END

#### dict() converts from BashAssoc to Dict
declare -A foo
foo=([a]=1 [b]=2 [c]=3)

json write (type(foo))
json write (dict(foo))
## STDOUT:
"BashAssoc"
{
  "a": "1",
  "b": "2",
  "c": "3"
}
## END

#### dict() does shallow copy
shopt --set parse_ysh_expr_sub

var d = {'a': 1}
var d2 = d
setvar d2['b'] = 2
echo $['b' in d] # d2 should be an alias for d

var d3 = dict(d)
setvar d3['c'] = 3

# d3 should NOT be an alias
echo $['c' in d]
echo $['c' in d3]
## STDOUT:
true
false
true
## END

#### list() does shallow copy
shopt --set parse_ysh_expr_sub

var l = [1]
var l2 = l
call l2->append(2)
echo $[len(l)] # d2 should be an alias for d

var l3 = list(l)
call l3->append(3)

# l3 should NOT be an alias
echo $[len(l)]
echo $[len(l3)]
## STDOUT:
2
2
3
## END

#### list() from Dict
shopt -s ysh:upgrade

var a = list({'a': 1, 'foo': 'bar'})
write @a
## STDOUT:
a
foo
## END


#### list() from range
shopt -s ysh:upgrade

var mylist = list(0..<3)
write @mylist
## STDOUT:
0
1
2
## END

