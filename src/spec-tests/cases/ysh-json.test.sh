## oils_failures_allowed: 1
## tags: dev-minimal

#### usage errors

json read zz
echo status=$?

json write

## status: 3
## STDOUT:
status=2
## END

#### json write STRING
shopt --set parse_proc

json write ('foo')
var s = 'foo'
json write (s)
## STDOUT:
"foo"
"foo"
## END

#### json write ARRAY
json write (:|foo.cc foo.h|)
json write (['foo.cc', 'foo.h'], space=0)
## STDOUT:
[
  "foo.cc",
  "foo.h"
]
["foo.cc","foo.h"]
## END

#### json write Dict
json write ({k: 'v', k2: [4, 5]})

json write ([{k: 'v', k2: 'v2'}, {}])

## STDOUT:
{
  "k": "v",
  "k2": [
    4,
    5
  ]
}
[
  {
    "k": "v",
    "k2": "v2"
  },
  {}
]
## END

#### json write space=0, space=4
shopt --set parse_proc

var mydict = {name: "bob", age: 30}

json write (mydict, space=0)
json write (mydict, space=4)
## STDOUT:
{"name":"bob","age":30}
{
    "name": "bob",
    "age": 30
}
## END

#### json write in command sub
shopt -s oil:all  # for echo
var mydict = {name: "bob", age: 30}
json write (mydict)
var x = $(json write (mydict))
echo $x
## STDOUT:
{
  "name": "bob",
  "age": 30
}
{
  "name": "bob",
  "age": 30
}
## END

#### json read passed invalid args

# EOF
json read
echo status=$?

json read 'z z'
echo status=$?

json read a b c
echo status=$?

## STDOUT:
status=1
status=2
status=2
## END

#### json read uses $_reply var

# space before true
echo ' true' | json read
json write (_reply)

## STDOUT:
true
## END

#### json read then json write

# BUG with space before true
echo '{"name": "bob", "age": 42, "ok": true}' | json read
json write (_reply)

echo '{"name": "bob", "age": 42, "ok":true}' | json read
json write (_reply)

echo '{"name": {}, "age": {}, "x":-1, "y": -0}' | json read
json write (_reply)

## STDOUT:
{
  "name": "bob",
  "age": 42,
  "ok": true
}
{
  "name": "bob",
  "age": 42,
  "ok": true
}
{
  "name": {},
  "age": {},
  "x": -1,
  "y": 0
}
## END

#### json read with redirect
echo '{"age": 42}'  > $TMP/foo.txt
json read (&x) < $TMP/foo.txt
pp cell_ x
## STDOUT:
x = (Cell exported:F readonly:F nameref:F val:(value.Dict d:{age (value.Int i:42)}))
## END

#### json read at end of pipeline (relies on lastpipe)
echo '{"age": 43}' | json read (&y)
pp cell_ y
## STDOUT:
y = (Cell exported:F readonly:F nameref:F val:(value.Dict d:{age (value.Int i:43)}))
## END

#### invalid JSON
echo '{' | json read (&y)
echo pipeline status = $?
pp test_ (y)
## status: 1
## STDOUT:
pipeline status = 1
## END

#### Extra data after valid JSON

# Trailing space is OK
echo '42  ' | json read
echo num space $?

echo '{}  ' | json read
echo obj space $?

echo '42 # comment' | json8 read
echo num comment $?

echo '{}   # comment ' | json8 read
echo obj comment $?

echo '42]' | json read
echo num bracket $?

echo '{}]' | json read
echo obj bracket $?

## STDOUT:
num space 0
obj space 0
num comment 0
obj comment 0
num bracket 1
obj bracket 1
## END

#### json write expression
json write ([1,2,3], space=0)
echo status=$?

json write (5, 6)  # to many args
echo status=$?

## status: 3
## STDOUT:
[1,2,3]
status=0
## END

#### json write evaluation error

#var block = ^(echo hi)
#json write (block) 
#echo status=$?

# undefined var
json write (a) 
echo 'should have failed'

## status: 1
## STDOUT:
## END

#### json write of List in cycle

