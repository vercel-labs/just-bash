
#### argv0 trace

OILS_TRACE_DIR=$TMP $SH -c '

# No argv does not crash
$(true)

echo internal

/bin/echo x1

/bin/true

/bin/echo x2

# Not getting anything here?
# NOFORKLAST optimization messes things up if the last command is external
# Though turning this off means that measuring performance changes performance

#( echo "("; /bin/false; /bin/false; echo ")" )
( echo "("; /bin/false; /bin/false )

a=$(echo "\$("; /bin/true; /bin/true; echo ")")
echo "$a"

/bin/echo x3
'

# For now just check that it parses
for j in $TMP/*.json; do
  #echo "$j" >&2
  python3 -m json.tool $j >/dev/null
done

## STDOUT:
internal
x1
x2
(
$(
)
x3
## END

#### crash dump

rm -f $TMP/*.json

OILS_CRASH_DUMP_DIR=$TMP $SH -c '
g() {
  local glocal="glocal"
  echo $(( 1 / 0 ))
}
f() {
  local flocal="flocal"
  shift
  FOO=bar g
}
readonly array=(A B C)
f "${array[@]}"
' dummy a b c

echo status=$?

# Just check that we can parse it.  TODO: Test properties.
python3 -c '
import json, sys
from pprint import pprint

for path in sys.argv[1:]:
  #print(path)
  with open(path) as f:
    dump = json.load(f)

    if 0:
      print("DUMP")
      print("status = %d" % dump["status"])
      print("pid = %d" % dump["pid"])

    if 0:
      # This has msg, source, line
      print("error %s" % dump["error"])
      print()

    if 0:
      # It would be nice if this has the proc name, I guess debug_stack has it
      print("argv_stack")
      pprint(dump["argv_stack"])
      print()

    if 0:
      print("debug_stack")
      pprint(dump["debug_stack"])
      print()

    if 0:
      print("var_stack")
      pprint(dump["var_stack"])

' $TMP/*.json
echo status=$?

## STDOUT:
status=1
status=0
## END

#### crash dump with source
# TODO: The failure is not propagated through 'source'.  Failure only happens
# on 'errexit'.
#rm -f $TMP/*.json
OILS_CRASH_DUMP_DIR=$TMP $SH -c "
set -o errexit
source $REPO_ROOT/spec/testdata/crash.sh
"
echo crash status=$?

# Now try to parse crash dumps
set -o xtrace
set -o errexit

# Enumerate crash dumps
ok=0
for dump in $TMP/*.json; do
  # Workaround for test issue: release binaries leave empty files because they
  # don't have the json module.
  if test -s $dump; then  # non-empty
    python2 -m json.tool $dump > /dev/null
    echo "OK $dump" >&2
    (( ++ok ))
  fi
done

if test $ok -ge 1; then  # make sure we parsed at least once crash dump
  echo 'found crash dump'
fi

## STDOUT:
crash status=1
found crash dump
## END

# NOTE: strict_arith has one case in arith.test.sh), strict_word-eval has a case in var-op-other.


#### --tool cat-em

$SH --tool cat-em zzZZ
echo status=$?

$SH --tool cat-em stdlib/ysh/math.ysh > /dev/null
echo status=$?

$SH --tool cat-em zzZZ stdlib/ysh/math.ysh > /dev/null
echo status=$?

## STDOUT:
status=1
status=0
status=1
## END

