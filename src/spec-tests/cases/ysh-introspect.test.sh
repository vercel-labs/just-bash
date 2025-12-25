## oils_failures_allowed: 1
## our_shell: ysh

#### getFrame()

var fr = vm.getFrame(0)
pp test_ (fr)
var d = dict(fr)
pp test_ (d.ARGV)
echo

proc p1 {
  var p1_var = 'x'
  p2
}

proc p2 {
  echo 'p2 frame -1'
  var fr = vm.getFrame(-1)
  var d = dict(fr)

  pp test_ (fr)
  pp test_ (d)
  pp test_ (keys(d))
  echo

  echo 'p2 frame -2'
  setvar fr = vm.getFrame(-2)
  setvar d = dict(fr)

  pp test_ (fr)
  pp test_ (keys(d))
  echo
}

p1

var fr = vm.getFrame(99)  # fails

## status: 3
## STDOUT:
<Frame>
(List)   []

p2 frame -1
<Frame>
(Dict)   {"__E__":<Frame>,"ARGV":[],"fr":<Frame>}
(List)   ["__E__","ARGV","fr"]

p2 frame -2
<Frame>
(List)   ["__E__","ARGV","p1_var"]

## END


#### bindFrame()

var frag = ^(echo $i)

# TODO: should be fragment
pp test_ (frag)

var cmd = bindFrame(frag, vm.getFrame(0))

pp test_ (cmd)

## STDOUT:
## END

#### vm.getDebugStack()

proc p {
  echo $[len(vm.getDebugStack())]
}

proc p2 {
  p
}

p
p2

## STDOUT:
1
2
## END

#### DebugFrame.toString() running file

$[ENV.SH] $[ENV.REPO_ROOT]/spec/testdata/debug-frame-main.ysh |
  sed -e "s;$[ENV.REPO_ROOT];MYROOT;g" -e 's;#;%;g'

## STDOUT:
  %1 MYROOT/spec/testdata/debug-frame-main.ysh:4
    print-stack
    ^~~~~~~~~~~

  %1 MYROOT/spec/testdata/debug-frame-main.ysh:7
    my-proc
    ^~~~~~~
  %2 MYROOT/spec/testdata/debug-frame-lib.ysh:15
      print-stack
      ^~~~~~~~~~~
## END


#### DebugFrame.toString() running stdin and -c

# stdin
echo 'source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh; my-proc' |
  $[ENV.SH] |
  sed -e "s;$[ENV.REPO_ROOT];MYROOT;g" -e 's;#;%;g'
echo

# -c
$[ENV.SH] -c 'source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh; my-proc' |
  sed -e "s;$[ENV.REPO_ROOT];MYROOT;g" -e 's;#;%;g'

## STDOUT:
  %1 [ stdin ]:1
    source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh; my-proc
                                                               ^~~~~~~
  %2 MYROOT/spec/testdata/debug-frame-lib.ysh:15
      print-stack
      ^~~~~~~~~~~

  %1 [ -c flag ]:1
    source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh; my-proc
                                                               ^~~~~~~
  %2 MYROOT/spec/testdata/debug-frame-lib.ysh:15
      print-stack
      ^~~~~~~~~~~
## END

#### DebugFrame.toString() running eval 

# -c and eval
$[ENV.SH] -c 'source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh; eval "my-proc a b"' |
  sed -e "s;$[ENV.REPO_ROOT];MYROOT;g" -e 's;#;%;g'
echo

# eval
$[ENV.SH] -c 'source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-eval.ysh' |
  sed -e "s;$[ENV.REPO_ROOT];MYROOT;g" -e 's;#;%;g'

## STDOUT:
  %1 [ -c flag ]:1
    source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh; eval "my-proc a b"
                                                                    ^
  %2 [ eval arg at line 1 of [ -c flag ] ]:1
    my-proc a b
    ^~~~~~~
  %3 MYROOT/spec/testdata/debug-frame-lib.ysh:15
      print-stack
      ^~~~~~~~~~~

  %1 [ -c flag ]:1
    source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-eval.ysh
    ^~~~~~
  %2 MYROOT/spec/testdata/debug-frame-eval.ysh:7
    p3
    ^~
  %3 MYROOT/spec/testdata/debug-frame-eval.ysh:4
      eval 'my-proc x y'
           ^
  %4 [ eval arg at line 4 of MYROOT/spec/testdata/debug-frame-eval.ysh ]:1
    my-proc x y
    ^~~~~~~
  %5 MYROOT/spec/testdata/debug-frame-lib.ysh:15
      print-stack
      ^~~~~~~~~~~
## END