var L = [1, 2, 3]
setvar L[0] = L
pp test_ (L)

json write (L)
echo status=$?

## status: 0
## STDOUT:
(List)   [[...],2,3]
status=1
## END

#### json write of Dict in cycle

var d = {}
setvar d.k = d

pp test_ (d)

json write (d)
echo status=$?

## STDOUT:
(Dict)   {"k":{...}}
status=1
## END

#### json write of List/Dict referenced twice (bug fix)

var mylist = [1,2,3]
var mydict = {foo: "bar"}

var top = {k: mylist, k2: mylist, k3: mydict, k4: mydict}

# BUG!
json write (top, space=0)

## STDOUT:
{"k":[1,2,3],"k2":[1,2,3],"k3":{"foo":"bar"},"k4":{"foo":"bar"}}
## END

#### json read doesn't accept u'' or b'' strings

json read <<EOF
{"key": u'val'}
EOF
echo status=$?

#pp test_ (_reply)

json read <<EOF
{"key": b'val'}
EOF
echo status=$?

## STDOUT:
status=1
status=1
## END

#### json read doesn't accept comments, but json8 does

json8 read <<EOF
{  # comment
  "key":  # zz
  b'val',  # yy
  "k2": "v2"  #
}
EOF
echo status=$?

json8 write (_reply)

json read <<EOF
{"key": "val"}  # comment
EOF
echo status=$?
## STDOUT:
status=0
{
  "key": "val",
  "k2": "v2"
}
status=1
## END


#### json write emits Unicode replacement char for binary data \yff

json write ([3, "foo", $'-\xff\xfe---\xfd=']) > tmp.txt

# Round trip it for good measure
json read < tmp.txt

json write (_reply)

## STDOUT:
[
  3,
  "foo",
  "-��---�="
]
## END

#### json8 accepts j"" prefix, but json doesn't

var msg = r'j"foo\nbar"'

echo "$msg" | json read
echo json=$?
echo

echo "$msg" | json8 read
echo json8=$?
pp test_ (_reply)
echo

var msg = r'j"\u0041"'
echo "$msg" | json8 read
echo json8=$?
pp test_ (_reply)


## STDOUT:
json=1

json8=0
(Str)   "foo\nbar"

json8=0
(Str)   "A"
## END

#### j"" prefix not accepted in YSH (could be added later)

shopt -s ysh:all

# denied by YSH
# echo j"\u{7f}"

var s = j"\u{7f}"

## status: 2
## STDOUT:
## END


#### json8 write emits b'' strings for binary data \yff

json8 write ([3, "foo", $'-\xff\xfe-\xfd='])

## STDOUT:
[
  3,
  "foo",
  b'-\yff\yfe-\yfd='
]
## END


#### json8 write bytes vs unicode string

u=$'mu \u03bc \x01 \" \\ \b\f\n\r\t'
u2=$'\x01\x1f'  # this is a valid unicode string

b=$'\xff'  # this isn't valid unicode

json8 write (u)
json8 write (u2)

json8 write (b)

## STDOUT:
"mu μ \u0001 \" \\ \b\f\n\r\t"
"\u0001\u001f"
b'\yff'
## END

#### JSON \/ escapes supported

msg='"\/"'

echo "$msg" | python3 -c 'import json, sys; print(json.load(sys.stdin))'

echo "$msg" | json read
echo reply=$_reply

j8="b'\\/'"
echo "$msg" | json read
echo reply=$_reply


## STDOUT:
/
reply=/
reply=/
## END

#### JSON string can have unescaped ' and J8 string can have unescaped "

json read <<EOF
"'"
EOF

pp test_ (_reply)

json8 read <<EOF
u'"'
EOF

pp test_ (_reply)

## STDOUT:
(Str)   "'"
(Str)   "\""
## END


#### J8 supports superfluous \" escapes, but JSON doesn't support \' escapes

json8 read <<'EOF'
b'\"'
EOF
echo reply=$_reply

json8 read <<'EOF'
b'\'\'\b\f\n\r\t\"\\'
EOF
pp test_ (_reply)

