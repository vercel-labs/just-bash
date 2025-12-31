## compare_shells: dash bash mksh zsh
## oils_failures_allowed: 1

# Test the length oeprator, which dash supports.  Dash doesn't support most
# other ops.

#### String length
v=foo
echo ${#v}
## stdout: 3

#### Unicode string length (UTF-8)
v=$'_\u03bc_'
echo ${#v}
## stdout: 3
## N-I dash stdout: 9
## N-I mksh stdout: 4

#### Unicode string length (spec/testdata/utf8-chars.txt)
## SKIP: Test data directory not available
v=$(cat $REPO_ROOT/spec/testdata/utf8-chars.txt)
echo ${#v}
## stdout: 7
## N-I dash stdout: 13
## N-I mksh stdout: 13

#### String length with incomplete utf-8
## SKIP: Test data directory not available
for num_bytes in 0 1 2 3 4 5 6 7 8 9 10 11 12 13; do
  s=$(head -c $num_bytes $REPO_ROOT/spec/testdata/utf8-chars.txt)
  echo ${#s}
done 2> $TMP/err.txt

grep 'warning:' $TMP/err.txt
true  # exit 0

## STDOUT:
0
1
2
-1
3
4
-1
-1
5
6
-1
-1
-1
7
[ stdin ]:3: warning: UTF-8 decode: Truncated bytes at offset 2 in string of 3 bytes
[ stdin ]:3: warning: UTF-8 decode: Truncated bytes at offset 5 in string of 6 bytes
[ stdin ]:3: warning: UTF-8 decode: Truncated bytes at offset 5 in string of 7 bytes
[ stdin ]:3: warning: UTF-8 decode: Truncated bytes at offset 9 in string of 10 bytes
[ stdin ]:3: warning: UTF-8 decode: Truncated bytes at offset 9 in string of 11 bytes
[ stdin ]:3: warning: UTF-8 decode: Truncated bytes at offset 9 in string of 12 bytes
## END
# zsh behavior actually matches bash!
## BUG bash/zsh stderr-json: ""
## BUG bash/zsh STDOUT:
0
1
2
3
3
4
5
6
5
6
7
8
9
7
## END
## N-I dash/mksh stderr-json: ""
## N-I dash/mksh STDOUT:
0
1
2
3
4
5
6
7
8
9
10
11
12
13
## END

#### String length with invalid utf-8 continuation bytes
## SKIP: Test data directory not available
for num_bytes in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do
  s=$(head -c $num_bytes $REPO_ROOT/spec/testdata/utf8-chars.txt)$(echo -e "\xFF")
  echo ${#s}
done 2> $TMP/err.txt

grep 'warning:' $TMP/err.txt
true

## STDOUT:
-1
-1
-1
-1
-1
-1
-1
-1
-1
-1
-1
-1
-1
-1
-1
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 0 in string of 1 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 1 in string of 2 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 2 in string of 3 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 2 in string of 4 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 4 in string of 5 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 5 in string of 6 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 5 in string of 7 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 5 in string of 8 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 8 in string of 9 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 9 in string of 10 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 9 in string of 11 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 9 in string of 12 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 9 in string of 13 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 13 in string of 14 bytes
[ stdin ]:3: warning: UTF-8 decode: Bad encoding at offset 13 in string of 14 bytes
## END
## BUG bash/zsh stderr-json: ""
## BUG bash/zsh STDOUT:
1
2
3
4
4
5
6
7
6
7
8
9
10
8
8
## N-I dash stderr-json: ""
## N-I dash STDOUT:
7
8
9
10
11
12
13
14
15
16
17
18
19
20
20
## END
## N-I mksh stderr-json: ""
## N-I mksh STDOUT:
1
2
3
4
5
6
7
8
9
10
11
12
13
14
14
## END

#### Length of undefined variable
echo ${#undef}
## stdout: 0

#### Length of undefined variable with nounset
set -o nounset
echo ${#undef}
## status: 1
## OK dash status: 2

#### Length operator can't be followed by test operator
echo ${#x-default}

x=''
echo ${#x-default}

x='foo'
echo ${#x-default}

## status: 2
## OK bash/mksh status: 1
## stdout-json: ""
## BUG zsh status: 0
## BUG zsh STDOUT:
7
0
3
## END
## BUG dash status: 0
## BUG dash STDOUT:
0
0
3
## END

#### ${#s} respects LC_ALL - length in bytes or code points
## SKIP: Locale settings not supported
case $SH in dash) exit ;; esac

# This test case is sorta "infected" because spec-common.sh sets LC_ALL=C.UTF-8
#
# For some reason mksh behaves differently
#
# See demo/04-unicode.sh

#echo $LC_ALL
unset LC_ALL 

# note: this may depend on the CI machine config
LANG=en_US.UTF-8

#LC_ALL=en_US.UTF-8

for s in $'\u03bc' $'\U00010000'; do
  LC_ALL=
  echo "len=${#s}"

  LC_ALL=C
  echo "len=${#s}"

  echo
done

## STDOUT:
len=1
len=2

len=1
len=4

## END

## N-I dash STDOUT:
## END

## BUG mksh STDOUT:
len=2
len=2

len=3
len=3

## END
