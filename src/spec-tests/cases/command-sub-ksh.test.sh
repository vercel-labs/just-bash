## compare_shells: mksh
## oils_failures_allowed: 4

# Features that bash 5.3 may implement

#### ${ echo hi;}

x=${ echo hi;}
echo "[$x]"
echo

# trailing space allowed
x=${ echo one; echo two; }
echo "[$x]"
echo

myfunc() {
  echo ' 3 '
  echo ' 4 5 '
}

x=${ myfunc;}
echo "[$x]"
echo

# SYNTAX ERROR
x=${myfunc;}
echo "[$x]"

## status: 1
## STDOUT:
[hi]

[one
two]

[ 3 
 4 5 ]

## END

#### ${ echo hi }  without semi-colon
## SKIP: Right brace in parameter default value not implemented

x=${ echo no-semi }
echo "[$x]"

x=${ echo no-space}
echo "[$x]"

# damn I wanted to take this over!  mksh executes it!
x=${ ~/ysh-tilde-sub }

# echo ${ ~/ysh-tilde-sub }

## status: 127
## STDOUT:
[no-semi]
[no-space]
## END

#### ${|REPLY=hi}
## SKIP: Right brace in parameter default value not implemented

x=${|y=" reply var "; REPLY=$y}
echo "[$x]"
echo

echo '  from file  ' > tmp.txt

x=${|read -r < tmp.txt}
echo "[$x]"
echo

# SYNTAX ERROR
x=${ |REPLY=zz}
echo "[$x]"

## status: 1
## STDOUT:
[ reply var ]

[from file]

## END


#### for loop / case
## SKIP: Right brace in parameter default value not implemented

x=${ for i in a b; do echo -$i-; done; }
echo "$x"

y=${|for i in a b; do REPLY+="-$i-"; done; }
echo "$y"

echo

x2=${ case foo in foo) echo sh-case ;; esac; }
echo "$x2"

y2=${|case foo in foo) REPLY=sh-case ;; esac; }
echo "$y2"

## STDOUT:
-a-
-b-
-a--b-

sh-case
sh-case
## END
