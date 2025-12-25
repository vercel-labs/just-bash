## our_shell: osh
# compare_shells: bash

#### Can't use x+= on YSH Int (issue #840)

sh_str=2
echo sh_str=$sh_str

sh_str+=1
echo sh_str=$sh_str

sh_str+=1
echo sh_str=$sh_str

echo

var ysh_int = 2
echo ysh_int=$ysh_int

# What should happen here?

ysh_int+=1
echo ysh_int=$ysh_int

ysh_int+=1
echo ysh_int=$ysh_int

## status: 1
## STDOUT:
sh_str=2
sh_str=21
sh_str=211

ysh_int=2
## END

#### Can't x+= on other YSH types

$SH -c '
var x = /d+/
x+=1
'
echo eggex $?

$SH -c '
var d = {}
d+=1
'
echo Dict $?

# This is unspecified for now, could try to match bash
$SH -c '
declare -A A=()
A+=1
'
echo BashAssoc $?

## STDOUT:
eggex 1
Dict 1
BashAssoc 1
## END

#### Shell ${x:-default} with YSH List (issue #954)

var mylist = [1, 2, 3]

echo mylist ${mylist:-default}

var myint = 42

echo myint ${myint:-default}

## status: 3
## STDOUT:
## END


#### Shell ${a[0]} with YSH List (issue #1092)

var a = [1, 2, 3]
echo first ${a[0]}

## status: 3
## STDOUT:
## END


#### Can't splice nested List

shopt --set parse_at

var mylist = ["ls", {name: 42}]

echo @mylist

## status: 3
## STDOUT:
## END

#### Can't splice nested Dict

declare -A A=([k]=v [k2]=v2)
echo ${A[@]}

var d ={name: [1, 2, 3]}
echo ${d[@]}

## status: 3
## STDOUT:
v v2
## END

#### ${#x} on List and Dict

var L = [1,2,3]

echo List ${#L[@]}
echo List ${#L}
# Not supported.  TODO: could be a problem
#echo List ${#L[0]}

declare -a a=(abc d)

echo array ${#a[@]}
echo array ${#a}
echo array ${#a[0]}

var d = {k: 'v', '0': 'abc'}

echo Dict ${#d[@]}
echo Dict ${#d}
# Not supported.  TODO: could be a problem
#echo Dict ${#d[0]}

declare -A d=([k]=v [0]=abc)

echo Assoc ${#d[@]}
echo Assoc ${#d}
echo Assoc ${#d[0]}

## status: 3
## STDOUT:
## END

#### Can't use $x on List and Dict

declare -a a=(abc d)
echo array $a
echo array ${a[0]}

var L = [1,2,3]
echo List $L

declare -A A=([k]=v [0]=abc)
echo Assoc $A
echo Assoc ${A[0]}

var d = {k: 'v', '0': 'abc'}
#echo Dict $d

## status: 3
## STDOUT:
array abc
array abc
## END

#### Iterate over array with holes (bug fix)

declare -a array=(a b)
array[5]=c
argv.py "${array[@]}"

# TODO: Should print this like this bash, with value.BashArray
declare -a

for i, item in (array) {
  echo "$i $item"
}

## status: 3
## STDOUT:
['a', 'b', 'c']
array=([0]=a [1]=b [5]=c)
## END

#### Slice bash array isn't allowed

shopt --set parse_at

var ysh = :| ysh 'c d' e f |
var yslice = ysh[1:3]
argv.py @yslice

declare -a bash=(bash 'c d' e f)

# You can copy it and then slice it
var ysh2 = :| copy "${bash[@]}" |
var yslice = ysh2[0:2]
argv.py @yslice

# Note this
var sh_slice = bash[1:3]
argv.py @sh_slice

## status: 3
## STDOUT:
['c d', 'e']
['copy', 'bash']
## END

#### Concat ++ not defined on shell array

declare -a a=(x y)
declare -a b=(x y)

= a ++ b

## status: 3
## STDOUT:
## END
