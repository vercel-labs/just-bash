# spec/ysh-case

## our_shell: ysh
## oils_failures_allowed: 0

#### case syntax, one line
const x = "header.h"
case (x) {
  *.h | *.cc { echo C++ }
  *.py       { echo Python }
}

# not recommended, but it works
case (x) { header.h { echo header.h } * { echo other } }

## status: 0
## STDOUT:
C++
header.h
## END

#### case syntax, multiline
const x = "hello.py"
case (x) {
  *.h | *.cc {
    echo C++
    echo 2; echo 3
  }
  *.py {
    echo \
      Python
  }
}
## status: 0
## STDOUT:
Python
## END

#### case syntax, simple expressions
const x = 3
case (x) {
  (3) { echo three }
  (4) { echo four }
}
## status: 0
## STDOUT:
three
## END

#### case syntax, complex expressions
const x = 3
case (x) {
  (1 + 2) { echo three }
  (2 + 2) { echo four }
}
## STDOUT:
three
## END

#### case semantics, no match
const x = 2
case (x) {
  (3) { echo three }
  (4) { echo four }
}
## status: 0
## STDOUT:
## END

#### eggex as case arm
const x = "main.cc"
case (x) {
  / dot* '.py' / {
    echo Python
  }
  / dot* ('.cc' | '.h') / {
   echo C++
  }
}
## STDOUT:
C++
## END

#### eggex respects flags
const x = 'MAIN.PY'
case (x) {
  / dot* '.py' ; i / {
    echo Python
  }
  / dot* ('.cc' | '.h') / {
   echo C++
  }
}
## STDOUT:
Python
## END

#### empty case statement
const x = ""
case (x) { }
## status: 0
## STDOUT:
## END

#### typed args
const x = "0"
case (x) {
  (0) { echo int }
  ("0") { echo string }
}

## status: 0
## STDOUT:
string
## END

#### eggex capture
for name in foo/foo.py bar/bar.cc zz {
  case (name) {
    / '/f' <capture dot*> '.' / { echo "g0=$[_group(0)] g1=$[_group(1)]" }
    / '/b' <capture dot*> '.' / { echo "g0=$[_group(1)] g1=$[_group(1)]" }
    (else) { echo 'no match' }
  }
}
## status: 0
## STDOUT:
g0=/foo. g1=oo
g0=ar g1=ar
no match
## END

#### else case pattern
var x = 123
case (x) {
  (else) { echo else matches all }
  (123) { echo unreachable }
}
## status: 0
## STDOUT:
else matches all
## END

#### expression evaluation shortcuts
var x = 123
case (x) {
  (x) | (y) { echo no error }
}
## status: 0
## STDOUT:
no error
## END

#### expression evaluation order
var x = 123
case (x) {
  (y) | (x) { echo no error }
}
## status: 1
## STDOUT:
## END

#### word evaluation shortcuts
var x = "abc"
case (x) {
  $x | $y { echo no error }
}
## status: 0
## STDOUT:
no error
## END

#### word evaluation order
var x = "abc"
case (x) {
  $y | $x { echo no error }
}
## status: 1
## STDOUT:
## END

#### only one branch is evaluated
var x = "42"
case (x) {
  ('42') { echo a }
  42 { echo b }
  / '42' / { echo c }
  (Str(40 + 2)) { echo d }

  # even errors are ignored
  (42 / 0) { echo no error }
}
## status: 0
## STDOUT:
a
## END

#### stop on errors
var x = "42"
case (x) {
  (42 / 0) { echo no error }

  ('42') { echo a }
  42 { echo b }
  / '42' / { echo c }
  (Str(40 + 2)) { echo d }
}
## status: 3
## STDOUT:
## END

#### old and new case statements

for flag in -f -x {

  # We can disallow this with shopt --unset parse_old_case, because the new
  # case statement does everything the old one does
  #
  # bin/osh and shopt --set ysh:upgrade let you use both styles, but bin/ysh
  # only lets you use the new style

  case $flag in
    -f|-d)
      echo 'file'
      ;;
    *)
      echo 'other'
      ;;
  esac

  case (flag) {
    -f|-d { echo 'file' }
    *     { echo 'other' }
  }

  echo --
}

## STDOUT:
file
file
--
other
other
--
## END
