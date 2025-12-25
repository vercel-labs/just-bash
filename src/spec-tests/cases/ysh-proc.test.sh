## oils_failures_allowed: 0

#### Open proc (any number of args)
shopt --set parse_proc

proc f {
  var x = 42
  return $x
}
# this gets called with 3 args then?
f a b c
echo status=$?
## STDOUT:
status=42
## END

#### Closed proc with no args, passed too many
shopt --set parse_proc

proc f() {
  return 42
}
f
echo status=$?

f a b  # status 2

## status: 3
## STDOUT:
status=42
## END

#### Open proc has ARGV
shopt -s ysh:all
proc foo { 
  echo ARGV @ARGV
  # do we care about this?  I think we want to syntactically remove it from YSH
  # but it can still be used for legacy
  echo dollar-at "$@"
}
builtin set -- a b c
foo x y z
## STDOUT:
ARGV x y z
dollar-at a b c
## END

#### Closed proc has empty "$@" or ARGV
shopt -s ysh:all

proc foo(d, e, f) { 
  write params $d $e $f
  argv.py dollar-at "$@"
  argv.py ARGV @ARGV
}
builtin set -- a b c
foo x y z
## STDOUT:
params
x
y
z
['dollar-at', 'a', 'b', 'c']
['ARGV']
## END

#### Proc with default args
shopt --set parse_proc

proc f(x='foo') {
  echo x=$x
}
f
## STDOUT:
x=foo
## END

#### Proc with word params
shopt --set parse_proc

# doesn't require ysh:all
proc f(x, y, z) {
  echo $x $y $z
  var ret = 42
  return $ret
}
# this gets called with 3 args then?
f a b c
echo status=$?
## STDOUT:
a b c
status=42
## END

#### Proc with ... "rest" word params 

# TODO: opts goes with this
# var opt = grep_opts.parse(ARGV)
#
# func(**opt)  # Assumes keyword args match?
# parse :grep_opts :opt @ARGV

shopt -s ysh:all

proc f(...names) {
  write names: @names
}
# this gets called with 3 args then?
f a b c
echo status=$?
## STDOUT:
names:
a
b
c
status=0
## END

#### word rest params 2
shopt --set ysh:all

proc f(first, ...rest) {  # @ means "the rest of the arguments"
  write --sep ' ' -- $first
  write --sep ' ' -- @rest        # @ means "splice this array"
}
f a b c
## STDOUT:
a
b c
## END

#### proc with typed args
shopt --set ysh:upgrade

# TODO: duplicate param names aren't allowed
proc p (a; mylist, mydict; opt Int = 42) {
  pp test_ (a)
  pp test_ (mylist)
  pp test_ (mydict)
  #pp test_ (opt)
}

p WORD ([1,2,3], {name: 'bob'})

echo ---

p x (:| a b |, {bob: 42}, a = 5)

## STDOUT:
(Str)   "WORD"
(List)   [1,2,3]
(Dict)   {"name":"bob"}
---
(Str)   "x"
(List)   ["a","b"]
(Dict)   {"bob":42}
## END

#### Proc name-with-hyphen
shopt --set parse_proc parse_at

proc name-with-hyphen {
  echo @ARGV
}
name-with-hyphen x y z
## STDOUT:
x y z
## END

#### Proc with block arg
shopt --set ysh:upgrade

# TODO: Test more of this
proc f(x, y ; ; ; block) {
  echo f word $x $y

  if (block) {
    call io->eval(block)
  }
}
f a b { echo FFF }

# With varargs and block
shopt --set parse_proc

proc g(x, y, ...rest ; ; ; block) {
  echo g word $x $y
  echo g rest @rest

  if (block) {
    call io->eval(block)
  }
}
g a b c d {
  echo GGG
}

## STDOUT:
f word a b
FFF
g word a b
g rest c d
GGG
## END

#### proc returning wrong type
shopt --set parse_proc

# this should print an error message
proc f {
  var a = %(one two)
  return $a
}
f
## status: 3
## STDOUT:
## END

#### proc returning invalid string
shopt --set parse_proc

# this should print an error message
proc f {
  var s = 'not an integer status'
  return $s
}
f
## status: 1
## STDOUT:
## END

#### 'return' doesn't accept expressions
proc p {
  return 1 + 2
}
p
## status: 2
## STDOUT:
## END

#### procs are in same namespace as variables
shopt --set parse_proc parse_ysh_expr_sub

proc myproc {
  echo hi
}

echo "myproc is a $[type(myproc)]"

## STDOUT:
myproc is a Proc
## END

#### Nested proc is allowed
shopt --set parse_proc

proc f {
  proc g {
    echo 'G'
  }
  g
}
f
g  # g is defined in the local scope of f
## status: 127
## STDOUT:
G
## END

#### Procs defined inside compound statements

shopt --set ysh:upgrade

var p = null
for x in 1 2 {
  proc inner {
    echo 'loop'
  }
  setvar p = inner
}
p

