## our_shell: ysh

# OLD test cases, collected during YSH evoluation

#### Empty array and assignment builtin (regression)
shopt --unset no_osh_builtins

# Bug happens with shell arrays too
empty=()
declare z=1 "${empty[@]}"
echo z=$z
## STDOUT:
z=1
## END

