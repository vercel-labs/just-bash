## oils_failures_allowed: 1

# Test shell execution options.

#### simple_word_eval doesn't split, glob, or elide empty
mkdir mydir
touch foo.z bar.z spam.z
spaces='a b'
dir=mydir
glob=*.z
prefix=sp
set -- 'x y' z

for i in 1 2; do
  local empty=
  argv.py $spaces $glob $empty $prefix*.z

  # arrays still work too, with this weird rule
  argv.py -"$@"-

  shopt -s simple_word_eval
done
## STDOUT:
['a', 'b', 'bar.z', 'foo.z', 'spam.z', 'spam.z']
['-x y', 'z-']
['a b', '*.z', '', 'spam.z']
['-x y', 'z-']
## END

#### simple_word_eval and strict_array conflict over globs
touch foo.txt bar.txt
set -- f

argv.py "$@"*.txt
shopt -s simple_word_eval
argv.py "$@"*.txt
shopt -s strict_array
argv.py "$@"*.txt

## status: 1
## STDOUT:
['foo.txt']
['foo.txt']
## END

#### simple_word_eval and glob
shopt -s simple_word_eval

# rm -v -f *.ff
touch 1.ff 2.ff

for i in *.ff; do
  echo $i
done

array=(*.ff)
echo "${array[@]}"

echo *.ff

## STDOUT:
1.ff
2.ff
1.ff 2.ff
1.ff 2.ff
## END

#### parse_at
words=(a 'b c')
argv.py @words

shopt -s parse_at
argv.py @words

## STDOUT:
['@words']
['a', 'b c']
## END

#### DISABLED: parse_at can't be used outside top level

# shopt -u expand_aliases conflicted with ble.sh, and it was also broken for
# proc/func

f() {
  shopt -s parse_at
  echo status=$?
}
f
echo 'should not get here'
## status: 1
## stdout-json: ""


#### sourcing a file that sets parse_at
cat >lib.sh <<EOF
shopt -s parse_at
echo lib.sh
EOF

words=(a 'b c')
argv.py @words

# This has a side effect, which is a bit weird, but not sure how to avoid it.
# Maybe we should say that libraries aren't allowed to change it?

source lib.sh
echo 'main.sh'

argv.py @words
## STDOUT:
['@words']
lib.sh
main.sh
['a', 'b c']
## END

#### parse_at can be specified through sh -O
$SH +O parse_at -c 'words=(a "b c"); argv.py @words'
$SH -O parse_at -c 'words=(a "b c"); argv.py @words'
## STDOUT:
['@words']
['a', 'b c']
## END

#### @a splices into $0
shopt -s simple_word_eval parse_at
a=(echo hi)
"${a[@]}"
@a

# Bug fix
shopt -s strict_array

"${a[@]}"
@a
## STDOUT:
hi
hi
hi
hi
## END

#### shopt -s strict:all
shopt -s strict:all
# normal option names
shopt -o -p | grep -- ' -o ' | grep -v hashall
shopt -p strict:all
## STDOUT:
shopt -s strict_arg_parse
shopt -s strict_argv
shopt -s strict_arith
shopt -s strict_array
shopt -s strict_control_flow
shopt -s strict_env_binding
shopt -s strict_errexit
shopt -s strict_glob
shopt -s strict_nameref
shopt -s strict_parse_equals
shopt -s strict_parse_slice
shopt -s strict_tilde
shopt -s strict_word_eval
## END

#### shopt -s ysh:upgrade
shopt -s ysh:upgrade
# normal option names
shopt -o -p | grep -- ' -o ' | grep -v hashall
shopt -p ysh:upgrade
## STDOUT:
set -o errexit
set -o nounset
set -o pipefail
shopt -s command_sub_errexit
shopt -s env_obj
shopt -s errexit
shopt -s for_loop_frames
shopt -s inherit_errexit
shopt -s init_ysh_globals
shopt -s no_dash_glob
shopt -s no_xtrace_osh
shopt -s nounset
shopt -s nullglob
shopt -s parse_at
shopt -s parse_brace
shopt -s parse_bracket
shopt -s parse_equals
shopt -s parse_func
shopt -s parse_paren
shopt -s parse_proc
shopt -s parse_triple_quote
shopt -s parse_ysh_expr_sub
shopt -s parse_ysh_string
shopt -s pipefail
shopt -s process_sub_fail
shopt -s sigpipe_status_ok
shopt -s simple_word_eval
shopt -s verbose_errexit
shopt -s verbose_warn
shopt -s xtrace_rich
shopt -s ysh_rewrite_extern
## END

#### osh -O ysh:upgrade 
$SH -O ysh:upgrade -c 'var x = :|one two three|; write @x'
## STDOUT:
one
two
three
## END

#### osh -O errexit: use -O everywhere, even for Bourne options
$SH -O errexit -c 'shopt -p -o errexit'
#$SH -O errexit -c 'shopt -p errexit'  # bash doesn't allow this, but Oils does
## STDOUT:
set -o errexit
## END

