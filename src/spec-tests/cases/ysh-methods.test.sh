# spec/ysh-methods

## our_shell: ysh

#### => operator for pure computation is allowed (may be mandatory later)

# later we may make it mandatory

if ("abc" => startsWith("a")) {
  echo yes
}

var mylist = [1, 2, 3]

# This one should be ->
call mylist->pop()
echo 'ok'

## STDOUT:
yes
ok
## END

#### => can be used to chain free functions

func dictfunc() {
  return ({k1: 'spam', k2: 'eggs'})
}

echo $[list(dictfunc()) => join('/') => upper()]

# This is nicer and more consistent
echo $[dictfunc() => list() => join('/') => upper()]

## STDOUT:
K1/K2
K1/K2
## END

#### Str => startsWith(Str) and endsWith(Str), simple
func test(s, p) { echo $[s => startsWith(p)] $[s => endsWith(p)] }

call test('', '')
call test('abc', '')
call test('abc', 'a')
call test('abc', 'b')
call test('abc', 'c')
call test('abc', 'z')
call test('', 'abc')
## status: 0
## STDOUT:
true true
true true
true false
false false
false true
false false
false false
## END

#### Str => startsWith(Str) and endsWith(Str), matches bytes not runes
func test(s, p) { echo $[s => startsWith(p)] $[s => endsWith(p)] }

call test(b'\yce\ya3', u'\u{03a3}')
call test(b'\yce\ya3', b'\yce')
call test(b'\yce\ya3', b'\ya3')
call test(b'\yce', b'\yce')
## status: 0
## STDOUT:
true true
true false
false true
true true
## END

#### Str => startsWith(Str) and endsWith(Str), eggex
func test(s, p) { echo $[s => startsWith(p)] $[s => endsWith(p)] }

call test('abc', / d+ /)
call test('abc', / [ a b c ] /)
call test('abc', / 'abc' /)
call test('cba', / d+ /)
call test('cba', / [ a b c ] /)
call test('cba', / 'abc' /)
## status: 0
## STDOUT:
false false
true true
true true
false false
true true
false false
## END

#### Str => startsWith(Str) and endsWith(Str), eggex with anchors
func test(s, p) { echo $[s => startsWith(p)] $[s => endsWith(p)] }

call test('ab', / %start 'a' /)
call test('ab', / 'a' %end /)
call test('ab', / %start 'a' %end /)
call test('ab', / %start 'b' /)
call test('ab', / 'b' %end /)
call test('ab', / %start 'b' %end /)
## status: 0
## STDOUT:
true false
false false
false false
false false
false true
false false
## END

#### Str => startsWith(Str) and endsWith(Str), eggex matches runes
func test(s, p) { echo $[s.startsWith(p)] $[s.endsWith(p)] }

call test(u'\u{03a3}', / dot /)
call test(u'\u{03a3}', / ![z] /)
call test(b'\yce', / dot /)
call test(b'\yce', / ![z] /)
## status: 0
## STDOUT:
true true
true true
false false
false false
## END

#### Str => startsWith(), no args
= 'abc' => startsWith()
## status: 3

#### Str => startsWith(), too many args
= 'abc' => startsWith('extra', 'arg')
## status: 3

#### Str => endsWith(), no args
= 'abc' => endsWith()
## status: 3

#### Str => endsWith(), too many args
= 'abc' => endsWith('extra', 'arg')
## status: 3

#### Str => trim*() with no args trims whitespace
func test(s) { write --sep ', ' --j8 $[s => trimStart()] $[s => trimEnd()] $[s => trim()] }

call test("")
call test("  ")
call test("mystr")
call test("  mystr")
call test("mystr  ")
call test("  mystr  ")
call test("  my str  ")
## status: 0
## STDOUT:
"", "", ""
"", "", ""
"mystr", "mystr", "mystr"
"mystr", "  mystr", "mystr"
"mystr  ", "mystr", "mystr"
"mystr  ", "  mystr", "mystr"
"my str  ", "  my str", "my str"
## END

#### Str => trim*() with a simple string pattern trims pattern
func test(s, p) { write --sep ', ' --j8 $[s => trimStart(p)] $[s => trimEnd(p)] $[s => trim(p)] }

