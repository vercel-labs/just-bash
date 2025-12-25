## our_shell: ysh
## oils_failures_allowed: 0

#### captureStdout() is like $()

proc p {
  var captured = 'captured'
  var cmd = ^(echo one; echo $captured)
  
  var stdout = io.captureStdout(cmd)
  pp test_ (stdout)
}

p

## STDOUT:
(Str)   "one\ncaptured"
## END

#### captureStdout() failure

var c = ^(echo one; false; echo two)

# Hm this prints a message, but no stack trace
# Should make it fail I think

try {
  var x = io.captureStdout(c)
}
# This has {"code": 3} because it's an expression error.  Should probably
pp test_ (_error)

var x = io.captureStdout(c)

## status: 4
## STDOUT:
(Dict)   {"status":1,"code":4,"message":"captureStdout(): command failed with status 1"}
## END

#### io->eval() is like eval builtin

var c = ^(echo one; echo two)
var status = io->eval(c)

# doesn't return anything
echo status=$status

## STDOUT:
one
two
status=null
## END

#### captureAll() is like $() but captures stderr and status

proc p {
  var captured = 'captured'
  var cmd = ^(
    echo stdout
    echo stderr >&2
    echo $captured
    echo $captured >&2
    printf '\000'
    exit 42
  )

  var result = io.captureAll(cmd)
  pp test_ (result)
}

p

## STDOUT:
(Dict)   {"stdout":"stdout\ncaptured\n\u0000","stderr":"stderr\ncaptured\n","status":42}
## END

#### captureAll() doesn't fail

var c = ^(shopt --unset verbose_errexit; echo out; echo err >&2; false; echo two)

# Hm this prints a message, but no stack trace
# Should make it fail I think

try {
  var x = io.captureAll(c)
}
# This has {"code": 3} because it's an expression error.  Should probably
pp test_ (_error)
pp test_ (x)

## status: 0
## STDOUT:
(Dict)   {"code":0}
(Dict)   {"stdout":"out\n","stderr":"err\n","status":1}
## END

#### io->eval() with failing command - caller must handle

var c = ^(echo one; false; echo two)

try {
  call io->eval(c)
}
pp test_ (_error)

call io->eval(c)

## status: 1
## STDOUT:
one
(Dict)   {"code":1}
one
## END

#### io->eval() with exit

var c = ^(echo one; exit; echo two)

try {
  call io->eval(c)
}
echo 'we do not get here'
pp test_ (_error)


## STDOUT:
one
## END

#### io.glob() respects shell filters
touch -- .gitignore -foo.txt foo.txt foo.md

#GLOBIGNORE='*.md'

pp test_ (io.glob('*'))

shopt -s dotglob
shopt --unset no_dash_glob
pp test_ (io.glob('*'))

# This meandes dotglob, no_dash_glob
GLOBIGNORE='*.md'
pp test_ (io.glob('*'))

## STDOUT:
(List)   ["foo.md","foo.txt"]
(List)   ["-foo.txt",".gitignore","foo.md","foo.txt"]
(List)   ["-foo.txt",".gitignore","foo.txt"]
## END


#### io.libcGlob() does not respect shell filters
touch -- .gitignore -foo.txt foo.txt

pp test_ (io.libcGlob('*'))

# NO effect
shopt -s dotglob
shopt --unset no_dash_glob
pp test_ (io.libcGlob('*'))

GLOBIGNORE='*.md'
pp test_ (io.libcGlob('*'))

## STDOUT:
(List)   ["-foo.txt","foo.txt"]
(List)   ["-foo.txt","foo.txt"]
(List)   ["-foo.txt","foo.txt"]
## END


