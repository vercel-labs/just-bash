## oils_failures_allowed: 1
## our_shell: ysh

#### bytecode

func __b__hi(n) {
  var x = n + 1
  var y = n + 2

  setvar y = x + y

  = y
}

call __b__hi(42)

## STDOUT:
## END
