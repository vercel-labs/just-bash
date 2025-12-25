## our_shell: ysh
## oils_failures_allowed: 3

#### !== operator
var a = 'bar'

if (a !== 'foo') {
  echo 'not equal'
}

if (a !== 'bar') {
  echo 'should not get here'
}

# NOTE: a !== foo is idiomatic)
if ("$a" !== 'bar') {
  echo 'should not get here'
}

## STDOUT:
not equal
## END


#### elif bug
if (true) {
  echo A
} elif (true) {
  echo B
} elif (true) {
  echo C
} else {
  echo else
}
## STDOUT:
A
## END

#### global vars
builtin set -u

main() {
  source $[ENV.REPO_ROOT]/spec/testdata/global-lib.sh
}

main
test_func

## status: 1
## STDOUT:
## END

#### Julia port

$[ENV.SH] $[ENV.REPO_ROOT]/spec/testdata/ysh-user-feedback.sh

## STDOUT:
git
branch
-D
foo
baz
___
foo
baz
## END

#### readonly in loop: explains why const doesn't work
shopt --unset no_osh_builtins

# TODO: Might want to change const in YSH
# bash actually prevents assignment and prints a warning, DOH.

seq 3 | while read -r line; do
  readonly stripped=${line//1/x}
  #declare stripped=${line//1/x}
  echo $stripped
done
## status: 1
## STDOUT:
x
## END


#### Eggex bug in a loop

# https://oilshell.zulipchat.com/#narrow/stream/121540-oil-discuss/topic/A.20list.20of.20feedback
for i in @(seq 2) {
  # BUG: This crashes here, but NOT when extracted!  Bad.
  var pat = / 'test' word+ /
  if ("test$i" ~ pat) {
    echo yes
  }
}
## STDOUT:
yes
yes
## END


#### Append object onto Array
var e = []

# %() is also acceptable, but we prefer Python-like [] for objects.
# %() is more for an array of strings
# var e = %()

for i in @(seq 2) {
  var o = {}
  setvar o[i] = "Test $i"

  # push builtin is only for strings

  call e->append(o)
}

json write (e)

## STDOUT:
[
  {
    "1": "Test 1"
  },
  {
    "2": "Test 2"
  }
]
## END

#### Invalid op on string
shopt -s ysh:all

var clients = {'email': 'foo', 'e2': 'bar'}
for c in (clients) {
  echo $c
  # A user tickled this.  I think this should make the whole 'const' line fail
  # with code 1 or 2?
  const e = c.email
}
## status: 3
## STDOUT:
email
## END


#### var in both branches of if (Julian)

# remove static check?

proc scopetest(; var) {
  if (var === 2) {
    var tmp = "hello"
    write $tmp
  } else {
    var tmp = "world"
    write $tmp
  }
}

scopetest (1)
scopetest (2)

## STDOUT:
## END

#### var in branches of case (Aidan)
shopt -s ysh:all

# at top level, there is no static check
case (1) {
  (1) { var name = "one" }
  (2) { var name = "two" }
}
echo name=$name

proc my-proc {
  case (1) {
    (1) { var name = "one" }
    (2) { var name = "two" }
  }
}

## STDOUT:
## END

#### Modify for loop variable with var or setvar? (Machine Stops)

proc do-var {
  for x in a b {
    echo $x
    var x = 'zz'
    echo $x
  }
}

proc do-setvar {
  for x in a b {
    echo $x
    setvar x = 'zz'
    echo $x
  }
}

do-var
echo
do-setvar

## STDOUT:
a
zz
b
zz
## END
