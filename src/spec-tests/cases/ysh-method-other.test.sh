## our_shell: ysh
## oils_failures_allowed: 1

#### Command.sourceCode() on literal block: p { echo hi }

proc p ( ; ; ; block) {
  var src = block.sourceCode()
  echo $[src.code_str] > out.ysh

  # don't assert this yet, because whitespace can change
  call src->erase('code_str')

  json write (src)

  # New location is out.ysh:4
  $[ENV.SH] out.ysh || true

  echo ---

  #echo 'zz (' > bad.ysh

  # Original location is [ stdin ]:20
  ... $[ENV.SH]
    --location-str $[src.location_str]
    --location-start-line $[src.location_start_line]
    out.ysh
    || true
    ;
}

p { 
  echo 1
  echo 2
  false
  echo 3
}

## STDOUT:
{
  "location_str": "[ stdin ]",
  "location_start_line": 22
}
1
2
---
1
2
## END


#### Command.sourceCode() on Expr: ^(echo 1; echo 2)

var cmd = ^(echo 1; echo 2; false)

var src = cmd.sourceCode()

assert [null === src]

# Test passing it
proc p ( ; ; ; block) {
  pp test_ (block)
  assert [null === block.sourceCode()]
}

p ( ; ; cmd)

## STDOUT:
<Command>
## END


#### Command.sourceCode() works with reparsing, e.g. backticks

shopt --unset no_osh_builtins  # allow alias builtin

# TODO: fix this bug - same as Hay bug

proc p ( ; ; ; block) {
  var src = block.sourceCode()

  pp test_ (src.code_str)

  # Re-parsing messes this up
  #echo $[src.code_str]
  #echo
}

shopt --unset no_parse_backticks

p {
  echo "greeting `echo backticks`"
}

shopt --unset no_parse_sh_arith

p {
  array_lhs[i++]=y
}

shopt --set expand_aliases

alias e='echo alias'

p {
  e foo
}

# alias that combines the problematic features
alias e2='a[0+2+3]=x; echo `echo bacticks`'

p {
  e2 zzz
  #e2 e2 zzz
}

## STDOUT:
(Str)   "   \n  echo \"greeting `echo backticks`\"\n"
(Str)   "   \n  array_lhs[i++]=y\n"
(Str)   "   \n  e foo\n"
(Str)   "   \n  e2 zzz\n"
## END


#### Command.sourceCode() works in nested blocks

shopt --unset no_osh_builtins  # allow alias builtin

proc p ( ; ; ; block) {
  var src = block.sourceCode()

  pp test_ (src.code_str)

  call io->eval(block)
}


shopt --unset no_parse_backticks
shopt --unset no_parse_sh_arith
shopt --set expand_aliases

p { 
  echo foo
}

p { 
  #a[0]=`echo foo`
  echo foo
  p { 
    #a[inner]=`echo foo`
    echo inner
  }
}

## STDOUT:
## END
