# For OSH only functionality

#### var x = $(echo bad; false) in OSH

#shopt -s verbose_errexit

# This turns on command_sub_errexit and fails
var x = $(echo bad; false)
echo 'unreachable'

pp test_ (x)

## status: 1
## STDOUT:
## END


#### var x = $(echo one; false; echo two) in OSH

#shopt -s verbose_errexit

# I don't understand why this doesn't fail
var x = $(echo one; false; echo two)
echo 'unreachable'

pp test_ (x)

## status: 1
## STDOUT:
## END


#### YSH $[expr_sub] in OSH should not do dynamic globbing

touch {foo,bar}.txt

shopt -s parse_ysh_expr_sub
echo $["*.txt"]

## STDOUT:
*.txt
## END


#### SHELLOPTS bug with ysh:ugprade

cd $REPO_ROOT/spec/testdata/bug-shellopts

#shopt -p no_init_globals

$SH -o ysh:upgrade ./top-level.ysh

#echo ---
#$SH -e -c 'echo SHELLOPTS=$SHELLOPTS'
#$SH -e -o ysh:upgrade -c 'echo SHELLOPTS=$SHELLOPTS'

## STDOUT:
1
a
b
.
..
2
## END
