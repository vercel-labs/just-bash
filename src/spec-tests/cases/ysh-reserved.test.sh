## our_shell: ysh

#### Standalone generator expression
var x = (i+1 for i in 1:3)
# This is NOT a list.  TODO: This test is overspecified.
pp cell_ x | grep -o '<generator'
write status=$?
## status: 2
## STDOUT:
## END



#### List comprehension (deferred)
shopt -s oil:all

var n = [i*2 for i in range(5)]
write --sep ' ' @n

# TODO: Test this
#var n = [i*2 for i,j in range(5)]

var even = [i*2 for i in range(5) if i % 2 === 0]
write --sep ' ' @even
## status: 2
## STDOUT:
## END


#### Lambda not implemented
const f = |x| x + 1

## status: 2
## STDOUT:
## END

#### Anonymous function expression not implemented (Tea)

# Note: this results in a expr.Lambda node.  But it's not parsed.

const f = func(x) {
  myfunc(x)
  return x + 1
}

## status: 2
## STDOUT:
## END
