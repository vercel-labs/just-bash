## oils_failures_allowed: 3

#### source-guard is an old way of preventing redefinition - could remove it
shopt --set ysh:upgrade

source-guard 'main' || return 0
source $REPO_ROOT/spec/testdata/module/common.ysh
source $REPO_ROOT/spec/testdata/module/module1.ysh
## STDOUT:
common
module1
## END

#### is-main

# This sources lib.ysh
$SH $REPO_ROOT/spec/testdata/module/main.ysh

# Run it directly
$SH $REPO_ROOT/spec/testdata/module/lib.ysh

## STDOUT:
lib.ysh is not the main module
hi from main.ysh
hi from lib.ysh
## END

#### is-main with -c and stdin

$SH -c 'echo -c; is-main; echo status=$?'

echo 'echo stdin; is-main; echo status=$?' | $SH

## STDOUT:
-c
status=0
stdin
status=0
## END

#### is-main with use/modules
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/main.ysh
$SH $REPO_ROOT/spec/testdata/module2/main.ysh

## STDOUT:
main.ysh is not the main module
hi from main.ysh
## END

#### use builtin usage

use
echo no-arg=$?

use foo
echo one-arg=$?

use --extern foo
echo extern=$?

use --bad-flag
echo bad-flag=$?

use too many
echo too-many=$?

use ///no-builtin
echo no-builtin=$?

## STDOUT:
no-arg=2
one-arg=1
extern=0
bad-flag=2
too-many=2
no-builtin=1
## END

#### use usage with --pick etc.
#shopt --set ysh:upgrade

use foo --bad-flag
echo bad-flag=$?

use foo --all-provided zz
echo all-provided=$?

use foo --all-for-testing zz
echo all-for-testing=$?

echo

use $REPO_ROOT/spec/testdata/module2/cycle1.ysh --pick
echo no-picked=$?

use $REPO_ROOT/spec/testdata/module2/cycle1.ysh --pick c1 c1
echo picked=$?


## STDOUT:
bad-flag=2
all-provided=2
all-for-testing=2

no-picked=2
picked=0
## END

#### use --extern is a no-op, for static analysis

use --extern grep sed awk
echo status=$?

use --extern zzz
echo status=$?

## STDOUT:
status=0
status=0
## END

#### use foo.ysh creates a value.Obj, and it's cached on later invocations

shopt --set ysh:upgrade

var caller_no_leak = 42

use $REPO_ROOT/spec/testdata/module2/util.ysh

# This is a value.Obj
pp test_ (['util', util])
var id1 = vm.id(util)

var saved_util = util

use $REPO_ROOT/spec/testdata/module2/util.ysh
pp test_ (['repeated', util])
var id2 = vm.id(util)

# Create a symlink to test normalization

ln -s $REPO_ROOT/spec/testdata/module2/util.ysh symlink.ysh

use symlink.ysh
pp test_ (['symlink', symlink])
var id3 = vm.id(symlink)

#pp test_ ([id1, id2, id3])

# Make sure they are all the same object
assert [id1 === id2]
assert [id2 === id3]

# Doesn't leak from util.ysh
echo "setvar_noleak $[getVar('setvar_noleak')]"
echo "setglobal_noleak $[getVar('setglobal_noleak')]"

## STDOUT:
caller_no_leak = null
(List)   ["util",("MY_INTEGER":42,"log":<Proc>,"die":<Proc>,"setvar_noleak":"util.ysh","setglobal_noleak":"util.ysh","invokableObj":("x":3,"y":4) --> ("__invoke__":<Proc>)) --> ("__invoke__":<BuiltinProc>)]
(List)   ["repeated",("MY_INTEGER":42,"log":<Proc>,"die":<Proc>,"setvar_noleak":"util.ysh","setglobal_noleak":"util.ysh","invokableObj":("x":3,"y":4) --> ("__invoke__":<Proc>)) --> ("__invoke__":<BuiltinProc>)]
(List)   ["symlink",("MY_INTEGER":42,"log":<Proc>,"die":<Proc>,"setvar_noleak":"util.ysh","setglobal_noleak":"util.ysh","invokableObj":("x":3,"y":4) --> ("__invoke__":<Proc>)) --> ("__invoke__":<BuiltinProc>)]
setvar_noleak null
setglobal_noleak null
## END

#### procs in a module can call setglobal on globals in that module
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/globals.ysh

# get() should work on Obj too.  Possibly we should get rid of the default
var myproc = get(propView(globals), 'mutate-g1', null)
call setVar('mutate-g1', myproc)

# you can mutate it internally, but the mutation isn't VISIBLE.  GAH!
# I wonder if you make Cell a value? or something
mutate-g1
echo

# PROBLEM: This is a value.Obj COPY, not the fucking original!!!
# immutable objects??

#pp test_ ([vm.id(globals.d), globals.d])

call globals.mutateG2()
echo

