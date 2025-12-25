#### /^.$/
shopt -s ysh:all
var pat = ''

setvar pat = /^.$/
echo pat=$pat

setvar pat = /%start dot %end/
echo pat=$pat

if ('' ~ pat) {  # ERE syntax
  echo yes
} else {
  echo no
}
# $pat is same as pat
if ('f' ~ pat) {  # ERE syntax
  echo yes
} else {
  echo no
}

## STDOUT:
pat=^.$
pat=^.$
no
yes
## END


#### /.+/
shopt -s ysh:all

var pat = /.+/
echo $pat

var s = 'foo'
if (s ~ pat) {  # ERE syntax
  echo yes
}
var empty = ''
if (empty ~ pat) { echo yes } else { echo no }
## STDOUT:
.+
yes
no
## END

#### Repeat {1,3} etc.
var pat = null

setvar pat = /d{2}/
echo $pat
setvar pat = /d{1,3}/
echo $pat
setvar pat = /d{1,}/
echo $pat
setvar pat = /d{,3}/
echo $pat


## STDOUT:
[[:digit:]]{2}
[[:digit:]]{1,3}
[[:digit:]]{1,}
[[:digit:]]{,3}
## END


#### d+  digit+  !d+  !digit+
shopt -s ysh:all

var pat = ''

setvar pat = /d+/
echo $pat
if ('42' ~ pat) { echo yes }

var empty = ''
if (empty ~ pat) { echo yes } else { echo no }

setvar pat = /digit+/
echo $pat
setvar pat = /!d+/
echo $pat
setvar pat = /!digit+/
echo $pat


## STDOUT:
[[:digit:]]+
yes
no
[[:digit:]]+
[^[:digit:]]+
[^[:digit:]]+
## END

#### Alternation and sequence
var pat = ''
setvar pat = /s d+ | w*/
echo $pat
setvar pat = /s d+ or w*/
echo $pat
## STDOUT:
[[:space:]][[:digit:]]+|[[:alpha:][:digit:]_]*
[[:space:]][[:digit:]]+|[[:alpha:][:digit:]_]*
## END

#### Char Class Ranges
shopt -s ysh:all

var pat = ''
setvar pat = /[0-9 a-f]+/
echo $pat
# This is equivalent
setvar pat = /['0' - '9' 'a' - 'f']+/
echo $pat

if ('0123' ~ pat) { echo yes } else { echo no }
if ('zzz' ~ pat) { echo yes } else { echo no }
if ('' ~ pat) { echo yes } else { echo no }
## STDOUT:
[0-9a-f]+
[0-9a-f]+
yes
no
no
## END

#### Char Class Set
shopt -s ysh:all
var pat = ''

# This is NOT allowed
# setvar pat = /[a b c]+/

setvar pat = /['abc']+/
echo $pat

if ('cbcb' ~ pat) { echo yes } else { echo no }
if ('0123' ~ pat) { echo yes } else { echo no }
if ('' ~ pat) { echo yes } else { echo no }
## STDOUT:
[abc]+
yes
no
no
## END

#### Range with escaped characters
shopt -s ysh:all

var pat = null

setvar pat = / [ \x01 - \x0f ] /
echo $pat | od -A n -t x1

## STDOUT:
 5b 01 2d 0f 5d 0a
## END


#### Group ()
shopt -s ysh:all
var pat = ''

setvar pat = /(%start s or d d)/
echo $pat

if (' foo' ~ pat) { echo yes } else { echo no }
if ('-00-' ~ pat) { echo yes } else { echo no }
if ('foo' ~ pat) { echo yes } else { echo no }

## STDOUT:
(^[[:space:]]|[[:digit:]][[:digit:]])
yes
yes
no
## END

#### Capture is acceptable as a group
shopt -s ysh:all
var pat = /<capture %start s | d d>/
echo $pat
## STDOUT:
(^[[:space:]]|[[:digit:]][[:digit:]])
## END

#### literal ''
shopt -s ysh:all
var pat = ''

setvar pat = /'abc' 'def'/
echo $pat

#setvar pat = /'abc' '^ + * ?'/
#echo $pat

if ('abcde' ~ pat) { echo yes } else { echo no }
if ('abcdef' ~ pat) { echo yes } else { echo no }

## STDOUT:
abcdef
no
yes
## END

#### Single quotes and splicing (do what "foo $x ${x}" used to)
shopt -s ysh:all
var pat = ''

var x = 'x'
var y = 'y'
setvar pat = / @x @x 'abc' @x @y /
echo $pat

if ('xxabcx' ~ pat) { echo yes } else { echo no }
if ('xxabcxyf' ~ pat) { echo yes } else { echo no }

## STDOUT:
xxabcxy
no
yes
## END

