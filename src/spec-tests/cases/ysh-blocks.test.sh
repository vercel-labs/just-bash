## oils_failures_allowed: 1

#### cd accepts a block, runs it in different dir
shopt -s ysh:all

const saved = "$PWD"

# OLDPWD is NOT defined
cd / { echo $PWD; echo OLDPWD=${OLDPWD:-} }; echo done

if ! test "$saved" = $PWD; then
  echo FAIL
fi

cd /tmp {
  write PWD=$PWD
  write --sep ' ' pwd builtin: $(pwd)
}

if ! test "$saved" = $PWD; then
  echo FAIL
fi

## STDOUT:
/
OLDPWD=
done
PWD=/tmp
pwd builtin: /tmp
## END

#### cd with block: requires explicit command
shopt --set ysh:upgrade

cd /tmp { echo $PWD }

HOME=~
cd { echo $PWD }

## status: 2
## STDOUT:
/tmp
## END

#### cd passed block with return 1
shopt -s ysh:all

f() {
  cd / {
    echo block
    return 1
    echo 'not reached'
  }
}
f
echo 'not reached'

## status: 1
## STDOUT:
block
## END

#### cd passed a block defined in a different scope
shopt --set ysh:upgrade

proc my-cd (; b) {
  cd /tmp ( ; ; b)
}

proc p {
  var i = 42
  var b = ^(echo "i = $i")

  my-cd (b)
}

p

## STDOUT:
## END

#### io->eval() and io.captureStdout()/io.captureAll() passed a block in different scope
shopt --set ysh:upgrade

proc my-cd (; b) {
  call io->eval(b)

  var d = io->evalToDict(b)

  pp test_ (d)

  # Yup, this is a problem
  var s = io.captureStdout(b)
  echo "stdout $s"

  setvar s = io.captureAll(b)
  echo "stdout $[s.stdout]" # Adds a newline
}

proc p {
  var i = 42
  var b = ^(var x = 'x'; echo "i = $i")

  my-cd (b)
}

p

## STDOUT:
i = 42
i = 42
(Dict)   {"x":"x"}
stdout i = 42
stdout i = 42

## END

#### block doesn't have its own scope
shopt -s ysh:all
var x = 1
echo "x=$x"
cd / {
  #set y = 5  # This would be an error because set doesn't do dynamic lookup
  var x = 42
  echo "x=$x"
}
echo "x=$x"
## STDOUT:
x=1
x=42
x=42
## END

#### redirects allowed in words, typed args, and after block
shopt -s ysh:upgrade

rm -f out
touch out

cd /tmp >>out {
  echo 1 $PWD
}

cd /tmp >>out (; ; ^(echo 2 $PWD))

cd /tmp (; ; ^(echo 3 $PWD)) >>out

cd /tmp {
  echo 4 $PWD
} >> out

cat out

## STDOUT:
1 /tmp
2 /tmp
3 /tmp
4 /tmp
## END

#### block literal in expression mode: ^(echo $PWD)
shopt -s ysh:all

const myblock = ^(echo $PWD | wc -l)
call io->eval(myblock)

const b2 = ^(echo one; echo two)
call io->eval(b2)

## STDOUT:
1
one
two
## END

#### block arg as typed expression

shopt -s oil:all

# literal
cd /tmp (; ; ^(echo $PWD))

const myblock = ^(echo $PWD)
cd /tmp (; ; myblock)

## STDOUT:
/tmp
/tmp
## END

#### Pass invalid typed args

cd /tmp (42)  # should be a block
## status: 3

#### Pass too many typed args

cd /tmp (1, 2)
## status: 3

#### 'builtin' and 'command' with block
shopt --set oil:upgrade
builtin cd / {
  echo "builtin $PWD"
}
command cd / {
  echo "command $PWD"
}
## STDOUT:
builtin /
command /
## END

#### Consistency: Exit Status and Blocks
shopt --set parse_brace

cd / {
  false 
}
echo cd=$?

shopt --unset errexit {
  false
}
echo shopt=$?

shvar FOO=foo {
  echo "  FOO=$FOO"
  false
}
echo shvar=$?

try {
  false
}
echo try=$?

## STDOUT:
cd=0
shopt=0
  FOO=foo
shvar=0
try=0
## END

#### Consistency: Unwanted Blocks Are Errors
shopt --set parse_brace

true { echo BAD }
echo true $?

false ( 42, 43 )
echo false $?

echo { echo BAD }
echo echo block $?

echo ( 42, 43 )
echo echo args $?

command echo 'command block' { echo BAD }
echo command echo $?

builtin echo 'builtin block' { echo BAD }
echo builtin echo $?

pushd $TMP { echo BAD }
echo pushd $?

## STDOUT:
true 2
false 2
echo block 2
echo args 2
command echo 2
builtin echo 2
pushd 2
## END

#### Block with Bare Assignments

# oil:all has parse_equals
# is there any way to turn on parse_equals only in config blocks?
# but we don't know what's a block ahead of time
# I think we would have to check at runtime.  Look at VarChecker

shopt --set oil:all

proc Rule(s ; ; ; b) {
  echo "rule $s"
}

proc myrules(name) { 
  Rule $name-python { 
    kind = 'python'
  }

  Rule $name-cc {
    kind = 'cc'  # should NOT conflict
  }
}

myrules foo
myrules bar

## STDOUT:
rule foo-python
rule foo-cc
rule bar-python
rule bar-cc
## END

#### Proc that doesn't take a block
shopt --set parse_brace parse_proc parse_paren

proc task(name ; ; ; b = null) {
  echo "task name=$name"
  if (b) {
    call io->eval(b)
    return 33
  } else {
    echo 'no block'
    return 44
  }
}

task spam
echo status=$?

echo

task foo {
  echo 'running'
  echo 'block'
}
echo status=$?

## STDOUT:
task name=spam
no block
status=44

task name=foo
running
block
status=33
## END