call test(''         , 'xyz')
call test('   '      , 'xyz')
call test('xy'       , 'xyz')
call test('yz'       , 'xyz')
call test('xyz'      , 'xyz')
call test('xyzxyz'   , 'xyz')
call test('xyzxyzxyz', 'xyz')
## status: 0
## STDOUT:
"", "", ""
"   ", "   ", "   "
"xy", "xy", "xy"
"yz", "yz", "yz"
"", "", ""
"xyz", "xyz", ""
"xyzxyz", "xyzxyz", "xyz"
## END

#### Str => trim*() with a string pattern trims bytes not runes
func test(s, p) { write --sep ', ' --j8 $[s => trimStart(p)] $[s => trimEnd(p)] $[s => trim(p)] }

call test(b'\yce\ya3', u'\u{03a3}')
call test(b'\yce\ya3', b'\yce')
call test(b'\yce\ya3', b'\ya3')
## status: 0
## STDOUT:
"", "", ""
b'\ya3', "Σ", b'\ya3'
"Σ", b'\yce', b'\yce'
## END

#### Str => trim*() with an eggex pattern trims pattern
func test(s, p) { write --sep ', ' --j8 $[s => trimStart(p)] $[s => trimEnd(p)] $[s => trim(p)] }

call test(''         , / 'xyz' /)
call test('   '      , / 'xyz' /)
call test('xy'       , / 'xyz' /)
call test('yz'       , / 'xyz' /)
call test('xyz'      , / 'xyz' /)
call test('xyzxyz'   , / 'xyz' /)
call test('xyzxyzxyz', / 'xyz' /)
call test('xyzabcxyz', / 'xyz' /)
call test('xyzabcxyz', / %start 'xyz' /)
call test('xyzabcxyz', / 'xyz' %end /)
call test('123abc123', / d+ /)
## status: 0
## STDOUT:
"", "", ""
"   ", "   ", "   "
"xy", "xy", "xy"
"yz", "yz", "yz"
"", "", ""
"xyz", "xyz", ""
"xyzxyz", "xyzxyz", "xyz"
"abcxyz", "xyzabc", "abc"
"abcxyz", "xyzabcxyz", "abcxyz"
"xyzabcxyz", "xyzabc", "xyzabc"
"abc123", "123abc", "abc"
## END

#### Str => trim*() with an eggex pattern trims bytes not runes
func test(s, p) { write --sep ', ' --j8 $[s.trimStart(p)] $[s.trimEnd(p)] $[s.trim(p)] }

call test(u'\u{03a3}', / dot /)
call test(u'\u{03a3}', / ![z] /)
call test(b'\yce', / dot /)
call test(b'\yce', / ![z] /)
## status: 0
## STDOUT:
"", "", ""
"", "", ""
b'\yce', b'\yce', b'\yce'
b'\yce', b'\yce', b'\yce'
## END

#### Str => trim(), too many args
= 'mystr' => trim('extra', 'args')
## status: 3

#### Str => trimStart(), too many args
= 'mystr' => trimStart('extra', 'args')
## status: 3

#### Str => trimEnd(), too many args
= 'mystr' => trimEnd('extra', 'args')
## status: 3

#### Str => trim(), unicode whitespace aware

# Supported set of whitespace characters. The full set of Unicode whitespace
# characters is not supported. See comments in the implementation.
var spaces = [
  b'\u{0009}',  # Horizontal tab (\t)
  b'\u{000A}',  # Newline (\n)
  b'\u{000B}',  # Vertical tab (\v)
  b'\u{000C}',  # Form feed (\f)
  b'\u{000D}',  # Carriage return (\r)
  b'\u{0020}',  # Normal space
  b'\u{00A0}',  # No-break space 	<NBSP>
  b'\u{FEFF}',  # Zero-width no-break space <ZWNBSP>
] => join('')

echo $["$spaces YSH $spaces" => trim()]
## status: 0
## STDOUT:
YSH
## END

#### Str => trim*(), unicode decoding errors
var badUtf = b'\yF9'

echo trim

# We only decode UTF until the first non-space char. So the bad UTF-8 is
# missed.
try { call " a$[badUtf]b " => trim() }
echo status=$[_error.code]

# These require trim to decode the badUtf, so an error is raised
try { call "$[badUtf]b " => trim() }
echo status=$[_error.code]
try { call " a$[badUtf]" => trim() }
echo status=$[_error.code]

