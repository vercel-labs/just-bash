## our_shell: ysh
## oils_failures_allowed: 1
## oils_cpp_failures_allowed: 3

#### eval builtin does not take a literal block - can restore this later

var b = ^(echo obj)
call io->eval (b)

call io->eval (^(echo command literal))

# Doesn't work because it's a positional arg
eval { echo block }

## status: 2
## STDOUT:
obj
command literal
## END


#### Eval a block within a proc
proc run (;;; block) {
  call io->eval(block)
}

run {
  echo 'In a block!'
}
## STDOUT:
In a block!
## END

#### Eval block created by calling a proc
proc lazy-block ( ; out; ; block) {
  call out->setValue(block)
}

var myglobal = 0

lazy-block (&my_block) {
  json write (myglobal)
}

call io->eval(my_block)
setvar myglobal = 1
call io->eval(my_block)
## STDOUT:
0
1
## END

#### io->eval with argv bindings
call io->eval(^(echo "$@"), pos_args=:| foo bar baz |)
call io->eval(^(pp test_ (:| $1 $2 $3 |)), pos_args=:| foo bar baz |)
## STDOUT:
foo bar baz
(List)   ["foo","bar","baz"]
## END

#### eval lines with argv bindings
proc my-split (;;; block) {
  while read --raw-line {
    var cols = split(_reply)
    call io->eval(block, pos_args=cols)
  }
}

printf 'a b\nc d\n' | my-split {
  echo "$2 $1"
}

printf 'a b\nc d\n' | my-split {
  var mylocal = 'mylocal'
  echo "$2 $1 $mylocal"
}

# Now do the same thing inside a proc
proc p {
  printf 'a b\nc d\n' | my-split {
    var local2 = 'local2'
    echo "$2 $1 $local2"
  }
}

echo
p

## STDOUT:
b a
d c
b a mylocal
d c mylocal

b a local2
d c local2
## END

#### eval lines with var bindings

proc my-split (;;; block) {
  while read --raw-line {
    var cols = split(_reply)
    call io->eval(block, vars={_line: _reply, _first: cols[0]})
  }
}

printf 'a b\nc d\n' | my-split {
  var mylocal = 'mylocal'
  echo "$_line | $_first $mylocal"
}

# Now do the same thing inside a proc
proc p {
  printf 'a b\nc d\n' | my-split {
    var local2 = 'local2'
    echo "$_line | $_first $local2"
  }
}

echo
p

## STDOUT:
a b | a mylocal
c d | c mylocal

a b | a local2
c d | c local2
## END

#### eval with custom dollar0
var b = ^(write $0)
call io->eval(b, dollar0="my arg0")
## STDOUT:
my arg0
## END

#### eval with vars bindings
var myVar = "abc"
call io->eval(^(pp test_ (myVar)))
call io->eval(^(pp test_ (myVar)), vars={ 'myVar': '123' })

# eval doesn't modify it's environment
call io->eval(^(pp test_ (myVar)))

## STDOUT:
(Str)   "abc"
(Str)   "123"
(Str)   "abc"
## END

#### dynamic binding names and mutation
proc foreach (binding, in_; list ;; block) {
  if (in_ !== "in") {
    error 'Must use the "syntax" `foreach <binding> in (<expr>) { ... }`'
  }

  for item in (list) {
    call io->eval(block, vars={ [binding]: item })
  }
}

var mydicts = [{'a': 1}, {'b': 2}, {'c': 3}]
foreach mydict in (mydicts) {
  var mylocal = 'z'
  setvar mydict.z = mylocal

  pp test_ (mydict)
  setvar mydict.d = 0
}
echo

for d in (mydicts) {
  pp test_ (d)
}

## STDOUT:
(Dict)   {"a":1,"z":"z"}
(Dict)   {"b":2,"z":"z"}
(Dict)   {"c":3,"z":"z"}

(Dict)   {"a":1,"z":"z","d":0}
(Dict)   {"b":2,"z":"z","d":0}
(Dict)   {"c":3,"z":"z","d":0}
## END

#### binding procs in the eval-ed namespace
proc __flag (short, long) {
  echo "flag $short $long"
}

proc __arg (name) {
  echo "arg $name"
}

proc parser (; spec ;; block) {
  call io->eval(block, vars={ 'flag': __flag, 'arg': __arg })
}

parser (&spec) {
  flag -h --help
  arg file
}