#### osh -O invalid
$SH -O errexit -c 'echo hi'
echo status=$?
$SH -O invalid -c 'echo hi'
echo status=$?
## STDOUT:
hi
status=0
status=2
## END

#### osh -o new_option is also accepted

$SH -o nullglob -c 'echo nullglob'
echo $? flag nullglob

$SH -o oil:upgrade -c 'proc p { echo upgrade }; p'
echo $? flag oil:upgrade

# Should disallow these

set -o nullglob
echo $? set builtin nullglob
set -o oil:upgrade
echo $? set builtin oil:upgrade

## STDOUT:
nullglob
0 flag nullglob
upgrade
0 flag oil:upgrade
2 set builtin nullglob
2 set builtin oil:upgrade
## END


#### oil:upgrade includes inherit_errexit
shopt -s oil:upgrade
echo $(echo one; false; echo two)
## status: 1
## stdout-json: ""

#### parse_brace: bad block to assignment builtin
shopt -s oil:upgrade
# This is a fatal programming error.  It's unlike passing an extra arg?
local x=y { echo 'bad block' }
echo status=$?
## status: 1
## stdout-json: ""

#### parse_brace: bad block to external program
shopt -s oil:upgrade
# This is a fatal programming error.  It's unlike passing an extra arg?
ls { echo 'bad block' }
echo status=$?
## status: 1
## stdout-json: ""

#### parse_brace: cd { } in pipeline
shopt -s oil:upgrade
cd /tmp {
  pwd
  pwd
} | tr a-z A-Z
## STDOUT:
/TMP
/TMP
## END


#### parse_brace: if accepts blocks
shopt -s oil:upgrade
shopt -u errexit  # don't need strict_errexit check!

if test -n foo {
  echo one
}
# harder
if test -n foo; test -n bar {
  echo two
}

# just like POSIX shell!
if test -n foo;

   test -n bar {
  echo three
}

if test -z foo {
  echo if
} else {
  echo else
}

if test -z foo {
  echo if
} elif test -z '' {
  echo elif
} else {
  echo else
}

echo 'one line'
if test -z foo { echo if } elif test -z '' { echo 1 }; if test -n foo { echo 2 };

echo 'sh syntax'
if test -z foo; then echo if; elif test -z ''; then echo 1; fi; if test -n foo { echo 2 };

# NOTE: This is not allowed because it's like a brace group!
# if test -n foo; { 

## STDOUT:
one
two
three
else
elif
one line
1
2
sh syntax
1
2
## END

#### parse_brace: brace group in if condition

# strict_errexit would make this a RUNTIME error
shopt -s parse_brace
if { echo one; echo two } {
  echo three
}
## STDOUT:
one
two
three
## END

#### parse_brace: while/until
shopt -s oil:upgrade
while true {
  echo one
  break
}
while true { echo two; break }

echo 'sh syntax'
while true; do echo three; break; done
## STDOUT:
one
two
sh syntax
three
## END

#### parse_brace: for-in loop
shopt -s oil:upgrade
for x in one two {
  echo $x
}
for x in three { echo $x }

echo 'sh syntax'
for x in four; do echo $x; done

## STDOUT:
one
two
three
sh syntax
four
## END

#### parse_brace case
shopt -s ysh:upgrade

var files = :| foo.py 'foo test.sh' |
for name in (files) {
  case $name in
    *.py)
      echo python
      ;;
    *.sh)
      echo shell
      ;;
  esac
}

for name in @files {
  case (name) {
  *.py {
    echo python
  }
  *.sh { echo shell }
  }
}

## STDOUT:
python
shell
python
shell
## END

#### parse_paren: if statement
shopt -s oil:upgrade
var x = 1
if (x < 42) {
  echo less
}

if (x < 0) {
  echo negative
} elif (x < 42) {
  echo less
}

if (x < 0) {
  echo negative
} elif (x < 1) {
  echo less
} else {
  echo other
}


## STDOUT:
less
less
other
## END

#### parse_paren: while statement
shopt -s oil:upgrade

# ksh style
var x = 1
while (( x < 3 )) {
  echo $x
  setvar x += 1
}
echo 'done ksh'

# sh style
var y = 1
while test $y -lt 3 {
  echo $y
  setvar y += 1
}
echo 'done sh'

# oil
var z = 1
while (z < 3) {
  echo $z
  setvar z += 1
}
echo 'done oil'

## STDOUT:
1
2
done ksh
1
2
done sh
1
2
done oil
## END

#### while subshell without parse_paren
while ( echo one ); do
  echo two
  break
done
## STDOUT:
one
two
## END

#### nullglob is on with oil:upgrade 
write one *.zzz two
shopt -s oil:upgrade
write __
write one *.zzz two
## STDOUT:
one
*.zzz
two
__
one
two
## END