#= propView(globals)

# these are not provided
echo "globals.g1 = $[get(globals, 'g1', null)]"
echo "globals.g2 = $[get(globals, 'g2', null)]"
echo

#pp frame_vars_
# Shouldn't appear here
echo "importer g1 = $[getVar('g1')]"
echo "importer g2 = $[getVar('g2')]"

## STDOUT:
g1 = g1
g1 = proc mutated

g2 = g2
g2 = func mutated

globals.g1 = null
globals.g2 = null

importer g1 = null
importer g2 = null
## END

#### no provided names
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/no-provide.ysh

## status: 1
## STDOUT:
## END

#### bad provide type
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/bad-provide-type.ysh

echo 'should not get here'

## status: 1
## STDOUT:
## END

#### invalid provide entries
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/bad-provide.ysh

echo 'should not get here'

## status: 1
## STDOUT:
## END

#### use foo.ysh creates a value.Obj with __invoke__
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/util.ysh

# This is a value.Obj
#pp test_ (util)

util log 'hello'
util die 'hello there'

## STDOUT:
caller_no_leak = null
log hello
die hello there
## END

#### module itself is invokable Obj, which can contain invokable obj!
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/util.ysh

util invokableObj (1)

# Usage error
#util invokableObj 

## STDOUT:
caller_no_leak = null
sum = 8
## END

#### argument binding test
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/util2.ysh

util2 echo-args w1 w2 w3 w4 (3, 4, 5, 6, n1=7, n2=8, n3=9) {
  echo hi
}

echo ---

util2 echo-args w1 w2 (3, 4, n3=9) {
  echo hi
}

## STDOUT:
(List)   ["w1","w2"]
(List)   ["w3","w4"]

(List)   [3,4]
(List)   [5,6]

(List)   [7,8]
(Dict)   {"n3":9}

<Command>
---
(List)   ["w1","w2"]
(List)   []

(List)   [3,4]
(List)   []

(List)   [42,43]
(Dict)   {"n3":9}

<Command>
## END

#### module-with-hyphens
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/for-xtrace.ysh

for-xtrace increment

var mod = getVar('for-xtrace')
pp test_ (mod.counter)

## STDOUT:
[for-xtrace]
counter = 5
counter = 6
(Int)   6
## END


#### modules can access __builtins__ directly
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/builtins.ysh

var mylen = builtins.mylen

pp test_ (mylen([3,4,5]))

## STDOUT:
(Int)   3
## END

#### use may only be used a TOP level, not within proc
shopt --set ysh:upgrade

proc use-it {
  use $REPO_ROOT/spec/testdata/module2/builtins.ysh
}

use-it

## status: 2
## STDOUT:
## END

#### Mutable variables are frozen - beware!

shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/for-xtrace.ysh

for-xtrace increment

var mod = getVar('for-xtrace')
pp test_ (mod.counter)

for-xtrace increment

pp test_ (mod.counter)

for-xtrace increment

## STDOUT:
[for-xtrace]
counter = 5
counter = 6
(Int)   6
counter = 7
(Int)   6
counter = 8
## END

#### module invoked without any arguments is an error
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/util.ysh

util

## status: 2
## STDOUT:
caller_no_leak = null
## END

#### module invoked with nonexistent name is error
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/util.ysh

util zzz

## status: 2
## STDOUT:
caller_no_leak = null
## END

#### circular import doesn't result in infinite loop, or crash

use $REPO_ROOT/spec/testdata/module2/cycle1.ysh

# These use each other
use $REPO_ROOT/spec/testdata/module2/cycle2.ysh

pp test_ (cycle1)
pp test_ (cycle2)

echo hi

## STDOUT:
(Obj)   ("c1":"c1") --> ("__invoke__":<BuiltinProc>)
(Obj)   ("c2":"c2") --> ("__invoke__":<BuiltinProc>)
hi
## END

#### Module with parse error

shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/parse-error.ysh

echo 'should not get here'

## status: 2
## STDOUT:
## END

#### Module with runtime error

shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/runtime-error.ysh

echo 'should not get here'

## status: 1
## STDOUT:
runtime-error before
## END

#### user can inspect __modules__ cache

echo 'TODO: Dict view of realpath() string -> Obj instance'

## STDOUT:
## END

#### use foo.ysh --pick a b

use $REPO_ROOT/spec/testdata/module2/builtins.ysh --pick mylen mylen2

pp test_ (mylen([3,4,5]))

pp test_ (mylen2([4,5]))

## STDOUT:
(Int)   3
(Int)   2
## END

#### use foo.ysh --pick nonexistent
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/builtins.ysh --pick mylen nonexistent

## status: 1
## STDOUT:
## END


#### use foo.ysh --all-provided

echo TODO

## STDOUT:
## END


#### use foo.ysh --all-for-testing

echo TODO

## STDOUT:
## END
