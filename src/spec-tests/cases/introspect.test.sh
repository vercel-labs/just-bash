## compare_shells: bash

# Test call stack introspection.  There are a bunch of special variables
# defined here:
#
# https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html
# 
# - The shell function ${FUNCNAME[$i]} is defined in the file
#   ${BASH_SOURCE[$i]} and called from ${BASH_SOURCE[$i+1]}
#
# - ${BASH_LINENO[$i]} is the line number in the source file
#   (${BASH_SOURCE[$i+1]}) where ${FUNCNAME[$i]} was called (or
#   ${BASH_LINENO[$i-1]} if referenced within another shell function). 
#
# - For instance, ${FUNCNAME[$i]} was called from the file
#   ${BASH_SOURCE[$i+1]} at line number ${BASH_LINENO[$i]}. The caller builtin
#   displays the current call stack using this information. 
#
# So ${BASH_SOURCE[@]} doesn't line up with ${BASH_LINENO}.  But
# ${BASH_SOURCE[0]} does line up with $LINENO!
#
# Geez.
#
# In other words, BASH_SOURCE is about the DEFINITION.  While FUNCNAME and
# BASH_LINENO are about the CALL.


#### ${FUNCNAME[@]} array
g() {
  argv.py "${FUNCNAME[@]}"
}
f() {
  argv.py "${FUNCNAME[@]}"
  g
  argv.py "${FUNCNAME[@]}"
}
f
## STDOUT: 
['f']
['g', 'f']
['f']
## END

#### FUNCNAME with source (scalar or array)
cd $REPO_ROOT

# Comments on bash quirk:
# https://github.com/oilshell/oil/pull/656#issuecomment-599162211

f() {
  . spec/testdata/echo-funcname.sh
}
g() {
  f
}

g
echo -----

. spec/testdata/echo-funcname.sh
echo -----

argv.py "${FUNCNAME[@]}"

# Show bash inconsistency.  FUNCNAME doesn't behave like a normal array.
case $SH in 
  (bash)
    echo -----
    a=('A')
    argv.py '  @' "${a[@]}"
    argv.py '  0' "${a[0]}"
    argv.py '${}' "${a}"
    argv.py '  $' "$a"
    ;;
esac

## STDOUT:
['  @', 'source', 'f', 'g']
['  0', 'source']
['${}', 'source']
['  $', 'source']
-----
['  @', 'source']
['  0', 'source']
['${}', 'source']
['  $', 'source']
-----
[]
## END
## BUG bash STDOUT:
['  @', 'source', 'f', 'g']
['  0', 'source']
['${}', 'source']
['  $', 'source']
-----
['  @']
['  0', '']
['${}', '']
['  $', '']
-----
[]
-----
['  @', 'A']
['  0', 'A']
['${}', 'A']
['  $', 'A']
## END


#### BASH_SOURCE and BASH_LINENO scalar or array (e.g. for virtualenv)
## SKIP: $LINENO tracking in complex contexts not implemented
cd $REPO_ROOT

# https://github.com/pypa/virtualenv/blob/master/virtualenv_embedded/activate.sh
# https://github.com/akinomyoga/ble.sh/blob/6f6c2e5/ble.pp#L374

argv.py "$BASH_SOURCE"  # SimpleVarSub
argv.py "${BASH_SOURCE}"  # BracedVarSub
argv.py "$BASH_LINENO"  # SimpleVarSub
argv.py "${BASH_LINENO}"  # BracedVarSub
argv.py "$FUNCNAME"  # SimpleVarSub
argv.py "${FUNCNAME}"  # BracedVarSub
echo __
source spec/testdata/bash-source-string.sh

## STDOUT:
['']
['']
['']
['']
['']
['']
__
['spec/testdata/bash-source-string.sh']
['spec/testdata/bash-source-string.sh']
['11']
['11']
____
['spec/testdata/bash-source-string2.sh']
['spec/testdata/bash-source-string2.sh']
['11']
['11']
## END


#### ${FUNCNAME} with prefix/suffix operators

check() {
  argv.py "${#FUNCNAME}"
  argv.py "${FUNCNAME::1}"
  argv.py "${FUNCNAME:1}"
}
check
## STDOUT:
['5']
['c']
['heck']
## END