# but flag/arg are unavailable outside of `parser`
# _error.code = 127 is set on "command not found" errors

try { flag }
if (_error.code !== 127) { error 'expected failure' }

try { arg }
if (_error.code !== 127) { error 'expected failure' }

## STDOUT:
flag -h --help
arg file
## END

#### vars initializes the variable frame, but does not remember it
var vars = { 'foo': 123 }
call io->eval(^(var bar = 321;), vars=vars)
pp test_ (vars)

## STDOUT:
(Dict)   {"foo":123}
## END

#### eval pos_args must be strings
call io->eval(^(true), pos_args=[1, 2, 3])
## status: 3

#### eval with vars follows same scoping as without

proc local-scope {
  var myVar = "foo"
  call io->eval(^(echo $myVar), vars={ someOtherVar: "bar" })
  call io->eval(^(echo $myVar))
}

# In global scope
var myVar = "baz"
call io->eval(^(echo $myVar), vars={ someOtherVar: "bar" })
call io->eval (^(echo $myVar))

local-scope
## STDOUT:
baz
baz
foo
foo
## END

#### eval 'mystring' vs. call io->eval(myblock)

eval 'echo plain'
echo plain=$?
var b = ^(echo plain)
call io->eval(b)
echo plain=$?

echo

# This calls main_loop.Batch(), which catches
# - error.Parse
# - error.ErrExit
# - error.FatalRuntime - glob errors, etc.?

try {
  eval 'echo one; false; echo two'
}
pp test_ (_error)

# This calls CommandEvaluator.EvalCommand(), as blocks do

var b = ^(echo one; false; echo two)
try {
  call io->eval(b)
}
pp test_ (_error)

## STDOUT:
plain
plain=0
plain
plain=0

one
(Dict)   {"code":1}
one
(Dict)   {"code":1}
## END

#### io->eval(to_dict=true) - local and global

var g = 'global'

# in the global frame
var d = io->eval(^(var foo = 42; var bar = g;), to_dict=true)
pp test_ (d)

# Same thing in a local frame
proc p (myparam) {
  var mylocal = 'local'
  # TODO: ^() needs to capture
  var cmd = ^(
    var foo = 42
    var g = "-$g"
    var p = "-$myparam"
    var L = "-$mylocal"
  )
  var d = io->eval(cmd, to_dict=true)
  pp test_ (d)
}
p param

## STDOUT:
(Dict)   {"foo":42,"bar":"global"}
(Dict)   {"foo":42,"g":"-global","p":"-param","L":"-local"}
## END

#### io->eval(to_dict=true) with dollar0, pos_args, vars - dict ordering bug

# TODO: mycpp/gc_dict.h should preserve insertion order, in the presence of
# deletions, like CPython

proc Dict ( ; out; ; block) {
  var d = io->eval(block, dollar0='zero', pos_args=:|a b c|,
                   vars={X: 'X', _Y: '_Y'}, to_dict=true)
  call out->setValue(d)
}

var global = 'global'

Dict (&d) {
  foo = global
  z = $0
  one = $1
  two = ${2}
  three = "+$3"
  # Note: X does NOT appear in the output, ctx_Eval makes it work.
  x = X
  y = _Y
}

json write (d)
#pp test_ (d)

## STDOUT:
{
  "foo": "global",
  "z": "zero",
  "one": "a",
  "two": "b",
  "three": "+c",
  "x": "X",
  "y": "_Y"
}
## END

#### io->eval(to_dict=true) with in_captured_frame=true

proc Dict ( ; out; ; block) {
  var d = io->eval(block, dollar0='zero', pos_args=:|a b c|,
                   vars={X: 'X', _Y: '_Y'}, in_captured_frame=true, to_dict=true)
  call out->setValue(d)
}

var global = 'global'

func makeDict() {
  var var_in_p_frame = 'p'

  Dict (&d) {
    foo = global
    z = $0
    one = $1
    two = ${2}
    three = "+$3"
    # Note: X does NOT appear in the output, ctx_Eval makes it work.
    x = X
    y = _Y
  }

  return (d)
}

var d = makeDict()
json write (d)

## STDOUT:
{
  "var_in_p_frame": "p",
  "foo": "global",
  "z": "zero",
  "one": "a",
  "two": "b",
  "three": "+c",
  "x": "X",
  "y": "_Y"
}
## END


#### parseCommand then io->eval(to_dict=true) - in global scope

