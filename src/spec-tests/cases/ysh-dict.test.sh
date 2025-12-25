#### "in" and "not in" on Dicts

var d = {spam: 42, eggs: []}

var b = 'spam' in d
echo $b

var b = 'zz' in d
echo $b

var b = 'zz' not in d
echo $b

var L = [1, 2, 3]
var b = 3 in L  # not allowed!

echo should not get here

## status: 3
## STDOUT:
true
false
true
## END

#### dict with 'bare word' keys
shopt --set parse_ysh_expr_sub

var d0 = {}
echo len=$[len(d0)]
var d1 = {name: "hello"}
echo len=$[len(d1)]
var d2 = {name: "hello", other: 2}
echo len=$[len(d2)]
## STDOUT:
len=0
len=1
len=2
## END

#### dict with expression keys
shopt --set parse_ysh_expr_sub

var d1 = {['name']: "hello"}
echo len=$[len(d1)]
var v = d1['name']
echo $v

var key='k'
var d2 = {["$key"]: "bar"}
echo len=$[len(d2)]
var v2 = d2['k']
echo $v2

## STDOUT:
len=1
hello
len=1
bar
## END


#### dict literal with implicit value
shopt --set parse_ysh_expr_sub

var name = 'foo'
var d1 = {name}
echo len=$[len(d1)]
var v1 = d1['name']
echo $v1

var d2 = {name, other: 'val'}
echo len=$[len(d2)]
var v2 = d2['name']
echo $v2

## STDOUT:
len=1
foo
len=2
foo
## END

#### Dict literal with string keys
var d = {'sq': 123}
var v = d['sq']
echo $v

var x = "q"
var d2 = {"d$x": 456}
var v2 = d2["dq"]
echo $v2
## STDOUT:
123
456
## END


#### keys(d), values(d), get(d, key)

var d = {a: 42, b: 99}

pp test_ (keys(d))
pp test_ (values(d))

pp test_ (get(d, 'a', 'default'))
pp test_ (get(d, 'key', 'default'))

## STDOUT:
(List)   ["a","b"]
(List)   [42,99]
(Int)   42
(Str)   "default"
## END

#### get() has default null

var d = {a: 42}

pp test_ (get(d, 'b'))

## STDOUT:
(Null)   null
## END


