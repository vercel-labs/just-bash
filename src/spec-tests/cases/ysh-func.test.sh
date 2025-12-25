# spec/ysh-func

## our_shell: ysh

#### Identity function
func id(x) {
  return (x)
}

json write (id("ysh"))

## STDOUT:
"ysh"
## END

#### Too many args
func f(x) { return (x + 1) }

= f(0, 1)
## status: 3
## STDOUT:
## END

#### Too few args
func f(x) { return (x + 1) }

= f()
## status: 3
## STDOUT:
## END

#### Positional args

func f(x, y, ...rest) {
  echo "pos $x $y"
  echo rest @rest
}

call f(1, 2, 3, 4)

# This is an error
#call f(1, 2, m=2, n=3)

## STDOUT:
pos 1 2
rest 3 4
## END


#### named args
func f(; x=3) {
  echo x=$x
}

call f()

call f(x=4)

## STDOUT:
x=3
x=4
## END

#### Named args with ...rest
func f(; x=3, ...named) {
  echo x=$x
  pp test_ (named)
}

call f()

call f(x=4)

call f(x=4, y=5)

## STDOUT:
x=3
(Dict)   {}
x=4
(Dict)   {}
x=4
(Dict)   {"y":5}
## END

#### Spread/splat of named args: f(...more)

func f(; x, y) {
  echo "$x $y"
}

call f(; x=9, y=10)

var args = {x: 3, y: 4}

call f(; ...args)


## STDOUT:
9 10
3 4
## END


#### Multiple spreads

func f(...pos; ...named) {
  pp test_ (pos)
  pp test_ (named)
}

var a = [1,2,3]
var d = {m: 'spam', n: 'no'}
var e = {p: 5, q: 6}

call f(...a, ...a; ...d, ...e)

## STDOUT:
(List)   [1,2,3,1,2,3]
(Dict)   {"m":"spam","n":"no","p":5,"q":6}
## END


#### Proc-style return in a func is error
func t() { return 0 }

= t()
## status: 2
## STDOUT:
## END

#### Typed return in a proc is error
proc t() { return (0) }

= t()
## status: 2
## STDOUT:
## END

#### Redefining functions is allowed
func f() { return (0) }
func f() { return (1) }
## status: 0
## STDOUT:
## END

#### Functions can redefine vars
var f = 0
func f() { return (1) }
pp test_ (f)
## STDOUT:
<Func>
## END

#### Multiple func calls

func inc(x) {
  # increment

  return (x + 1)
}

func dec(x) {
  # decrement

  return (x - 1)
}

echo $[inc(1)]
echo $[inc(inc(1))]
echo $[dec(inc(inc(1)))]

var y = dec(dec(1))
echo $[dec(y)]

## STDOUT:
2
3
2
-2
## END

#### Undefined var in function

func g(x) {
  var z = y  # make sure dynamic scope is off
  return (x + z) 
}

func f() {
  var y = 42  # if dynamic scope were on, g() would see this
  return (g(0))
}

echo $[f()]

## status: 1
## STDOUT:
## END

#### Param binding semantics
# value
var x = 'foo'

func f(x) {
  setvar x = 'bar'
}

pp test_ (x)
pp test_ (f(x))
pp test_ (x)

# reference
var y = ['a', 'b', 'c']

func g(y) {
  setvar y[0] = 'z'
}

pp test_ (y)
pp test_ (g(y))
pp test_ (y)
## STDOUT:
(Str)   "foo"
(Null)   null
(Str)   "foo"
(List)   ["a","b","c"]
(Null)   null
(List)   ["z","b","c"]
## END

#### Recursive functions
func fib(n) {
  # TODO: add assert n > 0
  if (n < 2) {
    return (n)
  }

  return (fib(n - 1) + fib(n - 2))
}

json write (fib(10))
## STDOUT:
55
## END

#### Recursive functions with LRU Cache
source $LIB_YSH/list.ysh

var cache = []
var maxSize = 4

func remove(l, i) {
  for i in (i ..< len(l) - 1) {
    setvar l[i] = l[i + 1]
  }

  call l->pop() # remove duplicate last element
}

