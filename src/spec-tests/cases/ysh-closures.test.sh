## oils_failures_allowed: 0

#### Simple Expr Closure
shopt --set ysh:upgrade

proc my-expr (; expr) {
  echo $[io->evalExpr(expr)]
}

proc p {
  var i = 42
  my-expr [i + 1]
}

p

## STDOUT:
43
## END

#### Simple Block Closure
shopt --set ysh:upgrade

shopt --set ysh:upgrade

proc my-expr (; ; ; block) {
  call io->eval(block)
}

proc p {
  var i = 42
  my-expr {
    echo $[i + 1]
  }
}

p

## STDOUT:
43
## END

#### Expr Closures in a Loop !

# see demo/survey-closure.sh

shopt --set ysh:upgrade

proc task (; tasks, expr) {
  call tasks->append(expr)
}

func makeTasks() {
  var tasks = []
  var x = 'x'
  for i in (0 ..< 3) {
    var j = i + 2
    task (tasks, ^"$x: i = $i, j = $j")
  }
  return (tasks)
}

var exprs = makeTasks()
#= blocks

for ex in (exprs) {
  var s = io->evalExpr(ex)
  echo $s
}

## STDOUT:
x: i = 0, j = 2
x: i = 1, j = 3
x: i = 2, j = 4
## END

#### Block Closures in a Loop !
shopt --set ysh:upgrade

proc task (; tasks; ; b) {
  call tasks->append(b)
}

func makeTasks() {
  var tasks = []
  var x = 'x'
  for i in (0 ..< 3) {
    var j = i + 2
    task (tasks) { echo "$x: i = $i, j = $j" }
  }
  return (tasks)
}

var blocks = makeTasks()
#= blocks

for b in (blocks) {
  call io->eval(b)
}

## STDOUT:
x: i = 0, j = 2
x: i = 1, j = 3
x: i = 2, j = 4
## END


#### Explicit __invoke__ for "objects in a loop", not closures in a loop
shopt --set ysh:upgrade

var procs = []
for i in (0 ..< 3) {
  proc __invoke__ (; self) {
    echo "i = $[self.i]"
  }
  var methods = Object(null, {__invoke__})
  var obj = Object(methods, {i})
  call procs->append(obj)
}

for p in (procs) {
  p
}

# TODO: sugar
#  proc p (; self) capture {i} {
#    echo "i = $[self.i]"
#  }
#  call procs->append(p)

## STDOUT:
i = 0
i = 1
i = 2
## END


#### Expr Closures in a different module
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/closure.ysh --pick {local,global}_expr

echo $[io->evalExpr(global_expr)]

echo $[io->evalExpr(local_expr())]

## STDOUT:
global!
global local!
## END


#### Command Closures in a different module
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/closure.ysh --pick {local,global}_block

call io->eval(global_block)

call io->eval(local_block())

## STDOUT:
global!
global local!
## END

#### Closures as default argument
shopt --set ysh:upgrade

use $REPO_ROOT/spec/testdata/module2/closure.ysh --pick default_{expr,block}

echo $[io->evalExpr(default_expr())]

call io->eval(default_block())

## STDOUT:
global expr!
global block!
## END