# Similarly, trim{Left,Right} will assume correct encoding until shown
# otherwise.
echo trimStart
try { call " a$[badUtf]" => trimStart() }
echo status=$[_error.code]
try { call "$[badUtf]b " => trimStart() }
echo status=$[_error.code]

echo trimEnd
try { call "$[badUtf]b " => trimEnd() }
echo status=$[_error.code]
try { call " a$[badUtf]" => trimEnd() }
echo status=$[_error.code]

## STDOUT:
trim
status=0
status=3
status=3
trimStart
status=0
status=3
trimEnd
status=0
status=3
## END

#### Str => trimStart(), unicode decoding error types
var badStrs = [
  b'\yF4\yA2\yA4\yB0',  # Too large of a codepoint
  b'\yED\yBF\y80',      # Surrogate
  b'\yC1\y81',          # Overlong
  b'\y80', b'\yFF',     # Does not match UTF8 bit pattern
]

for badStr in (badStrs) {
  try { call badStr => trimStart() }
  echo status=$[_error.code]
}

## STDOUT:
status=3
status=3
status=3
status=3
status=3
## END

#### Str => trimEnd(), unicode decoding error types
# Tests the backwards UTF-8 decoder
var badStrs = [
  b'\yF4\yA2\yA4\yB0',  # Too large of a codepoint
  b'\yED\yBF\y80',      # Surrogate
  b'\yC1\y81',          # Overlong
  b'\y80', b'\yFF',     # Does not match UTF8 bit pattern
]

for badStr in (badStrs) {
  try { call badStr => trimEnd() }
  echo status=$[_error.code]
}

## STDOUT:
status=3
status=3
status=3
status=3
status=3
## END

#### Str => trim*(), zero-codepoints are not NUL-terminators
json write (b' \y00 ' => trim())
json write (b' \y00 ' => trimStart())
json write (b' \y00 ' => trimEnd())
## STDOUT:
"\u0000"
"\u0000 "
" \u0000"
## END

#### Str => split(sep), non-empty str sep
pp test_ ('a,b,c'.split(','))
pp test_ ('aa'.split('a'))
pp test_ ('a<>b<>c<d'.split('<>'))
pp test_ ('a;b;;c'.split(';'))
pp test_ (''.split('foo'))
## STDOUT:
(List)   ["a","b","c"]
(List)   ["","",""]
(List)   ["a","b","c<d"]
(List)   ["a","b","","c"]
(List)   []
## END

#### Str => split(sep), eggex sep
pp test_ ('a,b;c'.split(/ ',' | ';' /))
pp test_ ('aa'.split(/ dot /))
pp test_ ('a<>b@@c<d'.split(/ '<>' | '@@' /))
pp test_ ('a b  cd'.split(/ space+ /))
pp test_ (''.split(/ dot /))
## STDOUT:
(List)   ["a","b","c"]
(List)   ["","",""]
(List)   ["a","b","c<d"]
(List)   ["a","b","cd"]
(List)   []
## END

#### Str => split(sep, count), non-empty str sep
pp test_ ('a,b,c'.split(',', count=-1))
pp test_ ('a,b,c'.split(',', count=-2))  # Any negative count means "ignore count"
pp test_ ('aa'.split('a', count=1))
pp test_ ('a<>b<>c<d'.split('<>', count=10))
pp test_ ('a;b;;c'.split(';', count=2))
pp test_ (''.split('foo', count=3))
pp test_ ('a,b,c'.split(',', count=0))
pp test_ (''.split(',', count=0))
## STDOUT:
(List)   ["a","b","c"]
(List)   ["a","b","c"]
(List)   ["","a"]
(List)   ["a","b","c<d"]
(List)   ["a","b",";c"]
(List)   []
(List)   ["a,b,c"]
(List)   []
## END

#### Str => split(sep, count), eggex sep
pp test_ ('a,b;c'.split(/ ',' | ';' /, count=-1))
pp test_ ('aa'.split(/ dot /, count=1))
pp test_ ('a<>b@@c<d'.split(/ '<>' | '@@' /, count=50))
pp test_ ('a b  c'.split(/ space+ /, count=0))
pp test_ (''.split(/ dot /, count=1))
## STDOUT:
(List)   ["a","b","c"]
(List)   ["","a"]
(List)   ["a","b","c<d"]
(List)   ["a b  c"]
(List)   []
## END

