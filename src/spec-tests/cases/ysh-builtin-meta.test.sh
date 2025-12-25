## oils_failures_allowed: 1

#### Type objects Bool, Int, Float, etc.

pp test_ (Bool)
pp test_ (Int)
pp test_ (Float)
pp test_ (Str)

pp test_ (List)
pp test_ (Dict)
pp test_ (Obj)
echo

var b = Bool

pp test_ (b is Bool)

# Objects don't have equality, only identity
#pp test_ (b === Bool)

pp test_ (vm.id(b) === vm.id(Bool))

## STDOUT:
(Obj)   ("name":"Bool") --> ("__index__":<BuiltinFunc>)
(Obj)   ("name":"Int") --> ("__index__":<BuiltinFunc>)
(Obj)   ("name":"Float") --> ("__index__":<BuiltinFunc>)
(Obj)   ("name":"Str") --> ("__index__":<BuiltinFunc>)
(Obj)   ("name":"List") --> ("__index__":<BuiltinFunc>)
(Obj)   ("name":"Dict") --> ("__index__":<BuiltinFunc>)
(Obj)   ("name":"Obj","new":<BuiltinFunc>) --> ("__index__":<BuiltinFunc>)

(Bool)   true
(Bool)   true
## END

#### Parameterized types - List[Int], Dict[Str, Int]
shopt -s ysh:upgrade

var li = List[Int]
var dsi = Dict[Str, Int]

pp test_ (li)
pp test_ (dsi)

# test identity
for i in a b c {
  assert [li is List[Int]]
  assert [dsi is Dict[Str,Int]]
}

assert [li is not dsi]

var lli = List[li]
pp test_ (lli)

pp test_ (Dict[Str, List[Int]])

## STDOUT:
(Obj)   ("unique_id":"List[Int]")
(Obj)   ("unique_id":"Dict[Str,Int]")
(Obj)   ("unique_id":"List[List[Int]]")
(Obj)   ("unique_id":"Dict[Str,List[Int]]")
## END

#### Errors for parameterized types
shopt -s ysh:upgrade

# more in test/ysh-runtime-errors.sh test-obj-methods
try {
  pp test_ (Bool[Str])
}
echo $[_error.code]

# I think this means
# TODO: need very low precedence operation
#
# Func[Int, Str : Int]
# Func[Int, Str -> Int]
# Func[Int, Str --> Int]

## STDOUT:
3
## END

#### runproc
shopt --set parse_proc parse_at

f() {
  write -- f "$@"
}
proc p {
  write -- p @ARGV
}
runproc f 1 2
echo status=$?

runproc p 3 4
echo status=$?

runproc invalid 5 6
echo status=$?

runproc
echo status=$?

## STDOUT:
f
1
2
status=0
p
3
4
status=0
status=1
status=2
## END


#### runproc typed args
shopt --set parse_brace parse_proc parse_ysh_expr_sub

proc p {
  echo 'hi from p'
}

# The block is ignored for now
runproc p { 
  echo myblock 
}
echo

proc ty (w; t; n; block) {
  echo 'ty'
  pp test_ (w)
  pp test_ (t)
  pp test_ (n)
  echo $[type(block)]
}

ty a (42; n=99; ^(echo ty))
echo

runproc ty a (42; n=99; ^(echo ty))
echo

runproc ty a (42; n=99) {
  echo 'ty gets literal'
}

# TODO: Command vs. Block vs. Literal Block should be unified

## STDOUT:
hi from p

ty
(Str)   "a"
(Int)   42
(Int)   99
Command

ty
(Str)   "a"
(Int)   42
(Int)   99
Command

ty
(Str)   "a"
(Int)   42
(Int)   99
Command
## END


#### pp asdl_

x=42
setvar y = {foo: x}

pp asdl_ (x)
pp asdl_ (y)

pp asdl_ (io.stdin)

## STDOUT:
(value.Str s:42)
(value.Dict d:{foo (value.Str s:42)})
(value.Stdin)
## END

#### pp asdl_ can handle an object cycle

shopt -s ysh:upgrade

var d = {}
setvar d.cycle = d

pp test_ (d) | fgrep -o '{"cycle":'

pp asdl_ (d) | fgrep -o 'cycle ...'

## STDOUT:
{"cycle":
cycle ...
## END


#### pp gc-stats_

pp gc-stats_

## STDOUT:
## END


#### pp cell_
x=42

pp cell_ x
echo status=$?

pp -- cell_ x
echo status=$?

pp cell_ nonexistent
echo status=$?
## STDOUT:
x = (Cell exported:F readonly:F nameref:F val:(value.Str s:42))
status=0
x = (Cell exported:F readonly:F nameref:F val:(value.Str s:42))
status=0
status=1
## END

#### pp cell_ on indexed array with hole
declare -a array
array[3]=42
array[5]=99
pp cell_ array

## STDOUT:
array = (Cell
  exported:F
  readonly:F
  nameref:F
  val:(value.BashArray d:{3 42 5 99} max_index:5)
)
## END


#### pp proc
shopt --set ysh:upgrade

# This has to be a separate file because sh_spec.py strips comments!
. $REPO_ROOT/spec/testdata/doc-comments.sh

pp proc
echo ---

# print one
pp proc f

## STDOUT:
proc_name	doc_comment
f	"doc ' comment with \" quotes"
g	""
myproc	"YSH-style proc"
proc-none	""
shfunc-none	""
"true"	"Special quoting rule"
---
proc_name	doc_comment
f	"doc ' comment with \" quotes"
## END

#### pp (x) and pp [x] quote code

pp (42)

shopt --set ysh:upgrade

pp [42] | sed 's/0x[a-f0-9]\+/[replaced]/'

## STDOUT:

  pp (42)
     ^
[ stdin ]:1: (Int)   42

  pp [42] | sed 's/0x[a-f0-9]\+/[replaced]/'
     ^
[ stdin ]:5: <Expr [replaced]>
## END

#### pp test_ supports BashArray, BashAssoc

declare -a array=(a b c)
pp test_ (array)

array[5]=z
pp test_ (array)

declare -A assoc=([k]=v [k2]=v2)
pp test_ (assoc)

# I think assoc arrays can never null / unset

assoc['k3']=
pp test_ (assoc)

## STDOUT:
{"type":"BashArray","data":{"0":"a","1":"b","2":"c"}}
{"type":"BashArray","data":{"0":"a","1":"b","2":"c","5":"z"}}
{"type":"BashAssoc","data":{"k":"v","k2":"v2"}}
{"type":"BashAssoc","data":{"k":"v","k2":"v2","k3":""}}
## END

#### pp value (x) is like = keyword

shopt --set ysh:upgrade
source $LIB_YSH/list.ysh

# It can be piped!

pp value ('foo') | cat

pp value ("isn't this sq") | cat

pp value ('"dq $myvar"') | cat

pp value (r'\ backslash \\') | cat

pp value (u'one \t two \n') | cat

# Without a terminal, default width is 80
pp value (repeat([123], 40)) | cat

## STDOUT:
(Str)   'foo'
(Str)   b'isn\'t this sq'
(Str)   '"dq $myvar"'
(Str)   b'\\ backslash \\\\'
(Str)   b'one \t two \n'
(List)
[
    123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123,
    123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123, 123,
    123, 123, 123, 123, 123, 123, 123, 123, 123, 123
]
## END

