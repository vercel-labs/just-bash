## our_shell: ysh

#### = to pretty print
= 1 + 2 * 3
## STDOUT:
(Int)   7
## END

#### 'call' to ignore return value
call 1 + 2 * 3

var strs = %(a b)
call len(strs)
call strs->append('c')
write -- @strs

# integer types too
const L = [5, 6]
call L->append(7)
write -- @L

write __

call L->pop()
write -- @L

## STDOUT:
a
b
c
5
6
7
__
5
6
## END
