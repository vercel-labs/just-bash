## our_shell: ysh

#### For loop over expression: List
var mylist = [1, 2, 3]
for item in (mylist) {
  echo "item $item"
}

## STDOUT:
item 1
item 2
item 3
## END

#### For loop over expression: Dict, not BashAssoc

var mydict = {name: 'bob', age: 40}
for key in (mydict) {
  echo "key $key"
}

# We can declare this
shopt --unset no_osh_builtins
declare -A A=([name]=bob)

# But there is no iteration
for key in (A) {
  echo "key $key"
}

## status: 3
## STDOUT:
key name
key age
## END


#### For loop over range
var myrange = 0 ..< 3
for i in (myrange) {
  echo "i $i"
}

## STDOUT:
i 0
i 1
i 2
## END

#### Shell for loop with index (equivalent of enumerate())
for i, item in a b c {
  echo "$i $item"
}
## STDOUT:
0 a
1 b
2 c
## END

#### 3 indices with (mylist) is a runtime error
for i, item bad in (['foo', 'bar']) {
  echo "$i $item $bad"
}
## status: 2

#### Shell for loop can't have 3 indices 
for i, bad, bad in a b c {
  echo $i $item
}
## status: 2

#### Any for loop can't have 4 indices
for a, b, c, d in (['foo']) {
  echo $i $item
}
## status: 2

#### Expression for loop with index: List
for i, item in (['spam', 'eggs']) {
  echo "$i $item"
}
## STDOUT:
0 spam
1 eggs
## END

#### Expression for loop with index: Dict (TODO: define dict iter order)
for key, value in ({name: 'bob', age: 40}) {
  echo "pair $key $value"
}
## STDOUT:
pair name bob
pair age 40
## END

#### Dict: index key value loop (TODO: define dict iter order)
for i, key, value in ({name: 'bob', age: 40}) {
  echo "entry $i $key $value"
}
## STDOUT:
entry 0 name bob
entry 1 age 40
## END


#### Equivalent of zip()

var array = :| d e f |

for i, item in a b c {
  echo "$i $item $[array[i]]"
}

## STDOUT:
0 a d
1 b e
2 c f
## END

#### no_parse_bare_word eliminates confusion

shopt --set no_parse_bare_word

for x in mylist {  # THIS FAILS
  echo "BAD $x"
}

## status: 2
## STDOUT:
## END


#### Object that's not iterable

echo hi
for x in (42) {
  echo $x
}

## status: 3
## STDOUT:
hi
## END

#### YSH for with brace substitution and glob

touch {foo,bar}.py
for i, file in *.py {README,foo}.md {
  echo "$i $file"
}
## STDOUT:
0 bar.py
1 foo.py
2 README.md
3 foo.md
## END

#### for x in (io.stdin) { 

# to avoid stdin conflict

$[ENV.SH] $[ENV.REPO_ROOT]/spec/testdata/ysh-for-stdin.ysh

## STDOUT:
-1-
-2-
-3-

0 1
1 2
2 3

empty
done

empty2
done2

space
hi
## END

#### I/O error in for x in (stdin) { 

set +o errexit

# EISDIR - stdin descriptor is dir
$[ENV.SH] -c 'for x in (io.stdin) { echo $x }' < /
if test $? -ne 0; then
  echo pass
fi

## STDOUT:
pass
## END

#### Append to List in loop extends the loop (matches JS)

# see demo/survey-loop

var mylist = [1,2,3]
for x in (mylist) {
  if (x === 2) {
    call mylist->append(99)
  }
  echo $x
}
## STDOUT:
1
2
3
99
## END

#### Remove from List in loop shortens it (matches JS)

# see demo/survey-loop

var mylist = [1,2,3,4]
for x in (mylist) {
  if (x === 2) {
    call mylist->pop()
  }
  echo $x
}
## STDOUT:
1
2
3
## END

#### Adding to Dict in loop does NOT extend the loop (matches JS)

# see demo/survey-loop

var mydict = {"1": null, "2": null, "3": null}
for x in (mydict) {
  if (x === "2") {
    setvar mydict["99"] = null
  }
  echo $x
}
## STDOUT:
1
2
3
## END

#### Removing from Dict in loop does NOT change the loop (does NOT match JS)

# see demo/survey-loop

var mydict = {"1": null, "2": null, "3": null, "4": null}
for x in (mydict) {
  if (x === "2") {
    call mydict->erase("1")
    call mydict->erase("3")
  }
  echo $x
}
## STDOUT:
1
2
3
4
## END