# Suppress traceback
python3 -c 'import json, sys; print(json.load(sys.stdin))' 2>/dev/null <<'EOF'
"\'"
EOF
echo python3=$?

json read <<'EOF'
"\'"
EOF
echo json=$?

## STDOUT:
reply="
(Str)   "''\b\f\n\r\t\"\\"
python3=1
json=1
## END

#### Escaping uses \u0001 in "", but \u{1} in b''

s1=$'\x01'
s2=$'\x01\xff\x1f'  # byte string

json8 write (s1)
json8 write (s2)

## STDOUT:
"\u0001"
b'\u{1}\yff\u{1f}'
## END


#### json8 read

echo '{ }' | json8 read
pp test_ (_reply)

echo '[ ]' | json8 read
pp test_ (_reply)

echo '[42]' | json8 read
pp test_ (_reply)

echo '[true, false]' | json8 read
pp test_ (_reply)

echo '{"k": "v"}' | json8 read
pp test_ (_reply)

echo '{"k": null}' | json8 read
pp test_ (_reply)

echo '{"k": 1, "k2": 2}' | json8 read
pp test_ (_reply)

echo "{u'k': {b'k2': null}}" | json8 read
pp test_ (_reply)

echo '{"k": {"k2": "v2"}, "k3": "backslash \\ \" \n line 2 \u03bc "}' | json8 read
pp test_ (_reply)

json8 read (&x) <<'EOF'
{u'k': {u'k2': u'v2'}, u'k3': u'backslash \\ \" \n line 2 \u{3bc} '}
EOF
pp test_ (x)

## STDOUT:
(Dict)   {}
(List)   []
(List)   [42]
(List)   [true,false]
(Dict)   {"k":"v"}
(Dict)   {"k":null}
(Dict)   {"k":1,"k2":2}
(Dict)   {"k":{"k2":null}}
(Dict)   {"k":{"k2":"v2"},"k3":"backslash \\ \" \n line 2 μ "}
(Dict)   {"k":{"k2":"v2"},"k3":"backslash \\ \" \n line 2 μ "}
## END

#### json8 round trip

var obj = [42, 1.5, null, true, "hi", b'\yff\yfe\b\n""']

json8 write (obj, space=0) > j

cat j

json8 read < j

json8 write (_reply)

## STDOUT:
[42,1.5,null,true,"hi",b'\yff\yfe\b\n""']
[
  42,
  1.5,
  null,
  true,
  "hi",
  b'\yff\yfe\b\n""'
]
## END

#### json round trip (regression)

var d = {
  short: '-v', long: '--verbose', type: null, default: '', help: 'Enable verbose logging'
}

json write (d) | json read

pp test_ (_reply)

## STDOUT:
(Dict)   {"short":"-v","long":"--verbose","type":null,"default":"","help":"Enable verbose logging"}
## END

#### round trip: decode surrogate pair and encode

var j = r'"\ud83e\udd26"'
echo $j | json read (&c1)

json write (c1)

var j = r'"\uD83E\uDD26"'
echo $j | json read (&c2)

json write (c2)

# Not a surrogate pair
var j = r'"\u0001\u0002"' 
echo $j | json read (&c3)

json write (c3)

var j = r'"\u0100\u0101\u0102"' 
echo $j | json read (&c4)

json write (c4)

## STDOUT:
"🤦"
"🤦"
"\u0001\u0002"
"ĀāĂ"
## END

#### round trip: decode surrogate half and encode

shopt -s ysh:upgrade

for j in '"\ud83e"' '"\udd26"' {
  var s = fromJson(j)
  write -- "$j"
  pp test_ (s)

  write -n 'json ';  json write (s)

  write -n 'json8 '; json8 write (s)

  echo
}

## STDOUT:
"\ud83e"
(Str)   b'\yed\ya0\ybe'
json "\ud83e"
json8 b'\yed\ya0\ybe'

"\udd26"
(Str)   b'\yed\yb4\ya6'
json "\udd26"
json8 b'\yed\yb4\ya6'

## END

#### toJson() toJson8()
shopt --set parse_ysh_expr_sub

var obj = [42, 1.5, null, true, "hi", b'\yf0']

