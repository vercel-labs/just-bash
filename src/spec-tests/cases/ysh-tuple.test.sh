## our_shell: ysh
## oils_failures_allowed: 1

#### tuple literal and (( conflict
if ((0,0) < (0,1)) { echo yes }
## STDOUT:
yes
## END

#### Empty tuple
var t = ()
echo length=$[len(t)]
## STDOUT:
length=0
## END

#### Singleton tuple should be empty list

var t = [42]
echo len=$[len(t)]

#var t1 = 1,
var t2 = (42,)

## status: 2
## STDOUT:
len=1
## END