#### operators on FUNCNAME
check() {
  argv.py "${FUNCNAME}"
  argv.py "${#FUNCNAME}"
  argv.py "${FUNCNAME::1}"
  argv.py "${FUNCNAME:1}"
}
check
## status: 0
## STDOUT:
['check']
['5']
['c']
['heck']
## END

#### ${FUNCNAME} and "set -u" (OSH regression)
set -u
argv.py "$FUNCNAME"
## status: 1
## stdout-json: ""

#### $((BASH_LINENO)) (scalar form in arith)
## SKIP: $LINENO tracking in complex contexts not implemented
check() {
  echo $((BASH_LINENO))
}
check
## stdout: 4

#### ${BASH_SOURCE[@]} with source and function name
cd $REPO_ROOT

argv.py "${BASH_SOURCE[@]}"
source spec/testdata/bash-source-simple.sh
f
## STDOUT: 
[]
['spec/testdata/bash-source-simple.sh']
['spec/testdata/bash-source-simple.sh']
## END

#### ${BASH_SOURCE[@]} with line numbers
## SKIP: Test data directory not available
cd $REPO_ROOT

$SH spec/testdata/bash-source.sh
## STDOUT: 
['begin F funcs', 'f', 'main']
['begin F files', 'spec/testdata/bash-source.sh', 'spec/testdata/bash-source.sh']
['begin F lines', '21', '0']
['G funcs', 'g', 'f', 'main']
['G files', 'spec/testdata/bash-source-2.sh', 'spec/testdata/bash-source.sh', 'spec/testdata/bash-source.sh']
['G lines', '15', '21', '0']
['end F funcs', 'f', 'main']
['end F', 'spec/testdata/bash-source.sh', 'spec/testdata/bash-source.sh']
['end F lines', '21', '0']
## END

#### ${BASH_LINENO[@]} is a stack of line numbers for function calls
## SKIP: $LINENO tracking in complex contexts not implemented
# note: it's CALLS, not DEFINITIONS.
g() {
  argv.py G "${BASH_LINENO[@]}"
}
f() {
  argv.py 'begin F' "${BASH_LINENO[@]}"
  g  # line 6
  argv.py 'end F' "${BASH_LINENO[@]}"
}
argv.py ${BASH_LINENO[@]}
f  # line 9
## STDOUT: 
[]
['begin F', '10']
['G', '6', '10']
['end F', '10']
## END

#### Locations with temp frame
## SKIP: Temp binding edge cases not implemented

cd $REPO_ROOT

$SH spec/testdata/bash-source-pushtemp.sh

## STDOUT:
F
G
STACK:spec/testdata/bash-source-pushtemp.sh:g:3
STACK:spec/testdata/bash-source-pushtemp.sh:f:19
STACK:spec/testdata/bash-source-pushtemp.sh:main:0
## END

#### Locations when sourcing
## SKIP: Interactive shell invocation not implemented

cd $REPO_ROOT

# like above test case, but we source

# bash location doesn't make sense:
# - It says 'source' happens at line 1 of bash-source-pushtemp.  Well I think
# - It really happens at line 2 of '-c' !    I guess that's to line up
#   with the 'main' frame

$SH -c 'true;
source spec/testdata/bash-source-pushtemp.sh'

## STDOUT:
F
G
STACK:spec/testdata/bash-source-pushtemp.sh:g:3
STACK:spec/testdata/bash-source-pushtemp.sh:f:19
STACK:spec/testdata/bash-source-pushtemp.sh:source:2
## END

#### Sourcing inside function grows the debug stack
## SKIP: Test data directory not available

cd $REPO_ROOT

$SH spec/testdata/bash-source-source.sh

## STDOUT:
F
G
STACK:spec/testdata/bash-source-pushtemp.sh:g:3
STACK:spec/testdata/bash-source-pushtemp.sh:f:19
STACK:spec/testdata/bash-source-pushtemp.sh:source:2
STACK:spec/testdata/bash-source-source.sh:mainfunc:6
STACK:spec/testdata/bash-source-source.sh:main2:10
STACK:spec/testdata/bash-source-source.sh:main1:13
STACK:spec/testdata/bash-source-source.sh:main:0
## END