echo $[toJson(obj)]
echo $[toJson8(obj)]

var obj2 = [3, 4]
echo $[toJson(obj2, space=0)]  # same as the default
echo $[toJson8(obj2, space=0)]

echo $[toJson(obj2, space=2)]
echo $[toJson8(obj2, space=2)]

# fully specify this behavior
echo $[toJson(obj2, space=-2)]
echo $[toJson8(obj2, space=-2)]

## STDOUT:
[42,1.5,null,true,"hi","�"]
[42,1.5,null,true,"hi",b'\yf0']
[3,4]
[3,4]
[
  3,
  4
]
[
  3,
  4
]
[3,4]
[3,4]
## END

#### fromJson() fromJson8()

var m1 = '[42,1.5,null,true,"hi"]'

# JSON8 message
var m2 = '[42,1.5,null,true,"hi",' ++ "u''" ++ ']'

pp test_ (fromJson8(m1))
pp test_ (fromJson(m1))

pp test_ (fromJson8(m2))
pp test_ (fromJson(m2))  # fails

## status: 4
## STDOUT:
(List)   [42,1.5,null,true,"hi"]
(List)   [42,1.5,null,true,"hi"]
(List)   [42,1.5,null,true,"hi",""]
## END

#### User can handle errors - toJson() toJson8()
shopt -s ysh:upgrade

var obj = []
call obj->append(obj)

try {
  echo $[toJson(obj)]
}
echo status=$[_error.code]
echo "encode error $[_error.message]" | sed 's/0x[a-f0-9]\+/(object id)/'

try {  # use different style
  echo $[toJson8( /d+/ )]
}
echo status=$[_error.code]
echo "encode error $[_error.message]"

# This makes the interpreter fail with a message
echo $[toJson(obj)]

## status: 4
## STDOUT:
status=4
encode error Can't encode List (object id) in object cycle
status=4
encode error Can't serialize object of type Eggex
## END

#### User can handle errors - fromJson() fromJson8()
shopt -s ysh:upgrade

var message ='[42,1.5,null,true,"hi"'

try {
  var obj = fromJson(message)
}
echo status=$[_error.code]
echo "decode error $[_error.message]" | egrep -o '.*Expected.*RBracket'

try {
  var obj = fromJson8(message)
}
echo status=$[_error.code]
echo "decode error $[_error.message]" | egrep -o '.*Expected.*RBracket'

try {
  var obj = fromJson('[+]')
}
echo "positions $[_error.start_pos] - $[_error.end_pos]"

# This makes the interpreter fail with a message
var obj = fromJson(message)

## status: 4
## STDOUT:
status=4
decode error Expected Id.J8_RBracket
status=4
decode error Expected Id.J8_RBracket
positions 1 - 2
## END


#### ASCII control chars can't appear literally in messages
shopt -s ysh:upgrade

var message=$'"\x01"'
#echo $message | od -c

try {
  var obj = fromJson(message)
}
echo status=$[_error.code]
echo "$[_error.message]" | egrep -o 'ASCII control chars'

## STDOUT:
status=4
ASCII control chars
## END


#### \yff can't appear in u'' code strings (command)

shopt -s ysh:upgrade

echo -n b'\yfd' | od -A n -t x1
echo -n u'\yfd' | od -A n -t x1

## status: 2
## STDOUT:
 fd
## END

#### \yff can't appear in u'' code strings (expr)

var x = b'\yfe' 
write -n -- $x | od -A n -t x1

var x = u'\yfe' 
write -n -- $x | od -A n -t x1

## status: 2
## STDOUT:
 fe
## END

#### \yff can't appear in u'' multiline code strings

shopt -s ysh:upgrade

echo -n b'''\yfc''' | od -A n -t x1
echo -n u'''\yfd''' | od -A n -t x1

## status: 2
## STDOUT:
 fc
## END

#### \yff can't appear in u'' data strings

#shopt -s ysh:upgrade

json8 read (&b) <<'EOF'
b'\yfe'
EOF
pp test_ (b)

json8 read (&u) <<'EOF'
u'\yfe'
EOF
pp test_ (u)  # undefined

