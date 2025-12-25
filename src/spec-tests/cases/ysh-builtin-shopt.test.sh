## oils_failures_allowed: 1

#### shopt supports long flags
shopt -p nullglob

shopt --set nullglob
shopt -p nullglob

shopt --unset nullglob
shopt -p nullglob

echo ---
## STDOUT:
shopt -u nullglob
shopt -s nullglob
shopt -u nullglob
---
## END

#### shopt supports 'set' options
shopt -p errexit

shopt --set errexit
false

echo should not get here
## status: 1
## STDOUT:
shopt -u errexit
## END


#### shopt --unset errexit { }
shopt --set oil:all

echo one

shopt --unset errexit {
  echo two
  false
  echo three
}

false
echo 'should not get here'

## status: 1
## STDOUT:
one
two
three
## END

#### shopt -p works correctly inside block
shopt --set parse_brace

shopt -p | grep inherit_errexit
shopt --set inherit_errexit {
  shopt -p | grep inherit_errexit
}

## STDOUT:
shopt -u inherit_errexit
shopt -s inherit_errexit
## END


#### shopt --set GROUP { }
shopt --set parse_brace

shopt -p | grep errexit
echo ---

shopt --set oil:all {
  #false
  #echo status=$?
  shopt -p | grep errexit
}
echo ---

shopt --set oil:upgrade {
  shopt -p | grep errexit
}
echo ---

shopt --set strict:all {
  shopt -p | grep errexit
}

# TODO: shopt --table should show the error value

## STDOUT:
shopt -u command_sub_errexit
shopt -u inherit_errexit
shopt -u strict_errexit
shopt -u verbose_errexit
---
shopt -s command_sub_errexit
shopt -s inherit_errexit
shopt -s strict_errexit
shopt -s verbose_errexit
---
shopt -s command_sub_errexit
shopt -s inherit_errexit
shopt -u strict_errexit
shopt -s verbose_errexit
---
shopt -u command_sub_errexit
shopt -u inherit_errexit
shopt -s strict_errexit
shopt -u verbose_errexit
## END

#### shopt and block status
shopt --set oil:all

shopt --unset errexit {
  false
}
# this is still 0, even though last command was 1
echo status=$?

## STDOUT:
status=0
## END

#### shopt usage error
shopt --set oil:all

echo one
shopt --set a {
  echo two
}
echo status=$?
## status: 2
## STDOUT:
one
## END

#### shopt -p

shopt -p errexit
shopt -p nullglob

echo --
shopt -p strict:all | head -n 3

echo --
shopt --set strict:all
shopt -p strict:all | head -n 3

## STDOUT:
shopt -u errexit
shopt -u nullglob
--
shopt -u strict_arg_parse
shopt -u strict_argv
shopt -u strict_arith
--
shopt -s strict_arg_parse
shopt -s strict_argv
shopt -s strict_arith
## END

#### TODO: all options as a table

shopt --table

# This is unlike shopt -p because

# 1) It shows ALL options, not just 'shopt' options
# 2) It shows it in QTT format?

# opt_name Str   value Bool
# errexit        true
# nounset        false
#
# Could also be T and F?  JSON is more obvious


## STDOUT:
## END