#### nullglob is on with oil:all
write  one *.zzz two
shopt -s oil:all
write __
write one *.zzz two
## STDOUT:
one
*.zzz
two
__
one
two
## END

#### shopt -s simple_echo
foo='one   two'
echo $foo   # bad split then join
shopt -s simple_echo
echo
echo "$foo"  # good
echo $foo

echo -e "$foo"  # -e isn't special!
echo -n "$foo"  # -n isn't special!

## STDOUT:
one two

one   two
one two
-e one   two
-n one   two
## END

#### shopt -s no_dash_glob
mkdir globdir
cd globdir

touch -- file -v

argv.py *

shopt -s ysh:upgrade  # turns OFF no_dash_glob
argv.py *

shopt -u no_dash_glob  # turn it ON
argv.py *

## STDOUT:
['-v', 'file']
['file']
['-v', 'file']
## END

#### sigpipe_status_ok

status_141() {
  return 141
}

yes | head -n 1
echo ${PIPESTATUS[@]}

# DUMMY
yes | status_141
echo ${PIPESTATUS[@]}

shopt --set oil:upgrade  # sigpipe_status_ok
shopt --unset errexit

yes | head -n 1
echo ${PIPESTATUS[@]}

# Conveniently, the last 141 isn't changed to 0, because it's run in the
# CURRENT process.

yes | status_141
echo ${PIPESTATUS[@]}

echo background
false | status_141 &
wait
echo status=$? pipestatus=${PIPESTATUS[@]}

## STDOUT:
y
141 0
141 141
y
0 0
0 141
background
status=0 pipestatus=0 141
## END


#### printf | head regression (sigpipe_status_ok)

shopt --set ysh:upgrade
shopt --unset errexit

bad() {
  /usr/bin/printf '%65538s\n' foo | head -c 1
  echo external on @_pipeline_status

  shopt --unset sigpipe_status_ok {
    /usr/bin/printf '%65538s\n' foo | head -c 1
  }
  echo external off @_pipeline_status

  printf '%65538s\n' foo | head -c 1
  echo builtin on @_pipeline_status

  shopt --unset sigpipe_status_ok {
    printf '%65538s\n' foo | head -c 1
  }
  echo builtin off @_pipeline_status
}

bad
echo finished

## STDOUT:
 external on 0 0
 external off 141 0
 builtin on 0 0
 builtin off 141 0
finished
## END

#### redefine_proc is on in interactive shell

$SH -O oil:all -i --rcfile /dev/null -c "
source $REPO_ROOT/spec/testdata/module/common.ysh
source $REPO_ROOT/spec/testdata/module/redefinition.ysh
log hi
"
## STDOUT:
common
redefinition
## END
## STDERR:
hi
## END


#### redefine_source is on in interactive shell

$SH -O oil:all -i --rcfile /dev/null -c "
source $REPO_ROOT/spec/testdata/module/common.ysh
source $REPO_ROOT/spec/testdata/module/common.ysh
log hi
" 2>stderr.txt
echo status=$?

# Make sure there are two lines
wc -l stderr.txt
## STDOUT:
common
common
status=0
2 stderr.txt
## END


#### parse options in sourced file (bug #1628)

set -e  # catch errors

alias e=echo
shopt -u expand_aliases

source $REPO_ROOT/spec/testdata/parse_opts.sh a b c

echo OK

# alias persists
e alias on

# parse_paren doesn't persist
#if (x > 1) {
#  echo 'OK'
#}

FOO=bar source $REPO_ROOT/spec/testdata/parse_opts.sh
echo OK


## STDOUT:
OK
alias on
OK
## END

#### expand_aliases turned off only in ysh:all

alias e=echo
e normal

shopt -s ysh:upgrade
e upgrade

shopt -s ysh:all
e all

## status: 127
## STDOUT:
normal
upgrade
## END

#### [[ isn't allowed in ysh
[[ 3 == 3 ]]
echo status=$?

shopt -s ysh:upgrade
[[ 3 == 3 ]]
echo status=$?

shopt -s ysh:all
[[ 3 == 3 ]]
echo status=$?

[[ 0 == 0 ]]
echo status=$?

## status: 2
## STDOUT:
status=0
status=0
## END

#### ysh:upgrade allows assoc arrays, with parse_ysh_string

shopt --set ysh:upgrade

# parse_ysh_string disallows it
# do we need another option?  strict_parse_string or strict_parse_word?

declare -A assoc=(['key']=value ["dq"]=dq)

#declare -A assoc=([key]=value [dq]=dq)
echo ${#assoc[@]}

## STDOUT:
2
## END

#### ysh_rewrite_extern makes the process exit with SIGPIPE
shopt --set ysh_rewrite_extern

((/usr/bin/cat </dev/zero; echo $? >&7) | true) 7>&1
((cat </dev/zero; echo $? >&7) | true) 7>&1

## STDOUT:
141
## END