## status: 1
## STDOUT:
(Str)   b'\yfe'
## END

#### \u{dc00} can't be in surrogate range in code (command)

shopt -s ysh:upgrade

echo -n u'\u{dc00}' | od -A n -t x1

## status: 2
## STDOUT:
## END

#### \u{dc00} can't be in surrogate range in code (expr)

shopt -s ysh:upgrade

var x = u'\u{dc00}' 
echo $x | od -A n -t x1

## status: 2
## STDOUT:
## END

#### \u{dc00} can't be in surrogate range in data

json8 read <<'EOF'
["long string", u'hello \u{d7ff}', "other"]
EOF
echo status=$?

json8 read <<'EOF'
["long string", u'hello \u{d800}', "other"]
EOF
echo status=$?

json8 read <<'EOF'
["long string", u'hello \u{dfff}', "other"]
EOF
echo status=$?

json8 read <<'EOF'
["long string", u'hello \u{e000}', "other"]
EOF
echo status=$?


## STDOUT:
status=0
status=1
status=1
status=0
## END


#### Inf is encoded as null, like JavaScript

# WRONG LOCATION!  Gah
#var x = fromJson(repeat('123', 20))

shopt --set ysh:upgrade

source $LIB_YSH/list.ysh

# Create inf
var big = repeat('12345678', 100) ++ '.0'
#pp test_ (s)
var inf = fromJson(big)
var neg_inf = fromJson('-' ++ big)

# Can be printed
pp test_ (inf)
pp test_ (neg_inf)
echo --

# Can't be serialized
try {
  json write (inf)
}
echo error=$[_error.code]

try {
  json write (neg_inf)
}
echo error=$[_error.code]

echo --
echo $[toJson(inf)]
echo $[toJson(neg_inf)]

## STDOUT:
(Float)   INFINITY
(Float)   -INFINITY
--
null
error=0
null
error=0
--
null
null
## END

#### NaN is encoded as null, like JavaScript
shopt --set parse_ysh_expr_sub

pp test_ (NAN)

json write (NAN)

echo $[toJson(NAN)]

## STDOUT:
(Float)   NAN
null
null
## END


#### Invalid UTF-8 in JSON is rejected

echo $'"\xff"' | json read
echo status=$?

echo $'"\xff"' | json8 read
echo status=$?

echo $'\xff' | json read
echo status=$?

echo $'\xff' | json8 read
echo status=$?

## STDOUT:
status=1
status=1
status=1
status=1
## END

#### Invalid JSON in J8 is rejected

json8 read <<EOF
b'$(echo -e -n '\xff')'
EOF
echo status=$?

json8 read <<EOF
u'$(echo -e -n '\xff')'
EOF
echo status=$?

## STDOUT:
status=1
status=1
## END

#### '' means the same thing as u''

echo "''" | json8 read
pp test_ (_reply)

echo "'\u{3bc}'" | json8 read
pp test_ (_reply)

echo "'\yff'" | json8 read
echo status=$?

## STDOUT:
(Str)   ""
(Str)   "μ"
status=1
## END

#### decode integer larger than 2^32

json=$(( 1 << 33 ))
echo $json

echo $json | json read
pp test_ (_reply)

## STDOUT:
8589934592
(Int)   8589934592
## END

#### decode integer larger than 2^64

$SH <<'EOF'
json read <<< '123456789123456789123456789'
echo status=$?
pp test_ (_reply)
EOF

$SH <<'EOF'
json read <<< '-123456789123456789123456789'
echo status=$?
pp test_ (_reply)
EOF

echo ok

## STDOUT:
status=1
status=1
ok
## END


#### round trip: read/write with ysh

var file = "$REPO_ROOT/spec/testdata/bug.json"
#cat $file
cat $file | json read (&cfg)
json write (cfg) > ysh-json

diff -u $file ysh-json
echo diff=$?

## STDOUT:
diff=0
## END

#### round trip: read/write with ysh, read/write with Python 3 (bug regression)

var file = "$REPO_ROOT/spec/testdata/bug.json"
#cat $file
cat $file | json read (&cfg)
json write (cfg) > ysh-json

