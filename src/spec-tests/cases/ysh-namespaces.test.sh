## our_shell: ysh
## oils_failures_allowed: 2

#### global frame doesn't contain builtins like len(), dict(), io

try {
  pp frame_vars_ | grep -o len
}
pp test_ (_pipeline_status)

try {
  pp frame_vars_ | grep -o dict
}
pp test_ (_pipeline_status)

try {
  pp frame_vars_ | grep -o -w io
}
pp test_ (_pipeline_status)

## STDOUT:
(List)   [0,1]
(List)   [0,1]
(List)   [0,1]
## END

#### global frame doesn't contain env vars

#pp frame_vars_

try {
  pp frame_vars_ | grep -o TMP
}
pp test_ (_pipeline_status)


## STDOUT:
(List)   [0,1]
## END

#### global frame doesn't have PWD, IFS

echo "IFS=[$IFS]"
echo "PWD=[$PWD]"

## STDOUT:
## END

#### __defaults__ is a Dict, showing default PATH, PS1

pp test_ (type(__defaults__))

pp test_ (__defaults__)

## STDOUT:
(Str)   "Dict"
## END


#### __builtins__ module

var b = len(propView(__builtins__))

# more than 30 builtins
assert [b > 30]

var mylist = :| a b |

setvar len = 4  # overwrite
setvar len = __builtins__.len(mylist)
assert [2 === len]

## STDOUT:
## END


#### cd builtin respects ENV.HOME, not HOME

try { cd }
echo code=$[_error.code]
echo

setglobal ENV.HOME = '/tmp'

# Now it's respected
try { cd }
echo code=$[_error.code]

pwd

## STDOUT:
code=1

code=0
/tmp
## END

#### compgen -c respects ENV.PATH, not PATH

setglobal ENV.PATH = '/bin'

# ls is required by POSIX
compgen -c | grep -w 'ls'

## STDOUT:
ls
## END