#### @splice
shopt -s ysh:all
var d = /d+/;
var ip = / @d '.' @d '.' @d '.' @d /
echo $ip
if ('0.0.0.0' ~ ip) { echo yes } else { echo no }
if ('0.0.0' ~ ip) { echo yes } else { echo no }
## STDOUT:
[[:digit:]]+\.[[:digit:]]+\.[[:digit:]]+\.[[:digit:]]+
yes
no
## END

#### splice with capital letters
shopt -s ysh:all
var D = /d+/;
var ip = / D '.' D '.' D '.' D /
echo $ip
if ('0.0.0.0' ~ ip) { echo yes } else { echo no }
if ('0.0.0' ~ ip) { echo yes } else { echo no }
## STDOUT:
[[:digit:]]+\.[[:digit:]]+\.[[:digit:]]+\.[[:digit:]]+
yes
no
## END

#### Repeated String Literal With Single Char
shopt -s ysh:all

var literal = 'f'
var pat = null

setvar pat = / %start @literal+ %end /
echo $pat
setvar pat = / %start (@literal)+ %end /
echo $pat

if ('fff' ~ pat) { echo yes }
if ('foo' !~ pat) { echo no }

## STDOUT:
^f+$
^(f)+$
yes
no
## END

#### Error when unparenthesized string of more than one character is repeated
shopt -s ysh:all

var literal = 'foo'
var pat = null

setvar pat = / %start @literal+ %end /
echo $pat
setvar pat = / %start (@literal)+ %end /
echo $pat

if ('foofoo' ~ pat) { echo yes }
if ('foof' !~ pat) { echo no }

## status: 1
## stdout-json: ""

#### Instead of $'foo\\bar' use 'foo' \\ 'bar'
shopt -s ysh:all
var pat = /'foo' \\ 'bar'/
echo $pat

if (r'foo\bar' ~ pat) { echo yes }
if (r'foo.bar' !~ pat) { echo no }
## STDOUT:
foo\\bar
yes
no
## END

#### Negation of Character Class ![a-z]
shopt -s ysh:all

var pat = / ![ a-z ] /
echo $pat

if ('0' ~ pat) { echo yes }
if ('a' !~ pat) { echo no }

## STDOUT:
[^a-z]
yes
no
## END

#### Posix and Perl class in class literals
shopt -s ysh:all

var pat = null

setvar pat = / [ space 'z' ] /
echo $pat
#setvar pat = / [ ~space 'z' ] /
#echo $pat

# PROBLEM: can't negate individual POSIX classes.  They would have to be a Perl
# class to be \D or \S.
# [[:space:]z] negates the whole thing!
# [^[:space:]]

setvar pat = / [ digit 'z' ] /
echo $pat
#setvar pat = / [ ~digit 'z' ] /
#echo $pat

## STDOUT:
[[:space:]z]
[[:digit:]z]
## END

#### [!d] can't be negated because it's a literal character
setvar pat = / [ !d 'z' ] /
echo $pat
## status: 2
## stdout-json: ""

#### [!digit] can't be negated in POSIX ERE (but yes in Perl)
var pat = null
setvar pat = / [ !digit 'z' ] /
echo $pat
## status: 1
## stdout-json: ""

#### Operator chars in char classes (bash-like)