#### DebugFrame.toString() running io->eval() on command
$[ENV.SH] -c '
source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh
var b = ^(my-proc a b)
proc p {
  call io->eval(b)
}
p
' | sed -e "s;$[ENV.REPO_ROOT];MYROOT;g" -e 's;#;%;g'

## STDOUT:
  %1 [ -c flag ]:7
    p
    ^
  %2 [ -c flag ]:5
      call io->eval(b)
                   ^
  %3 [ -c flag ]:3
    var b = ^(my-proc a b)
              ^~~~~~~
  %4 MYROOT/spec/testdata/debug-frame-lib.ysh:15
      print-stack
      ^~~~~~~~~~~
## END

#### DebugFrame.toString() running io->evalExpr()

$[ENV.SH] -c '
source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh

proc print-num {
  print-stack > stack-trace.txt
  echo 42
}

var e = ^[2 + $(print-num)]

proc p {
  call io->evalExpr(e)
}

p
' 

sed 's;#;%;g' stack-trace.txt

## STDOUT:
  %1 [ -c flag ]:15
    p
    ^
  %2 [ -c flag ]:12
      call io->evalExpr(e)
                       ^
  %3 [ -c flag ]:9
    var e = ^[2 + $(print-num)]
                    ^~~~~~~~~
  %4 [ -c flag ]:5
      print-stack > stack-trace.txt
      ^~~~~~~~~~~
## END

#### DebugFrame.toString() running YSH functions

# functions
$[ENV.SH] -c 'source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh; call-func' |
  sed -e "s;$[ENV.REPO_ROOT];MYROOT;g" -e 's;#;%;g'

## STDOUT:
  %1 [ -c flag ]:1
    source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh; call-func
                                                               ^~~~~~~~~
  %2 MYROOT/spec/testdata/debug-frame-lib.ysh:32
      var x = myfunc(99)
                    ^
  %3 MYROOT/spec/testdata/debug-frame-lib.ysh:28
      return (identity(myfunc2(42, x+1)))
                      ^
  %4 MYROOT/spec/testdata/debug-frame-lib.ysh:23
      print-stack
      ^~~~~~~~~~~
142
## END

#### DebugFrame.toString() with 'use' builtin

# Work around spec test builtin limitation: line starting with # is treated as
# a comment

#echo $[ENV.REPO_ROOT]

$[ENV.SH] -c 'use $[ENV.REPO_ROOT]/spec/testdata/debug-frame-use.ysh' | 
  sed -e "s;$[ENV.REPO_ROOT];MYROOT;g" -e 's;#;%;g'

#write -- $[ENV.REPO_ROOT] | sed "s;$[ENV.REPO_ROOT];REPO_ROOT;g"

## STDOUT:
  %1 [ -c flag ]:1
    use $[ENV.REPO_ROOT]/spec/testdata/debug-frame-use.ysh
    ^~~
  %2 MYROOT/spec/testdata/debug-frame-use.ysh:5
    debug-frame-lib my-proc
                    ^~~~~~~
  %3 MYROOT/spec/testdata/debug-frame-lib.ysh:15
      print-stack
      ^~~~~~~~~~~
## END

#### FUNCNAME BASH_LINENO BASH_SOURCE not available with YSH functions

func g(x) {
  echo ${FUNCNAME[@]}
  echo ${BASH_LINENO[@]}
  echo ${BASH_SOURCE[@]}
}

func f(x) {
  return (g(x))
}

# We can allow it in procs -- there's no cost to doing so? 

proc p {
  call f(42)
}

p

## STDOUT:
p
16
[ stdin ]
## END

#### trap ERR - external failure

source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh

trap --add ERR {
  print-stack (prefix=false)
}
set -o errtrace  # enable always

proc f {
  g
}

proc g {
  false
}

f

## status: 1
## STDOUT:
[ stdin ]:16
    f
    ^
[ stdin ]:9
      g
      ^
## END

#### trap ERR - proc subshell failure

source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh

trap --add ERR {
  print-stack (prefix=false)
}
set -o errtrace  # enable always

proc f {
  g
}

proc g {
  forkwait { exit 42 }
  #return 42
}

f

## status: 42
## STDOUT:
[ stdin ]:16
    f
    ^
[ stdin ]:9
      g
      ^
## END

#### trap ERR - proc non-zero return status

source $[ENV.REPO_ROOT]/spec/testdata/debug-frame-lib.ysh

trap --add ERR {
  print-stack (prefix=false)
}
set -o errtrace  # enable always

proc f {
  g
}

proc g {
  return 42
}

f

## status: 42

# Hm we do not get the "g" call here?  Because we get an exception raised

## STDOUT:
[ stdin ]:16
    f
    ^
## END