#### Str => split(), usage errors
try { pp test_ ('abc'.split(''))             } # Sep cannot be ""
echo status=$[_error.code]
try { pp test_ ('abc'.split())               } # Sep must be present
echo status=$[_error.code]
try { pp test_ (b'\y00a\y01'.split(/ 'a' /)) } # Cannot split by eggex when str has NUL-byte
echo status=$[_error.code]
try { pp test_ (b'abc'.split(/ space* /))    } # Eggex cannot accept empty string
echo status=$[_error.code]
try { pp test_ (b'abc'.split(/ dot* /))      } # But in some cases the input doesn't cause an
                                               # infinite loop, so we actually allow it!
echo status=$[_error.code]
## STDOUT:
status=3
status=3
status=3
status=3
(List)   ["",""]
status=0
## END

#### Str => split(), non-ascii
pp test_ ('🌞🌝🌞🌝🌞'.split('🌝'))
pp test_ ('🌞🌝🌞🌝🌞'.split(/ '🌝' /))
## STDOUT:
(List)   ["🌞","🌞","🌞"]
(List)   ["🌞","🌞","🌞"]
## END

#### Str.lines()

var empty = u''
pp test_ (empty.lines())

var one = u'\n'
pp test_ (one.lines())

var two = u'\n\n'
pp test_ (two.lines())

var three = u'one\ntwo\nthree'  # no trailing newline
pp test_ (three.lines())

var foo = u'foo'  # no trailing newline
pp test_ (foo.lines())

echo

var s = u'foo\nbar\n'
pp test_ (s.lines())

var z = b'foo\y00bar\y00'
pp test_ (z.lines(eol=\y00))

var r = u'foo\r\nbar\r\n'
pp test_ (r.lines(eol=u'\r\n'))

echo

pp test_ (empty.lines(eol=\y00))
pp test_ (z.lines())
pp test_ (r.lines())

## STDOUT:
(List)   []
(List)   [""]
(List)   ["",""]
(List)   ["one","two","three"]
(List)   ["foo"]

(List)   ["foo","bar"]
(List)   ["foo","bar"]
(List)   ["foo","bar"]

(List)   []
(List)   ["foo\u0000bar\u0000"]
(List)   ["foo\r","bar\r"]
## END

#### read-lines can be built on top of read --all and Str.lines()

proc read-lines (; out) {
  read --all 
  call out->setValue(_reply.lines())
}

seq 4 7 > tmp.txt

read-lines (&x) < tmp.txt

pp test_ (x)

## STDOUT:
(List)   ["4","5","6","7"]
## END

#### Dict => values()
var en2fr = {}
setvar en2fr["hello"] = "bonjour"
setvar en2fr["friend"] = "ami"
setvar en2fr["cat"] = "chat"
pp test_ (en2fr => values())
## status: 0
## STDOUT:
(List)   ["bonjour","ami","chat"]
## END

#### Dict -> erase()
var book = {title: "The Histories", author: "Herodotus"}
call book->erase("author")
pp test_ (book)
# confirm method is idempotent
call book->erase("author")
pp test_ (book)
## status: 0
## STDOUT:
(Dict)   {"title":"The Histories"}
(Dict)   {"title":"The Histories"}
## END

#### Dict -> clear()
var book = {title: "The Histories", author: "Herodotus"}
call book->clear()
pp test_ (book)
# confirm method is idempotent
call book->clear()
pp test_ (book)
## status: 0
## STDOUT:
(Dict)   {}
(Dict)   {}
## END

#### Dict -> get()
var book = {title: "Hitchhiker's Guide", published: 1979}
pp test_ (book => get("title", ""))
pp test_ (book => get("published", 0))
pp test_ (book => get("author", ""))
## status: 0
## STDOUT:
(Str)   "Hitchhiker's Guide"
(Int)   1979
(Str)   ""
## END

#### Dict -> inc() with ints
var histogram = {a: 1979}

call histogram->inc('a', 3)
assert [{"a": 1982} === histogram]

call histogram->inc('b', 3)
assert [{"a": 1982, "b": 3} === histogram]
## STDOUT:
## END

#### Dict -> inc() with invalid value
var d = {k: 'foo'}
call d->inc('k', 42)
## status: 3
## STDOUT:
## END