pat='[-]'
[[ '-' =~ $pat ]] && echo hyphen
[[ '\' =~ $pat ]] && echo FAIL

pat='[\]'
[[ '\' =~ $pat ]] && echo backslash
[[ '-' =~ $pat ]] && echo FAIL

pat='[]]'
[[ ']' =~ $pat ]] && echo 'right bracket'
[[ '[' =~ $pat ]] && echo FAIL

pat='[[]'
[[ '[' =~ $pat ]] && echo 'left bracket'
[[ ']' =~ $pat ]] && echo FAIL

pat='[.]'
[[ '.' =~ $pat ]] && echo period
[[ '\' =~ $pat ]] && echo FAIL

pat='[\^]'
[[ '^' =~ $pat ]] && echo caret
[[ '\' =~ $pat ]] && echo 'no way to have [^]'

## STDOUT:
hyphen
backslash
right bracket
left bracket
period
caret
no way to have [^]
## END

#### Operator chars in char classes (eggex)
shopt --set ysh:upgrade

var pat = / ['-'] /
#echo PAT=$pat
if ('-' ~ pat) { echo hyphen }
if (b'\\' ~ pat) { echo FAIL }

var pat = / [ \\ ] /
[[ '\' =~ $pat ]] && echo backslash
[[ '-' =~ $pat ]] && echo FAIL

var pat = / [ ']' ] /
[[ ']' =~ $pat ]] && echo 'right bracket'
[[ '[' =~ $pat ]] && echo FAIL

var pat = / [ '[' ] /
[[ '[' =~ $pat ]] && echo 'left bracket'
[[ ']' =~ $pat ]] && echo FAIL

var pat = / [ '.' ] /
[[ '.' =~ $pat ]] && echo period
[[ '\' =~ $pat ]] && echo FAIL

var pat = / [ \\ '^' ] /
[[ '^' =~ $pat ]] && echo caret
[[ '\' =~ $pat ]] && echo 'no way to have [^]'


## STDOUT:
hyphen
backslash
right bracket
left bracket
period
caret
no way to have [^]
## END

#### Matching ] and \ and ' and " in character classes
shopt -s ysh:all

# BUG: need C strings in array literal
var lines = :|
  'backslash \'
  'rbracket ]'
  'lbracket ['
  "sq '"
  'dq ""'
|

# Weird GNU quirk: ] has to come first!
# []abc] works.  But [abc\]] does NOT work.  Stupid rule!

var pat = / [ ']' \\ \' \" ] /
write pat=$pat
write @lines | egrep $pat 

## STDOUT:
pat=[]'"\\]
backslash \
rbracket ]
sq '
dq ""
## END

#### Matching literal hyphen in character classes
shopt -s ysh:all

var literal = '-'
var pat = / [ 'a' 'b' @literal ] /
write pat=$pat
write 'c-d' 'ab' 'cd' | grep $pat
## STDOUT:
pat=[ab-]
c-d
ab
## END

#### Char class special: ^ - ] \

# See demo/ere-char-class-literals.sh
#
# \ is special because of gawk

shopt -s ysh:upgrade


# Note: single caret disalowed
var caret = / ['^' 'x'] /
echo caret=$caret

var caret2 = / [ \x5e 'x'] /
echo caret2=$caret2

var caret3 = / [ \u{5e} 'x'] /
echo caret3=$caret3

if ('x' ~ caret3) {
  echo 'match x'
}
if ('^' ~ caret3) {
  echo 'match ^'
}

echo ---

var hyphen = / ['a' '-' 'b'] /
echo hyphen=$hyphen

var hyphen2 = / ['a' \x2d 'b' ] /
echo hyphen2=$hyphen2

if ('-' ~ hyphen2) {
  echo 'match -'
}

if ('a' ~ hyphen2) {
  echo 'match a'
}

if ('c' ~ hyphen2) {
  echo 'match c'
}

echo ---

var rbracket = / [ '[' ']' ] /
echo rbracket=$rbracket

var rbracket2 = / [ \x5b \x5d ] /
echo rbracket2=$rbracket2

if ('[' ~ rbracket2) {
  echo 'match ['
}

if (']' ~ rbracket2) {
  echo 'match ]'
}

echo ---

var backslash = / [ 'x' \\ 'n' ] /
echo backslash=$backslash

var backslash2 = / [ 'x' \x5c 'n' ] /
echo backslash2=$backslash2

var backslash3 = / [ 'x' $'\\' 'n' ] /
echo backslash3=$backslash3

if ('x' ~ backslash3) {
  echo 'match x'
}

if ('n' ~ backslash3) {
  echo 'match n'
}

if (b'\\' ~ backslash3) {
  echo 'match backslash'
}

if ($'\n' ~ backslash3) {
  echo 'match nnewline'
}


## STDOUT:
caret=[x^]
caret2=[x^]
caret3=[x^]
match x
match ^
---
hyphen=[ab-]
hyphen2=[ab-]
match -
match a
---
rbracket=[][]
rbracket2=[][]
match [
match ]
---
backslash=[xn\\]
backslash2=[xn\\]
backslash3=[xn\\]
match x
match n
match backslash
## END


#### character class with digit [\\0] should not crash (issue #2380)
shopt -s ysh:all

var pat = /[\\0]/
echo "pattern: $pat"

# Test matching  
pp test_ ('0' ~ pat)
pp test_ ('1' ~ pat)
pp test_ (b'\\' ~ pat)

echo ---

# Also test other digits in character class
var digits = /[0-9]/
echo $digits
pp test_ ('5' ~ digits)
pp test_ ('x' ~ digits)


## STDOUT:
pattern: [0\\]
(Bool)   true
(Bool)   false
(Bool)   true
---
[0-9]
(Bool)   true
(Bool)   false
## END

#### Multiple digits like [25] are invalid

# synonyms
var pat = /[2 5]/
echo $pat
var pat = /[2 '5']/
echo $pat

var pat = /[25]/
echo $pat

## status: 2
## STDOUT:
[25]
[25]
## END

#### Negation of digit not allowed

var digits = /[!2]/

## status: 2
## STDOUT:
## END