func fib(n) {
  var i = len(cache) - 1
  var j = 0;
  while (i >= 0) {
    var item = cache[i]

    if (item[0] === n) {
      call remove(cache, i)
      call cache->append(item)

      echo hit: $n
      return (item[1])
    }

    setvar i = i - 1
    setvar j += 1
  }

  var result = 0
  if (n < 2) {
    setvar result = n
  } else {
    setvar result = fib(n - 1) + fib(n - 2)
  }

  if (len(cache) >= maxSize) {
    call remove(cache, 0)
  }
  call cache->append([n, result])

  return (result)
}

json write (fib(10))
json write (cache)

## STDOUT:
hit: 1
hit: 2
hit: 3
hit: 4
hit: 5
hit: 6
hit: 7
hit: 8
55
[
  [
    7,
    13
  ],
  [
    9,
    34
  ],
  [
    8,
    21
  ],
  [
    10,
    55
  ]
]
## END

#### Varadic arguments, no other args
func f(...args) {
pp test_ (args)
}

call f()
call f(1)
call f(1, 2)
call f(1, 2, 3)
## STDOUT:
(List)   []
(List)   [1]
(List)   [1,2]
(List)   [1,2,3]
## END

#### Varadic arguments, other args
func f(a, b, ...args) {
pp test_ ([a, b, args])
}

call f(1, 2)
call f(1, 2, 3)
call f(1, 2, 3, 4)
## STDOUT:
(List)   [1,2,[]]
(List)   [1,2,[3]]
(List)   [1,2,[3,4]]
## END

#### Varadic arguments, too few args
func f(a, b, ...args) {
  = [a, b, args]
}

call f(1)
## status: 3
## STDOUT:
## END

#### Userland max
func mymax (...args) {
  if (len(args) === 0) {
    error 'Requires 1 arg'
  } elif (len(args) === 1) {
    # TODO: assert List
    var mylist = args[0]
    var max = mylist[0]

    for item in (mylist) {
      if (item > max) {
        setvar max = item
      }
    }

    return (max)
  } elif (len(args) === 2) {
    if (args[0] >= args[1]) {
      return (args[0])
    } else {
      return (args[1])
    }
  } else {
    # max(1, 2, 3) doesn't work in YSH, but does in Python
    error 'too many'
  }
}

= mymax(5,6)  # => 6
= mymax([5,6,7])  # => 7
= mymax(5,6,7,8)  # error

## status: 10
## STDOUT:
(Int)   6
(Int)   7
## END

#### Functions share a namespace with variables
func f(x) {
  return (x * x)
}

var g = f
echo "g(2) -> $[g(2)]"
## STDOUT:
g(2) -> 4
## END

#### We can store funcs in dictionaries
func dog_speak() {
  echo "Woof"
}

func dog_type() {
  return ("DOG")
}

const Dog = {
  speak: dog_speak,
  type: dog_type,
}

func cat_speak() {
  echo "Meow"
}

func cat_type() {
  return ("CAT")
}

const Cat = {
  speak: cat_speak,
  type: cat_type,
}

# First class "modules"!
const animals = [Dog, Cat]
for animal in (animals) {
  var type = animal.type()
  echo This is a $type
  call animal.speak()
}
## STDOUT:
This is a DOG
Woof
This is a CAT
Meow
## END

#### Functions can be nested
proc build {
  func f(x) {
    return (x)
  }

  echo $[f(0)]
}
build
echo $[f(0)]  # This will fail as f is locally scoped in `proc build`
## status: 1
## STDOUT:
0
## END

#### Functions can be shadowed
func mysum(items) {
  var mysum = 0
  for x in (items) {
    setvar mysum += x
  }
  return (mysum)
}

echo 1 + 2 + 3 = $[mysum([1, 2, 3])]

func inAnotherScope() {
  # variable mysum has not yet shadowed func mysum in evaluation
  var mysum = mysum([1, 2, 3])
  echo mysum=$mysum
}
call inAnotherScope()

var mysum = mysum([0, 1])
echo mysum=$mysum

## STDOUT:
1 + 2 + 3 = 6
mysum=6
mysum=1
## END

#### Funcs are closures (capture their environment)

func makeFunc() {
  var x = 42
  func inner() {
    echo "x = $x"
  }
  setvar x += 1
  return (inner)
}

const f = makeFunc()
call f()

## STDOUT:
x = 43
## END