#### Dict -> inc() with floats
var histogram = {a: 2.5}
call histogram->inc('a', 2)
pp test_ (histogram)
call histogram->inc('a', 3.5)
pp test_ (histogram)
call histogram->inc('b', 3.5)
pp test_ (histogram)
call histogram->inc('b', 2)
pp test_ (histogram)
call histogram->inc('c', 1)
pp test_ (histogram)
call histogram->inc('c', 3.0)
pp test_ (histogram)

var d = {k: 'foo'}
call d->inc('k', 42.14)
## status: 3
## STDOUT:
(Dict)   {"a":4.5}
(Dict)   {"a":8.0}
(Dict)   {"a":8.0,"b":3.5}
(Dict)   {"a":8.0,"b":5.5}
(Dict)   {"a":8.0,"b":5.5,"c":1}
(Dict)   {"a":8.0,"b":5.5,"c":4.0}
## END

#### Dict -> append()
var mydict = {a: [1]}
call mydict->append('a', 2)
assert [{"a": [1,2]} === mydict]
call mydict->append('a', 'b')
assert [{"a": [1,2,'b']} === mydict]
call mydict->append('b', 1)
assert [{"a": [1,2,'b'], "b": [1]} === mydict]
call mydict->append('c', [1,2])

# list of lists
assert [{"a": [1,2,'b'], "b": [1], "c": [[1,2]]} === mydict]
## STDOUT:
## END

#### Dict -> append() with invalid value
var d = {k: 'foo'}
call d->append('k', 'bar')
## status: 3

#### Dict -> update()
var d = {a: 2, b: 3}
var alias = d
var other = {a: 42}
call d->update(other)
assert [{a: 42, b: 3} === d]
assert [{a: 42, b: 3} === alias]
## STDOUT:
## END

#### concat operator (++) on dicts
var d = {a: 2, b: 3}
var other = {a: 42}
assert [{a: 42, b: 3} === d ++ other]
# old dict is untouched - shallow copy was done
assert [{a: 2, b: 3} === d]
## STDOUT:
## END


#### Separation of -> attr and () calling
const check = "abc" => startsWith
pp test_ (check("a"))
## status: 0
## STDOUT:
(Bool)   true
## END

#### Bound methods, receiver value/reference semantics
var is_a_ref = { "foo": "bar" }
const f = is_a_ref => keys
pp test_ (f())
setvar is_a_ref["baz"] = 42
pp test_ (f())

var is_a_val = "abc"
const g = is_a_val => startsWith
pp test_ (g("a"))
setvar is_a_val = "xyz"
pp test_ (g("a"))
## status: 0
## STDOUT:
(List)   ["foo"]
(List)   ["foo","baz"]
(Bool)   true
(Bool)   true
## END

#### List->clear()
var empty = []
var items = [1, 2, 3]

call empty->clear()
call items->clear()

pp test_ (empty)
pp test_ (items)

## STDOUT:
(List)   []
(List)   []
## END

#### List => indexOf()
var items = [1, '2', 3, { 'a': 5 }]

json write (items => indexOf('a'))
json write (items => indexOf(1))
json write (items => indexOf('2'))
json write (items => indexOf({'a': 5}))
## STDOUT:
-1
0
1
3
## END

#### List => lastIndexOf()
var items = ['a', 'b', 'c', 'b', 'a']

json write (items => lastIndexOf('a'))
json write (items => lastIndexOf('b'))
json write (items => lastIndexOf('c'))
json write (items => lastIndexOf('d'))
## STDOUT:
4
3
2
-1
## END

#### List => join()
var items = [1, 2, 3]

json write (items => join())  # default separator is ''
json write (items => join(" "))  # explicit separator (can be any number or chars)
json write (items => join(", "))  #  separator can be any number of chars

try {
  json write (items => join(1))  # separator must be a string
}
echo "failed with status $[_error.code]"
## STDOUT:
"123"
"1 2 3"
"1, 2, 3"
failed with status 3
## END

#### List->reverse()

var empty = []

var a = [0]
var b = [2, 1, 3]
var c = :| hello world |

call empty->reverse()
call a->reverse()
call b->reverse()
call c->reverse()

pp test_ (empty)
pp test_ (a)
pp test_ (b)
pp test_ (c)

## STDOUT:
(List)   []
(List)   [0]
(List)   [3,1,2]
(List)   ["world","hello"]
## END

#### List->reverse() from iterator
var x = list(0 ..< 3)
call x->reverse()
write @x
## STDOUT:
2
1
0
## END

