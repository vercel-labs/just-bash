## oils_failures_allowed: 3

#### append onto BashArray a=(1 2)
shopt -s parse_at
a=(1 2)
append '3 4' '5' (a)
argv.py "${a[@]}"

append -- 6 (a)
argv.py "${a[@]}"

## STDOUT:
['1', '2', '3 4', '5']
['1', '2', '3 4', '5', '6']
## END

#### append onto var a = :| 1 2 |
shopt -s parse_at parse_proc
var a = :| 1 2 |
append '3 4' '5' (a)
argv.py @a
## STDOUT:
['1', '2', '3 4', '5']
## END

#### append onto var a = ['1', '2']
shopt -s parse_at parse_proc
var a = ['1', '2']
append '3 4' '5' (a)
argv.py @a
## STDOUT:
['1', '2', '3 4', '5']
## END

#### append without typed arg
append a b
## status: 3

#### append passed invalid type
s=''
append a b (s)
echo status=$?
## status: 3

#### write --sep, --end, -n, varying flag syntax
shopt -s ysh:all
var a = %('a b' 'c d')
write @a
write .
write -- @a
write .

write --sep '' --end '' @a; write
write .

write --sep '_' -- @a
write --sep '_' --end b' END\n' -- @a

write -n x
write -n y
write

## STDOUT:
a b
c d
.
a b
c d
.
a bc d
.
a b_c d
a b_c d END
xy
## END

#### write --json
shopt --set ysh:upgrade

write --json u'\u{3bc}' x
write --json b'\yfe\yff' y

## STDOUT:
"μ"
"x"
"��"
"y"
## END

#### write --j8
shopt --set ysh:upgrade

write --j8 u'\u{3bc}' x
write --j8 b'\yfe\yff' y

## STDOUT:
"μ"
"x"
b'\yfe\yff'
"y"
## END

#### write  -e not supported
shopt -s ysh:all
write -e foo
write status=$?
## stdout-json: ""
## status: 2

#### write syntax error
shopt -s ysh:all
write ---end foo
write status=$?
## stdout-json: ""
## status: 2

#### write --
shopt -s ysh:all
write --
# This is annoying
write -- --
write done

# this is a syntax error!  Doh.
write ---
## status: 2
## STDOUT:

--
done
## END

#### read flag usage
read --lin
echo status=$?

read --line :var extra
echo status=$?
## STDOUT:
status=2
status=2
## END

#### read (&x) is usage error

var x = null  # allow no initialization
echo hello | read (&x)
echo status=$?

## STDOUT:
status=2
## END

#### read --raw-line

shopt --set parse_ysh_expr_sub

echo hi | read --raw-line
echo "reply=$_reply"
echo len=$[len(_reply)]

echo hi | read -r
if test "$REPLY" = "$_reply"; then
  echo pass
fi

## STDOUT:
reply=hi
len=2
pass
## END

#### read --raw-line in a loop

write --end '' $'\na\nb\n\n' | while read --raw-line; do
  pp test_ (_reply)
done

echo

write --end '' $'a\n\nb' | while read --raw-line; do
  pp test_ (_reply)
done


## STDOUT:
(Str)   ""
(Str)   "a"
(Str)   "b"
(Str)   ""

(Str)   "a"
(Str)   ""
(Str)   "b"
## END


#### read --raw-line --with-eol in a loop

write --end '' $'\na\nb\n\n' | while read --raw-line --with-eol; do
  pp test_ (_reply)
done

echo

write --end '' $'a\n\nb' | while read --raw-line --with-eol; do
  pp test_ (_reply)
done

## STDOUT:
(Str)   "\n"
(Str)   "a\n"
(Str)   "b\n"
(Str)   "\n"

(Str)   "a\n"
(Str)   "\n"
(Str)   "b"
## END

#### Mixing read --raw-line with read -r

$SH $REPO_ROOT/spec/testdata/ysh-read-0.sh

## STDOUT:
read -r
REPLY=1
REPLY=2