var g = 'global'
var cmd = parseCommand('var x = 42; echo hi; var y = g')
#var cmd = parseCommand('echo hi')

pp test_ (cmd)
#pp asdl_ (cmd)

var d = io->eval(cmd, to_dict=true)

pp test_ (d)

## STDOUT:
<Command>
hi
(Dict)   {"x":42,"y":"global"}
## END

#### parseCommand with syntax error

try {
  var cmd = parseCommand('echo >')
}
pp test_ (_error)

## STDOUT:
(Dict)   {"code":3,"message":"Syntax error in parseCommand()"}
## END


#### Dict (&d) { ... } converts frame to dict

proc Dict ( ; out; ; block) {
  var d = io->eval(block, to_dict=true)
  call out->setValue(d)
}

# it can read f

var myglobal = 'global'
var k = 'k-shadowed'
var k2 = 'k2-shadowed'

Dict (&d) {
  bare = 42

  # uh these find the wrong one
  # This is like redeclaring the one above, but WITHOUT the static error
  # HM HM HM
  var k = 'k-block'
  setvar k = 'k-block-mutated'

  # Finds the global, so not checked
  setvar k2 = 'k2-block'

  # This one is allowed
  setvar k3 = 'k3'

  # do we allow this?
  setvar myglobal = 'global'
}

pp test_ (d)


# Same problem as Hay test cases!
const c = 99

Dict (&d2) {
  const c = 101
}

pp test_ (d2)

exit

# restored to the shadowed values
echo k=$k
echo k2=$k2

proc p {
  Dict (&d) {
    var k = 'k-proc'
    setvar k = 'k-proc-mutated'

    # Not allowed STATICALLY, because o fproc check
    #setvar k2 = 'k2-proc'  # local, so it's checked
  }
}

## STDOUT:
(Dict)   {"bare":42,"k":"k-block-mutated","k3":"k3"}
(Dict)   {"c":101}
## END

#### block in Dict (&d) { ... } can read from outer scope

proc Dict ( ; out; ; block) {
  var d = io->eval(block, to_dict=true)
  call out->setValue(d)
}

func f() {
  var x = 42

  Dict (&d) {
    y = x + 1  # x is from outer scope
  }
  return (d)
}

var mydict = f()

pp test_ (mydict)

## STDOUT:
(Dict)   {"y":43}
## END

#### block in yb-capture Dict (&d) can read from outer scope

proc yb-capture(; out; ; block) {
  # capture status and stdout

  var stdout = ''
  try {
    { call io->eval(block) } | read --all (&stdout)
  }
  var result = {status: _pipeline_status[0], stdout}

  call out->setValue(result)
}

func f() {
  var x = 42

  yb-capture (&r) {
    echo $[x + 1]
  }

  return (r)
}

var result = f()

pp test_ (result)

## STDOUT:
(Dict)   {"status":0,"stdout":"43\n"}
## END


#### Dict (&d) and setvar 

proc Dict ( ; out; ; block) {
  echo "Dict proc global outer=$outer"
  var d = io->eval(block, to_dict=true)

  #pp frame_vars_

  #echo "Dict outer2=$outer2"
  call out->setValue(d)
}

var outer = 'xx'

Dict (&d) {
  # new variable in the front frame
  outer2 = 'outer2'

  echo "inside Dict outer=$outer"
  setvar outer = 'zz'

  setvar not_declared = 'yy'

  #echo 'inside Dict block'
  #pp frame_vars_
}

pp test_ (d)
echo "after Dict outer=$outer"

echo


# Now do the same thing inside a proc

proc p {
  var outer = 'p-outer'

  Dict (&d) {
    p = 99
    setvar outer = 'p-outer-mutated'
  }

  pp test_ (d)
  echo "[p] after Dict outer=$outer"
}

p

echo "after p outer=$outer"

## STDOUT:
Dict proc global outer=xx
inside Dict outer=xx
(Dict)   {"outer2":"outer2","not_declared":"yy"}
after Dict outer=zz

Dict proc global outer=zz
(Dict)   {"p":99}
[p] after Dict outer=p-outer-mutated
after p outer=zz
## END

#### Dict (&d) and setglobal

proc Dict ( ; out; ; block) {
  var d = io->eval(block, to_dict=true)
  call out->setValue(d)
}

var g = 'xx'

Dict (&d) {
  setglobal g = 'zz'

  a = 42
  pp frame_vars_
}
echo

pp test_ (d)
echo g=$g