{
  proc p {
    echo 'brace'
  }
}
p

## STDOUT:
loop
brace
## END

#### Block can be passed literally, or as expression in third arg group
shopt --set ysh:upgrade

proc p ( ; ; ; block) {
  call io->eval(block)
}

p { echo literal }

var block = ^(echo expression)
p (; ; block)

## STDOUT:
literal
expression
## END

#### Pass through all 4 kinds of args

shopt --set ysh:upgrade

proc p2 (...words; ...typed; ...named; block) {
  pp test_ (words)
  pp test_ (typed)
  pp test_ (named)
  #pp test_ (block)
  # To avoid <Block 0x??> - could change pp test_
  echo $[type(block)]
}

proc p1 (...words; ...typed; ...named; block) {
  p2 @words (...typed; ...named; block)
}

p2 a b ('c', 'd', n=99) {
  echo literal
}
echo

# Same thing
var block = ^(echo expression)

# Note: you need the second explicit ;

p2 a b ('c', 'd'; n=99; block)
echo

# what happens when you do this?
p2 a b ('c', 'd'; n=99; block) {
  echo duplicate
}

## status: 1
## STDOUT:
(List)   ["a","b"]
(List)   ["c","d"]
(Dict)   {"n":99}
Command

(List)   ["a","b"]
(List)   ["c","d"]
(Dict)   {"n":99}
Command

## END

#### Global and local ARGV, like "$@"

$SH -o ysh:upgrade -c '
argv.py "$@"
argv.py @ARGV
#argv.py "${ARGV[@]}"  # not useful, but it works!

set -- "a b" c
argv.py "$@"
argv.py @ARGV  # separate from the argv stack

f() {
  argv.py "$@"
  argv.py @ARGV  # separate from the argv stack
}
f 1 "2 3"
'

## STDOUT:
[]
[]
['a b', 'c']
[]
['1', '2 3']
[]
## END


#### Mutating global ARGV

$SH -o ysh:upgrade -c '
argv.py global @ARGV

# should not be ignored
call ARGV->append("GG")

argv.py global @ARGV
'
## STDOUT:
['global']
['global', 'GG']
## END

#### Mutating local ARGV

$SH -o ysh:upgrade -c '
argv.py global @ARGV

proc p {
  argv.py @ARGV
  call ARGV->append("LL")
  argv.py @ARGV
}

p local @ARGV

argv.py global @ARGV

' dummy0 'a b' c

## STDOUT:
['global', 'a b', 'c']
['local', 'a b', 'c']
['local', 'a b', 'c', 'LL']
['global', 'a b', 'c']
## END


#### typed proc allows all kinds of args
shopt -s ysh:upgrade

typed proc p (w; t; n; block) {
  pp test_ (w)
  pp test_ (t)
  pp test_ (n)
  echo $[type(block)]
}

p word (42, n=99) {
  echo block
}


## STDOUT:
(Str)   "word"
(Int)   42
(Int)   99
Command
## END

#### can unset procs without -f
shopt -s ysh:upgrade

proc foo() {
  echo bar
}

try { foo }
echo status=$[_error.code]

pp test_ (foo)
unset foo
#pp test_ (foo)

try { foo }
echo status=$[_error.code]

## STDOUT:
bar
status=0
<Proc>
status=127
## END

#### procs shadow sh-funcs
shopt -s ysh:upgrade

f() {
  echo sh-func
}

proc f {
  echo proc
}

f
## STDOUT:
proc
## END

#### first word skips non-proc variables
shopt -s ysh:upgrade

grep() {
  echo 'sh-func grep'
}

var grep = 'variable grep'

grep

# We first find `var grep`, but it's a Str not a Proc, so we skip it and then
# find `function grep`.

## STDOUT:
sh-func grep
## END

#### proc resolution changes with the local scope
shopt -s ysh:upgrade

proc foo {
  echo foo
}

proc bar {
  echo bar
}

proc inner {
  var foo = bar
  foo  # Will now reference `proc bar`
}

foo
inner
foo  # Back to the global scope, foo still references `proc foo`

# Without this behavior, features like `eval(b, vars={ flag: __flag })`, needed
# by parseArgs, will not work. `eval` with `vars` adds a new frame to the end of
# `mem.var_stack` with a local `flag` set to `proc __flag`. However, then we
# cannot resolve `flag` by only checking `mem.var_stack[0]` like we could with
# a proc declared normally, so we must search `mem.var_stack` from last to first.

## STDOUT:
foo
bar
foo
## END


#### procs are defined in local scope
shopt -s ysh:upgrade

proc gen-proc {
  eval 'proc localproc { echo hi }'
  pp frame_vars_

}

gen-proc

# can't suppress 'grep' failure
if false {
  try {
    pp frame_vars_ | grep localproc
  }
  pp test_ (_pipeline_status)
  #pp test_ (PIPESTATUS)
}

## STDOUT:
    [frame_vars_] __E__ ARGV localproc
## END


#### declare -f -F only prints shell functions
shopt --set parse_proc

