# spec/ysh-builtin-error

## our_shell: ysh

#### User errors behave like builtin errors
func divide(a, b) {
  if (b === 0) {
    error 'divide by zero' (code=3)
  }

  return (a / b)
}

# errors can be caught with try
try { = divide(42, 0) }
echo status=$[_error.code]

= divide(42, 0)

## status: 3
## STDOUT:
status=3
## END

#### _error register is initially empty dict

echo $[type(_error)]
echo $[len(_error)]

## STDOUT:
Dict
0
## END

#### error builtin sets _error.message, which can be used by programs

func divide(a, b) {
  if (b === 0) {
    error "divide by zero: $a / $b" (code=3)
  }
  return (a / b)
}

try { = divide(42, 0) }
echo status=$[_error.code]
echo message=$[_error.message]

proc p {
  echo $[divide(5, 0)]
}

try { p }
echo status=$[_error.code]
echo message=$[_error.message]

## STDOUT:
status=3
message=divide by zero: 42 / 0
status=3
message=divide by zero: 5 / 0
## END

#### error builtin adds named args as properties on _error Dict

try {
  error 'bad' (code=99)
}
pp test_ (_error)

# Note: myData co
try {
  error 'bad' (code=99, myData={spam:'eggs'})
}
pp test_ (_error)

try {
  error 'bad' (code=99, message='cannot override')
}
pp test_ (_error)

## STDOUT:
(Dict)   {"code":99,"message":"bad"}
(Dict)   {"myData":{"spam":"eggs"},"code":99,"message":"bad"}
(Dict)   {"message":"bad","code":99}
## END

#### Errors within multiple functions
func inverse(x) {
  if (x === 0) {
    error '0 does not have an inverse'  # default status is 1
  }

  return (1 / x)
}

func invertList(list) {
  var result = []
  for item in (list) {
    call result->append(inverse(item))
  }
  return (result)
}

= invertList([1, 2, 0])
## status: 10
## STDOUT:
## END

#### Impact of errors on var declaration
func alwaysError() {
  error "it's an error" (status=100)
}

try {
  var mylist = [1 + 2, alwaysError()]

  echo this will never be printed
}
= mylist  # undefined! status becomes 1
## status: 1
## STDOUT:
## END

#### default error code is 10
error 'some error'
## status: 10
## STDOUT:
## END

#### error code should be an integer
error 'error' (code='a string?')
## status: 3
## STDOUT:
## END

#### Error code should be named arg, not positional
error msg (100)
## status: 3
## STDOUT:
## END

#### error cannot take word args
error uh-oh ('error', status=1)
## status: 3
## STDOUT:
## END

#### error requires arguments
error
## status: 2
## STDOUT:
## END

#### error cannot have a code of 0
error ('error', code=0)
## status: 2
## STDOUT:
## END

#### try { error oops }

try { error oops }
echo status=$[_error.code]

## STDOUT:
status=10
## END

#### Handle _error.code

proc failing {
  error 'failed' (code=99)
}

try {
  failing
}
if (_error.code === 99) {
  echo PASS
}

try {
  failing
}
case (_error.code) {
  (0)    { echo success }
  (1)    { echo one }
  (else) { echo CASE PASS }
}

## STDOUT:
PASS
CASE PASS
## END


#### failed builtin  usage

set +o errexit

try { echo ok }

failed (42)
echo status=$?

try { echo ok }

# Too many args
failed a b
echo status=$?

## STDOUT:
ok
status=2
ok
status=2
## END

#### failed builtin 

try {
  echo hi
}
if failed {
  echo 'should not get here'
} else {
  echo 'ok 1'
}

try {
  #test -n ''

  # Hm json read sets the regular error
  # Should we raise error.Structured?
  #json read <<< '{'

  var x = fromJson('{')

  # Hm the error is in a SUBPROCESS HERE
  #echo '{' | json read
}
if failed {
  echo 'ok 2'
} else {
  echo 'should not get here'
}

## STDOUT:
hi
ok 1
ok 2
## END


#### assert on values

try {
  $[ENV.SH] -c '
  assert (true)
  echo passed
  '
}
echo code $[_error.code]
echo

try {
  $[ENV.SH] -c '
  func f() { return (false) }

  assert (f())
  echo "unreachable"
  ' | grep -v Value
}
echo code $[_error.code]
echo

try {
  $[ENV.SH] -c '
  assert (null)
  echo "unreachable"
  ' | grep -v Value
}
echo code $[_error.code]
echo

try {
  $[ENV.SH] -c '
  func f() { return (false) }

  assert (true === f())
  echo "unreachable"
  ' | grep -v Value
}
echo code $[_error.code]
echo

try {
  $[ENV.SH] -c '
  assert (42 === 42)
  echo passed
  '
}
echo code $[_error.code]
echo

## STDOUT:
passed
code 0


code 3


code 3


code 3

passed
code 0

## END


#### assert on expressions

try {
  $[ENV.SH] -c '
  assert [true]
  echo passed
  '
}
echo code $[_error.code]
echo

try {
  $[ENV.SH] -c '
  func f() { return (false) }

  assert [f()]
  echo "unreachable"
  '
}
echo code $[_error.code]
echo

try {
  $[ENV.SH] -c '
  assert [null]
  echo "unreachable"
  '
}
echo code $[_error.code]
echo

try {
  $[ENV.SH] -c '
  func f() { return (false) }

  assert [true === f()]
  echo "unreachable"
  ' | grep -v '(Bool)'
}
echo code $[_error.code]
echo

try {
  $[ENV.SH] -c '
  assert [42 === 42]
  echo passed
  '
}
echo code $[_error.code]
echo

## STDOUT:
passed
code 0

code 3

code 3


code 3

passed
code 0

## END


#### assert on expression that fails

try {
  $[ENV.SH] -c '
  assert [NAN === 1/0]  # not true
  echo unreachable
  '
}
echo code $[_error.code]
echo

try {
  $[ENV.SH] -c '
  assert ["oof" === $(false)]
  echo unreachable
  '
}
echo code $[_error.code]
echo


## STDOUT:
code 3

code 1

## END

#### assert on chained comparison expression is not special

try {
  $[ENV.SH] -c '
  #pp test_ (42 === 42 === 43)
  assert [42 === 42 === 43]
  echo unreachable
  '
}
echo code $[_error.code]
echo

## STDOUT:
code 3

## END