#pp frame_vars_

## STDOUT:
    [frame_vars_] __E__ a

(Dict)   {"a":42}
g=zz
## END

#### bindings created shvar persist, which is different than eval(to_dict=true)

var a = 'a'
shvar IFS=: a='b' {
  echo a=$a
  inner=z
  var inner2 = 'z'
}
echo a=$a
echo inner=$inner 
echo inner2=$inner2

## STDOUT:
a=b
a=a
inner=z
inner2=z
## END

#### io->eval with in_captured_frame=true can express cd builtin

proc my-cd (new_dir; ; ; block) {
  pushd $new_dir >/dev/null

  if (0) {
    # Get calling frame.  (The top-most frame, this one, has index -1)
    # This idiom does NOT work with modules
    var calling_frame = vm.getFrame(-2)
    call io->evalInFrame(block, calling_frame)
  } else {
    #call io->evalInCapturedFrame(block)
    call io->eval(block, in_captured_frame=true)
  }

  popd >/dev/null
}

var i = 42
my-cd /tmp {
  echo $PWD
  var my_pwd = PWD
  var j = i + 1
}
echo "my_pwd=$my_pwd"
echo "j = $j"

## STDOUT:
/tmp
my_pwd=/tmp
j = 43
## END


#### io->eval with in_captured_frame=true can express cd builtin in different module

echo >lib.ysh '''
const __provide__ = :| my-cd |

proc my-cd (new_dir; ; ; block) {
  pushd $new_dir >/dev/null

  call io->eval(block, in_captured_frame=true)

  popd >/dev/null
}
'''

use ./lib.ysh

var i = 42
lib my-cd /tmp {
  #echo $PWD
  #var my_pwd = PWD
  var j = i + 1
}
#echo "my_pwd=$my_pwd"
echo "j = $j"

## STDOUT:
j = 43
## END

#### io->eval() has cleaner scoping than shell's eval builtin

#shopt --unset ysh:all
shopt --set ysh:upgrade
shopt --unset no_osh_builtins  # for local

sh-eval() {
  local do_not_leak=42  # this is visible
  eval $1
}

sh-eval 'echo "eval string do_not_leak=$do_not_leak"'

proc ysh-eval (;;; block) {
  var do_not_leak = 99
  call io->eval(block, in_captured_frame=true)
}

ysh-eval {
  echo "ysh block do_not_leak=$do_not_leak"
}

## status: 1
## STDOUT:
eval string do_not_leak=42
## END

#### io->eval with in_captured_frame=true and setglobal

echo >lib.ysh '''
const __provide__ = :| p x |

var x = "lib"

proc p (;;; block) {
  call io->eval(block, in_captured_frame=true)
}
'''

use ./lib.ysh

var x = 'main'

lib p {
  echo "block arg x = $x"
  setglobal x = "ZZ"
  echo "mutated = $x"
  var result = 'result'
}
#pp test_ (result)

# NOTE: we can modify our own x, but not lib.x!
pp test_ (x)
pp test_ (lib.x)

## STDOUT:
block arg x = main
mutated = ZZ
(Str)   "ZZ"
(Str)   "lib"
## END

#### eval should have a sandboxed mode

proc p (;;; block) {
  var this = 42

  # like --eval-pure, and like func?
  with-pure {
    # Do we still use io->eval?
    call io->eval(block)
  }

  # Or maybe we have free functions, like func/eval
  # There is no with-pure
  call eval(cmd)
  var d = eval(cmd, to_dict=true)

  eval-pure --dump d {
    var d = {}
  }
}

p {
  echo $this
}

## status: 1
## STDOUT:
TODO
## END

#### io->evalExpr() with vars, dollar0, pos_args

var ex = ^["$0 $1 $2 " ++ myvar]

var vars = {myvar: 'hello'}
var s = io->evalExpr(ex, dollar0='z', pos_args=:|a b c|, vars=vars)

echo $s

proc my-where (; pred) {
  # note: for line in (io.stdin) is messed up by spec test framework

  while read --raw-line (&line) {
    var vars = {_line: line}
    #= line
    var b = io->evalExpr(pred, vars=vars)
    if (b) {
      echo $line
    }
  }
}


seq 5 | my-where [_line ~== 2 or _line ~== 4]
echo ---

seq 5 10 | my-where [_line % 2 === 1]

## STDOUT:
z a b hello
2
4
---
5
7
9
## END