myfunc() {
  echo hi
}

proc myproc {
  echo hi
}

declare -F
echo ---

declare -F myproc
echo status=$?

declare -f myproc
echo status=$?

## status: 0
## STDOUT:
declare -f myfunc
---
status=1
status=1
## END

#### compgen -A function shows user-defined invokables - shell funcs, Proc, Obj
shopt --set ysh:upgrade

my-shell-func() {
  echo hi
}

proc myproc {
  echo hi
}

compgen -A function

echo ---

proc define-inner {
  eval 'proc inner { echo inner }'
  #eval 'proc myproc { echo inner }'  # shadowed name
  compgen -A function
}
define-inner

echo ---

proc myinvoke (w; self) {
  pp test_ ([w, self])
}

var methods = Object(null, {__invoke__: myinvoke})
var myobj = Object(methods, {})

compgen -A function

## STDOUT:
my-shell-func
myproc
---
define-inner
inner
my-shell-func
myproc
---
define-inner
my-shell-func
myinvoke
myobj
myproc
## END

#### type / type -a builtin on invokables - shell func, proc, invokable
shopt --set ysh:upgrade

my-shell-func() {
   echo hi
}

proc myproc {
  echo hi
}

proc boundProc(; self) {
  echo hi
}

var methods = Object(null, {__invoke__: boundProc})
var invokable = Object(methods, {})

type -t my-shell-func
type -t myproc
type -t invokable
try {
  type -t methods  # not invokable!
}
echo $[_error.code]

echo ---

type my-shell-func
type myproc
type invokable
try {
  type methods  # not invokable!
}
echo $[_error.code]

echo ---

type -a my-shell-func
type -a myproc
type -a invokable

echo ---

if false {  # can't redefine right now
  invokable() {
    echo sh-func
  }
  type -a invokable
}

## STDOUT:
function
proc
proc
1
---
my-shell-func is a shell function
my-shell-func() {
   echo hi
}
myproc is a YSH proc
invokable is a YSH invokable
1
---
my-shell-func is a shell function
my-shell-func() {
   echo hi
}
myproc is a YSH proc
invokable is a YSH invokable
---
## END

#### type / type -a agrees on ordering of shell functions and procs
shopt --set ysh:upgrade

#type -t p

p() {
   echo 'sh-func'
}
p
type -t p
echo

proc p {
  echo 'YSH proc'
}
p
type -t p
## STDOUT:
sh-func
function

YSH proc
proc
## END

#### invokable Obj that doesn't declare self
shopt --set ysh:upgrade

proc boundProc(no_self; ) {
  echo 'bad'
}

var methods = Object(null, {__invoke__: boundProc})
var invokable = Object(methods, {x: 3, y: 5})

invokable no_self

## status: 3
## STDOUT:
## END

#### invokable Obj is called with self
shopt --set ysh:upgrade

proc boundProc(; self) {
  echo "sum = $[self.x + self.y]"
}

var methods = Object(null, {__invoke__: boundProc})
var invokable = Object(methods, {x: 3, y: 5})

invokable

## STDOUT:
sum = 8
## END


#### invokable Obj with more typed args
shopt --set ysh:upgrade

proc myInvoke (word1, word2; self, int1, int2) {
  echo "sum = $[self.x + self.y]"
  pp test_ (self)
  pp test_ ([word1, word2, int1, int2])
}

# call it directly with 'self'
myInvoke a b ({x: 0, y: 1}, 42, 43)
echo

var methods = Object(null, {__invoke__: myInvoke})

var callable = Object(methods, {x: 2, y: 3})

# call it through the obj
callable a b (44, 45)

## STDOUT:
sum = 1
(Dict)   {"x":0,"y":1}
(List)   ["a","b",42,43]

sum = 5
(Obj)   ("x":2,"y":3) --> ("__invoke__":<Proc>)
(List)   ["a","b",44,45]
## END

#### two different objects can share the same __invoke__
shopt --set ysh:upgrade

proc boundProc(; self, more) {
  echo "sum = $[self.x + self.y + more]"
}

var methods = Object(null, {__invoke__: boundProc})

var i1 = Object(methods, {x: 3, y: 5})
var i2 = Object(methods, {x: 10, y: 42})

i1 (1)
i2 (1)

## STDOUT:
sum = 9
sum = 53
## END


#### Stateful proc with counter
shopt --set ysh:upgrade

proc invokeCounter(; self, inc) {
  setvar self.i += inc
  echo "counter = $[self.i]"
}

var methods = Object(null, {__invoke__: invokeCounter})
var counter = Object(methods, {i: 0})

counter (1)
counter (2)
counter (3)

## STDOUT:
counter = 1
counter = 3
counter = 6
## END

#### Procs are closures (capture their environment)
shopt --set ysh:upgrade

func makeProc() {
  var x = 42
  proc inner {
    echo "x = $x"
  }
  setvar x += 1
  return (inner)
}

const p = makeProc()
p

## STDOUT:
x = 43
## END