cat ysh-json | python3 -c \
  'import json, sys; obj = json.load(sys.stdin); json.dump(obj, sys.stdout, indent=2); print()' \
  > py-json

diff -u $file py-json
echo diff=$?

## STDOUT:
diff=0
## END

#### Encoding bytes that don't hit UTF8_REJECT immediately (bug fix)

var x = $'\xce'
json8 write (x)
declare -p x
echo

var y = $'\xbc'
json8 write (y)
declare -p y
echo

var z = $'\xf0\x9f\xa4\xff'
json8 write (z)
declare -p z

## STDOUT:
b'\yce'
declare -- x=$'\xce'

b'\ybc'
declare -- y=$'\xbc'

b'\yf0\y9f\ya4\yff'
declare -- z=$'\xf0\x9f\xa4\xff'
## END

#### NIL8 token in JSON / JSON8

echo "(" | json read
echo status=$?

echo ")" | json8 read
echo status=$?

## STDOUT:
status=1
status=1
## END

#### Data after internal NUL (issue #2026)

$SH <<'EOF'
pp test_ (fromJson(b'123\y00abc'))
EOF
echo status=$?

$SH <<'EOF'
pp test_ (fromJson(b'123\y01abc'))
EOF
echo status=$?

$SH <<'EOF'
shopt --set ysh:upgrade  # b'' syntax
json read <<< b'123\y00abc'
EOF
echo status=$?

$SH <<'EOF'
shopt --set ysh:upgrade  # b'' syntax
json read <<< b'123\y01abc'
EOF
echo status=$?

## STDOUT:
status=4
status=4
status=1
status=1
## END

#### Float too big

$SH <<'EOF'
json read <<< '123456789123456789123456789.12345e67890'
echo status=$?
pp test_ (_reply)
EOF

$SH <<'EOF'
json read <<< '-123456789123456789123456789.12345e67890'
echo status=$?
pp test_ (_reply)
EOF

## STDOUT:
status=0
(Float)   INFINITY
status=0
(Float)   -INFINITY
## END

#### Many [[[ , but not too many

shopt -s ysh:upgrade

proc pairs(n) {
  var m = int(n)  # TODO: 1 .. n should auto-convert?

  for i in (1 ..< m) {
    write -n -- '['
  }
  for i in (1 ..< m) {
    write -n -- ']'
  }
}

# This is all Python can handle; C++ can handle more
msg=$(pairs 50)

#echo $msg

echo "$msg" | json read
pp test_ (_reply)
echo len=$[len(_reply)]

## STDOUT:
(List)   [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]
len=1
## END


#### Too many opening [[[ - blocking stack

python2 -c 'print("[" * 10000)' | json read
pp test_ (_reply)

python2 -c 'print("{" * 10000)' | json read
pp test_ (_reply)

## STDOUT:
## END

#### BashArray can be serialized

declare -a empty_array

declare -a array=(x y)
array[5]=z

json write (empty_array)
json write (array)

## STDOUT:
{
  "type": "BashArray",
  "data": {}
}
{
  "type": "BashArray",
  "data": {
    "0": "x",
    "1": "y",
    "5": "z"
  }
}
## END

#### BashAssoc can be serialized

declare -A empty_assoc

declare -A assoc=([foo]=bar [42]=43)

json write (empty_assoc)
json write (assoc)

## STDOUT:
{
  "type": "BashAssoc",
  "data": {}
}
{
  "type": "BashAssoc",
  "data": {
    "foo": "bar",
    "42": "43"
  }
}
## END

#### type_errors=false
shopt --set parse_ysh_expr_sub

var o = Obj.new({}, null)

#json write (o)
json write (o, type_errors=false)

var pat = /d+/
#json write (pat)
json write (pat, type_errors=false)

var d = {key: pat, key2: o}
json write (d, type_errors=false)

echo

echo $[toJson(o, type_errors=false)]
echo $[toJson8(o, type_errors=false)]
echo $[toJson8(d, type_errors=false)]

## STDOUT:
null
null
{
  "key": null,
  "key2": null
}

null
null
{"key":null,"key2":null}
## END