read --raw-line
_reply=1
_reply=2

Mixed
REPLY=1
REPLY=2
_reply=3
REPLY=4
## END

#### read --raw-line --with-eol

$SH $REPO_ROOT/spec/testdata/ysh-read-1.sh

## STDOUT:
reply=1
reply=2
reply=3
myline=a
myline=b
## END

#### read --raw-line --j8

# TODO: is this similar to @() ?  It reads j8 lines?
#
# But using a function is better?
#
# var x = fromJ8Line(_reply)
# var x = fromJson(_reply)  # this is https://jsonlines.org

echo $'u\'foo\'' | read --raw-line --j8
write -- "$_reply"

## STDOUT:
foo
## END

#### echo builtin should disallow typed args - literal
shopt -s ysh:all
#shopt -p simple_echo

echo (42)
## status: 2
## STDOUT:
## END

#### echo builtin should disallow typed args - variable
shopt -s ysh:all
#shopt -p simple_echo

var x = 43
echo (x)
## status: 2
## STDOUT:
## END

#### read --all-lines
seq 3 | read --all-lines :nums
write --sep ' ' -- @nums
## STDOUT:
1 2 3
## END

#### read --all-lines --with-eol
seq 3 | read --all-lines --with-eol :nums
write --sep '' -- @nums
## STDOUT:
1
2
3
## END

#### Can simulate read --all-lines with a proc and value.Place

$SH $REPO_ROOT/spec/testdata/ysh-read-2.sh

## STDOUT:
[
  "1",
  "2",
  "3"
]
## END

#### read --all
echo foo | read --all
echo "[$_reply]"

echo bad > tmp.txt
read --all (&x) < tmp.txt
echo "[$x]"

## STDOUT:
[foo
]
[bad
]
## END

#### read --all from directory is an error (EISDIR)
mkdir -p ./dir
read --all < ./dir
echo status=$?
## STDOUT:
status=1
## END

#### read --num-bytes

echo '  a b ' | read --num-bytes 4; echo "reply=[$_reply]"
echo '  a b ' | read --num-bytes 5; echo "reply=[$_reply]"

echo '  a b ' | read --num-bytes 4 (&x); echo "x=[$x]"
echo '  a b ' | read --num-bytes 5 (&x); echo "x=[$x]"

## STDOUT:
reply=[  a ]
reply=[  a b]
x=[  a ]
x=[  a b]
## END

#### read -0 is like read -r -d ''
set -o errexit

mkdir -p read0
cd read0
touch a\\b\\c\\d

find . -type f -a -print0 | read -r -d '' name
echo "[$name]"

find . -type f -a -print0 | read -0
echo "[$REPLY]"

## STDOUT:
[./a\b\c\d]
[./a\b\c\d]
## END

#### read -0 myvar doesn't do anything with IFS

touch 'foo bar  '
find -type f -print0 | read -0 
echo "[$REPLY]"

find -type f -print0 | read -0 myvar
echo "[$myvar]"

## STDOUT:
[./foo bar  ]
[./foo bar  ]
## END

#### simple_test_builtin

test -n "foo"
echo status=$?

test -n "foo" -a -n "bar"
echo status=$?

[ -n foo ]
echo status=$?

echo ---

shopt --set ysh:all
shopt --unset errexit

test -n "foo" -a -n "bar"
echo status=$?

[ -n foo ]
echo status=$?

test -z foo
echo status=$?


echo ---

# The one arg form is disallowed because it's confusing that test -n test -n -n
# are the same thing.  In YSH, things that look like flags should be flags.
test z
echo status=$?

test -z
echo status=$?

## STDOUT:
status=0
status=0
status=0
---
status=2
status=2
status=1
---
status=2
status=2
## END

#### long flags to test
# no options necessary!

test --dir /
echo status=$?

touch foo
test --file foo
echo status=$?

test --exists /
echo status=$?

test --symlink foo
echo status=$?

test --typo foo
echo status=$?

