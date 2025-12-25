## our_shell: ysh

#### Unquoted backslash escapes, as in J8 strings

# everything except \b \f \n

var nl = \n
pp test_ (nl)

var tab = \t
pp test_ (tab)

pp test_ (\r)

pp test_ (\" ++ \' ++ \\)

echo backslash $[\\]
echo "backslash $[\\]"

## STDOUT:
(Str)   "\n"
(Str)   "\t"
(Str)   "\r"
(Str)   "\"'\\"
backslash \
backslash \
## END

#### Unquoted \u{3bc} escape

var x = 'mu ' ++ \u{3bc}
echo $x

echo mu $[\u{3bc}]
echo "mu $[\u{3bc}]"

## STDOUT:
mu μ
mu μ
mu μ
## END

#### Unquoted \y24 escape

var x = 'foo ' ++ \y24
echo $x

var y = 0x24
echo $y

echo foo $[\y40]
echo "foo $[\y41]"

## STDOUT:
foo $
36
foo @
foo A
## END

#### single quoted -- implicit and explicit raw
var x = 'foo bar'
echo $x
setvar x = r'foo bar'  # Same string
echo $x
setvar x = r'\t\n'  # This is raw
echo $x
## STDOUT:
foo bar
foo bar
\t\n
## END

#### Implicit raw string '\t\n' is a syntax error because backslash is ambiguous
var x = ' \t\n '
## status: 2
## stdout-json: ""

#### Multiline ''' \t ''' is a also syntax error because backslash is ambiguous
var y = ''' \t '''
## status: 2
## stdout-json: ""

#### $"foo $x" to make "foo $x" explicit

var x = $"bar"

# expression mode
var y = $"foo $x"
echo "$y"

# command mode
if test "$y" = $"foo $x"; then
  echo equal
fi

## STDOUT:
foo bar
equal
## END

#### raw strings and J8 strings don't work in OSH
shopt --unset ysh:all

echo r'hello \'
echo u'mu \u{3bc}'
echo b'byte \yff'

echo --

echo r'''
raw multi
'''

echo u'''
u multi
'''

echo b'''
b multi
'''

## STDOUT:
rhello \
umu \u{3bc}
bbyte \yff
--
r
raw multi

u
u multi

b
b multi

## END

#### J8-style u'' and b'' strings in expression mode

var x = u'\u{3bc}'
var y = b'\yff'


write --end '' -- $x | od -A n -t x1
write --end '' -- $y | od -A n -t x1

## STDOUT:
 ce bc
 ff
## END

#### J8-style u'' and b'' strings in command mode

write --end '' -- u'\u{3bc}' | od -A n -t x1
write --end '' -- b'\yff' | od -A n -t x1

# TODO: make this be illegal
# echo u'hello \u03bc'

## STDOUT:
 ce bc
 ff
## END

#### J8-style multi-line strings u''' b''' in command mode

write --end '' -- u'''
  --
  \u{61}
  --
  '''
write --end '' -- b'''
--
\y62
--
'''

# Should be illegal?
#echo u'hello \u03bc'

## STDOUT:
--
a
--
--
b
--
## END

#### Double Quoted
var name = 'World'
var g = "Hello $name"

echo "Hello $name"
echo $g
## STDOUT:
Hello World
Hello World
## END

#### Multiline strings with '' and ""

var single = '
  single
'

var x = 42
var double = "
  double $x
"

echo $single
echo $double

## STDOUT:

  single


  double 42

## END

#### shopt parse_ysh_string

# Ignored prefix
echo r'\'

# space
write r '' end

# Now it's a regular r
shopt --unset parse_ysh_string
shopt --unset no_parse_word_join
write unset r'\'

## STDOUT:
\
r

end
unset
r\
## END

#### Special rule for <<< ''' and <<< """ - no extra newline

read --all <<< unquoted
pp test_ (_reply)

read --all <<< 'single with newline'
pp test_ (_reply)

read --all <<< "double with newline"
pp test_ (_reply)

read --all <<< u'j8 with newline'
pp test_ (_reply)

echo

read --all <<< '''
multi
single
'''
pp test_ (_reply)

read --all <<< """
multi
double
"""
pp test_ (_reply)

read --all <<< u'''
multi
j8
'''
pp test_ (_reply)


## STDOUT:
(Str)   "unquoted\n"
(Str)   "single with newline\n"
(Str)   "double with newline\n"
(Str)   "j8 with newline\n"

(Str)   "multi\nsingle\n"
(Str)   "multi\ndouble\n"
(Str)   "multi\nj8\n"
## END

#### $''' isn't a a multiline string (removed)

shopt -s ysh:upgrade

echo $'''
  foo
  '''

## status: 2
## STDOUT:
## END


#### """ and $""" in Expression Mode

var line1 = """line1"""
echo line1=$line1
var line2 = """
line2"""
echo line2=$line2

var two = 2
var three = 3
var x = """
  one "
  two = $two ""
   three = $three
  """
echo "[$x]"

var i = 42
var x = """
  good
 bad $i
  """
echo "[$x]"

# alias
var x = $"""
  good
 bad $i
  """
echo "[$x]"

## STDOUT:
line1=line1
line2=line2
[one "
two = 2 ""
 three = 3
]
[good
 bad 42
]
[good
 bad 42
]
## END

#### ''' in Expression Mode

var two = 2
var three = 2

var x = r''' 
  two = $two '
  three = $three ''
   \u{61}
  '''
echo "[$x]"

var x = u''' 
  two = $two '
  three = $three ''
   \u{61}
  '''
echo "[$x]"

var x = b''' 
  two = $two '
  three = $three ''
   \u{61} \y61
  '''
echo "[$x]"

## STDOUT:
[two = $two '
three = $three ''
 \u{61}
]
[two = $two '
three = $three ''
 a
]
[two = $two '
three = $three ''
 a a
]
## END


#### """ and $""" in Command Mode

var two=2
var three=3

echo --
echo """
  one "
  two = $two ""
  three = $three
  """

# optional $ prefix
echo --
echo $"""
  one "
  two = $two ""
  three = $three
  """

echo --
tac <<< """
  one "
  two = $two ""
  three = $three
  """

## STDOUT:
--
one "
two = 2 ""
three = 3

--
one "
two = 2 ""
three = 3

--
three = 3
two = 2 ""
one "
## END


#### ''' in Command Mode

echo --
echo '''
  two = $two
  '
  '' '
  \u{61}
  '''
## STDOUT:
--
two = $two
'
'' '
\u{61}

## END

#### r''' in Command Mode, Expression mode

echo r'''\'''

var x = r'''\'''
echo $x

shopt --unset parse_ysh_string
shopt --unset no_parse_word_join

echo r'''\'''

## STDOUT:
\
\
r\
## END


#### ''' in Here Doc

tac <<< '''
  two = $two
  '
  '' '
  \u{61}
  '''

## STDOUT:
\u{61}
'' '
'
two = $two
## END

#### ''' without parse_triple_quote

# 2025-06: re-allowed after hack for case (x) ''/foo/
#          See spec/ysh-TODO-deprecate
# This is a corner case that can change

shopt --unset parse_triple_quote

echo '''
  two = $two
  \u{61}
  '''

## STDOUT:

  two = $two
  \u{61}
  
## END

#### here doc with quotes

# This has 3 right double quotes

cat <<EOF
"hello"
""
"""
EOF


## STDOUT:
"hello"
""
"""
## END

#### triple quoted and implicit concatenation

# Should we allow this?  Or I think it's possible to make it a syntax error

echo '''
single
'''zz

echo """
double
"""zz
## status: 2
## stdout-json: ""

#### str.find()

var mystr = 'abcaz'

assert [1 === mystr.find('b')]
assert [4 === mystr.find('z')]
# test with chars taking up two bytes
assert [2 === 'абаба'.find('б')]
assert [6 === 'абаба'.find('б', start=3)]
assert [-1 === 'абаба'.find('б', start=3, end=5)]
assert [6 === 'абаба'.find('б', start=3, end=8)]
assert [0 === 'абаба'.find('')]
assert [2 === 'абаба'.find('', start=2, end=7)]
assert [-1 === 'абаба'.find('a')] # different alphabet
assert [-1 === 'abc'.find('', start=7, end=8)]
# test negative indices
assert [3 === mystr.find('a', start=-3, end=-1)]
## status: 0

#### str.findLast()
var mystr = 'abcaz'
assert [-1 === 'абаба'.findLast('a')] # different alphabet
assert [4 === 'ababa'.findLast('a')]
assert [3 === 'ababa'.findLast('b')]
assert [6 === 'абаба'.findLast('б')]
assert [-1 === 'абаба'.findLast('б', start=3, end=6)]
assert [2 === 'абаба'.findLast('б', start=2, end=6)]
assert [6 ==='абаба'.findLast('б', start=2, end=8)]
assert [10 === 'абаба'.findLast('')]
assert [8 === 'абаба'.findLast('', start=2, end=8)]
assert [-1 === 'abc'.findLast('', start=7, end=8)]
# test negative indices
assert [3 === mystr.findLast('a', start=-3, end=-1)]
## status: 0

#### str.contains()

var mystr = 'abcaz'

assert [true === mystr.contains('b')]
assert [true === mystr.contains('z')]
assert [false === mystr.contains('y')]
# test with chars taking up two bytes
assert [true === 'абаба'.contains('б')]
assert [true === 'абаба'.contains('аб')]
assert [true === 'абаба'.contains('')]
assert [false === 'абаба'.contains('a')]
assert [false === 'абаба'.contains('бабаба')]
## status: 0

#### strcmp()

assert [-1 === strcmp('a', 'z')]
assert [-1 === strcmp('a', 'b')]
assert [-1 === strcmp('a', 'aa')]
assert [0 === strcmp('a', 'a')]
assert [1 === strcmp('aa', 'a')]
assert [1 === strcmp('b', 'a')]
assert [1 === strcmp('z', 'a')]
## status: 0
