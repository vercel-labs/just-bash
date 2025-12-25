## our_shell: ysh
## oils_failures_allowed: 6

#### fastlex: NUL byte inside shebang line

# Hm this test doesn't really tickle the bug

echo b'#! /usr/bin/env \y00 sh \necho hi' > tmp.ysh
env OILS_HIJACK_SHEBANG=1 $[ENV.SH] tmp.ysh

## STDOUT:
hi
## END

#### Tea keywords don't interfere with YSH expressions

var d = {data: 'foo'}

echo $[d.data]

var e = {enum: 1, class: 2, import: 3, const: 4, var: 5, set: 6}
echo $[len(e)]

## STDOUT:
foo
6
## END

#### Catch AttributeError

var s = 'foo'
echo s=$s
var t = s.bad()
echo 'should not get here'

## status: 3
## STDOUT:
s=foo
## END


#### Command sub paren parsing bug (#1387)

write $(if (true) { write true })

const a = $(write $[len('foo')])
echo $a

const b = $(write $[5 ** 3])
echo $b

const c = $(
  write $[6 + 7]
)
echo $c

## STDOUT:
true
3
125
13
## END


#### More Command sub paren parsing

write $( var mylist = ['for']; for x in (mylist) { echo $x } )

write $( echo while; while (false) { write hi } )

write $( if (true) { write 'if' } )

write $( if (false) { write 'if' } elif (true) { write 'elif' } )

## STDOUT:
for
while
if
elif
## END

#### don't execute empty command

shopt --set ysh:all

set -x

try {
  type -a ''
}
echo "type -a returned $[_error.code]"

$(true)
echo nope

## status: 127
## STDOUT:
type -a returned 1
## END


#### Do && || with YSH constructs make sense/

# I guess there's nothing wrong with this?
#
# But I generally feel && || are only for
#
# test --file x && test --file y

var x = []
true && call x->append(42)
false && call x->append(43)
pp test_ (x)

func amp() {
  true && return (42)
}

func pipe() {
  false || return (42)
}

pp test_ (amp())
pp test_ (pipe())

## STDOUT:
## END


#### shvar then replace - bug #1986 context manager crash

shvar FOO=bar {
  for x in (1 ..< 500) {
    var Q = "hello"
    setvar Q = Q=>replace("hello","world")
  }
}
#echo $Q
echo hi

## STDOUT:
hi
## END


#### Parsing crash - bug #2003

set +o errexit

$[ENV.SH] -c 'proc y (;x) { return = x }'
echo status=$?

$[ENV.SH] -c 'func y (;x) { return = x }'
echo status=$?

## STDOUT:
status=2
status=2
## END


#### proc with IFS= read -r line - dynamic scope - issue #2012

# 2024-10 - FIXED by the new Env Obj!  Because in YSH, 'line' is NOT created in
# TEMP stack frame - we use the ENCLOSED frame, and it fixes it.

proc p {
	read -r line
  write $line
}

proc p-ifs {
	IFS= read -r line
  write $line
}

#set -x

echo zz | p

echo yy | p-ifs

## STDOUT:
zz
yy
## END

#### func call inside proc call - error message attribution

try 2> foo {
  $[ENV.SH] -c '
func ident(x) {
  return (x)
}

proc p (; x) {
  echo $x
}

# BUG: it points to ( in ident(
#      should point to ( in eval (

eval (ident([1,2,3]))
'
}

cat foo

## STDOUT:
## END


#### Crash in parsing case on EOF condition - issue #2037

var WEIGHT = ${1:-}
case (WEIGHT) {
  "-" { echo "got nothing" }
  (else) { echo $WEIGHT
}

## status: 2
## STDOUT:
## END

#### Crash due to incorrect of context manager rooting - issue #1986

proc p {
  var s = "hi"
  for q in (1..<50) {
    shvar Q="whatever" {
      setvar s = "." ++ s
    }
  }
}

for i in (1..<10) {
  p
}

if false {
  echo 'testing for longer'
  for i in (1 ..< 1000) {
    p
  }
}

## STDOUT:
## END


#### crash due to arbitrary PNode limit - issue #2078

#!/usr/bin/env ysh
var DelegatedCompName = {
  "llvm"                 : "x_project",
  "rocprofiler_register" : "x_rocprofiler_register",
  "roct_thunk_interface" : "x_roct",
  "rocr_runtime"         : "x_rocr",
  "openmp"               : "x_openmp",
  "offload"              : "x_offload",
  "aomp_extras"          : "x_extras",
  "comgr"                : "x_comgr",
  "rocminfo"             : "x_rocminfo",
  "rocsmilib"            : "x_rocm_smi_lib",
  "amdsmi"               : "x_amdsmi",
  "flang_legacy"         : "x_flang_legacy",
  "pgmath"               : "x_pgmath",
  "flang"                : "x_flang",
  "flang_runtime"        : "x_flang_runtime",
  "hipcc"                : "x_hipcc",
  "hipamd"               : "x_hipamd",
  "rocm_dbgapi"          : "x_rocdbgapi",
  "rocgdb"               : "x_rocgdb",
  "roctracer"            : "x_roctracer",
  "rocprofiler"          : "x_rocprofiler"
}

echo $[len(DelegatedCompName)]

## STDOUT:
21
## END

#### bad assertion when pretty printing

pp value (__builtins__) > /dev/null
echo status=$?

## STDOUT:
status=0
## END

#### Another "stealing stdin" issue with spec tests

proc where2(; pred) {
  for line in (io.stdin) {
    pp test_ (line)
  }
}

seq 5 | where2 [_line ~== 2 or _line ~== 4]

#{ echo 1; echo 2; } | where2 [_line ~== 2 or _line ~== 4]

# empty lines here get put on stdin

## STDOUT:
(Str)   "1"
(Str)   "2"
(Str)   "3"
(Str)   "4"
(Str)   "5"
## END

#### Nested io.stdin

proc bug {
  echo '''
    proc inner {
      printf 'a\nb\n' | for x in (io.stdin) {
	echo x=$x
      }
    }

    printf 'x\ny\n' | for _ in (io.stdin) {
      inner
    }
    '''
}

# Changes with invocation style

$[ENV.SH] <(bug)
echo ---
$[ENV.SH] -c $(bug)
echo ---
bug | $[ENV.SH]

## STDOUT:
x=a
x=b
x=a
x=b
---
x=a
x=b
x=a
x=b
---
x=a
x=b
x=a
x=b
## END

#### Iterating over io.stdin multiple times (#2356)

echo u'a\nb' | for i, line in (io.stdin) { echo $i: $line; break }
echo u'c\nd' | for i, line in (io.stdin) { echo $i: $line }

## STDOUT:
0: a
0: c
1: d
## END

#### Long boolean flags can't have attached values

# This currently works, but I think --json and --j8 are enough?

write --json=0 hi
write --json=F hi
write --json=False hi
write --json=false hi
echo

write --json=1 hi
write --json=T hi
write --json=True hi
write --json=true hi

# typo bug
write --json=Talse hi

## status: 1
## STDOUT:
## END

#### Bug: rooting of pgen2::PNode

# manifests with _bin/cxx-asan+gcalways/ysh, after turning on VALIDATE_ROOTS

var x = 42
echo $x

#var y = 'foo-' ++ $(var y = 42; echo $y)

## STDOUT:
42
## END