## STDOUT:
status=0
status=0
status=0
status=1
status=2
## END

#### test --true; test --false
shopt --set ysh:upgrade

for expr in (true, false, '', 'other') {
  pp test_ (expr)

  try {
    test --true $[expr]
  }
  echo true=$[_error.code]

  try {
    test --false $[expr]
  }
  echo false=$[_error.code]
  echo
}

## STDOUT:
(Bool)   true
true=0
false=1

(Bool)   false
true=1
false=0

(Str)   ""
true=1
false=1

(Str)   "other"
true=1
false=1

## END

#### More test --true --false
shopt --set ysh:upgrade

var d = {}

try {
  test --true $[bool(d)]
}
echo dict=$[_error.code]

setvar d.key = 'val'

try {
  test --true $[bool(d)]
}
echo dict=$[_error.code]

echo

if test --true $[bool(d)] && ! test -f / {
  echo AndOr
}

## STDOUT:
dict=1
dict=0

AndOr
## END


#### Make sure [[ is not affected by --true --false

set +o errexit

$SH +o ysh:all -c '[[ --true ]]; echo dbracket=$?'
$SH +o ysh:all -c '[[ --false ]]; echo dbracket=$?'

$SH +o ysh:all -c '[[ --true true ]]; echo dbracket=$?'
echo "parse error $?"
$SH +o ysh:all -c '[[ --false false ]]; echo dbracket=$?'
echo "parse error $?"

## STDOUT:
dbracket=0
dbracket=0
parse error 2
parse error 2
## END

#### push-registers
shopt --set ysh:upgrade
shopt --unset errexit

status_code() {
  return $1
}

[[ foo =~ (.*) ]]

status_code 42
push-registers {
  status_code 43
  echo status=$?

  [[ bar =~ (.*) ]]
  echo ${BASH_REMATCH[@]}
}
# WEIRD SEMANTIC TO REVISIT: push-registers is "SILENT" as far as exit code
# This is for the headless shell, but hasn't been tested.
# Better method: maybe we should provide a way of SETTING $?

echo status=$?

echo ${BASH_REMATCH[@]}
## STDOUT:
status=43
bar bar
status=42
foo foo
## END

#### push-registers usage
shopt --set parse_brace

push-registers
echo status=$?

push-registers a b
echo status=$?

push-registers a b {  # hm extra args are ignored
  echo hi
}
echo status=$?

## STDOUT:
status=2
status=2
hi
status=0
## END

#### redir
shopt --set parse_brace parse_proc

proc p {
  echo 'proc'
}

redir >out.txt {
  p
  echo 'builtin'
}

cat out.txt

echo ---

redir <out.txt {
  tac
}

# Awkward bash syntax, but we'll live with it
redir {left}>left.txt {right}>right.txt {
  echo 1 >& $left
  echo 1 >& $right

  echo 2 >& $left
  echo 2 >& $right

  echo 3 >& $left
}

echo ---
comm -23 left.txt right.txt

## STDOUT:
proc
builtin
---
builtin
proc
---
3
## END

#### type(x)
shopt --set parse_ysh_expr_sub

echo $[type(1234)]
echo $[type('foo')]
echo $[type(false)]
echo $[type(1.234)]
echo $[type([])]
echo $[type({})]
echo $[type(null)]

shopt --set ysh:upgrade

func f() {
  return (42)
}

echo $[type(f)]
echo $[type(len)]
echo $[type('foo'=>startsWith)]
echo $[type('foo'=>join)]  # Type error happens later
echo $[type(1..<3)]
## STDOUT:
Int
Str
Bool
Float
List
Dict
Null
Func
BuiltinFunc
BoundFunc
BoundFunc
Range
## END

#### source ///osh/two.sh and $LIB_OSH

source ///osh/two.sh
echo status=$?

source $LIB_OSH/two.sh
echo status=$?

# errors
source ///
echo status=$?
source ///x
echo status=$?

## STDOUT:
status=0
status=0
status=1
status=1
## END
