## our_shell: ysh

#### default prompt doesn't confuse OSH and YSH

# Special ysh prefix if PS1 is set

# TODO: use PS1= temp binding
setglobal ENV.PS1 = r'\$ ' 
$[ENV.SH] -i -c 'echo "/$[get(ENV, "PS1")]/  /$[get(__defaults__, "PS1")]/"'
call propView(ENV)->erase('PS1')

# No prefix if it's not set, since we already have \s for YSH
$[ENV.SH] -i -c 'echo "/$[get(ENV, "PS1")]/  /$[get(__defaults__, "PS1")]/"'

## STDOUT:
/ysh \$ /  /null/
/null/  /\s-\v\$ /
## END

#### promptVal() with $ and w

var x = io.promptVal('$')

# We're not root, so it should be $
echo x=$x

var x = io.promptVal('w')

assert [x === $(pwd)]
echo pass

## STDOUT:
x=$
pass
## END

#### promptVal('w') respects ENV.HOME

# ENV not set in spec tests
var x = io.promptVal('w')
assert [x.startsWith('/')]

# now set it
setglobal ENV.HOME = '/home'

var x = io.promptVal('w')
assert [x.startsWith('~')]

## STDOUT:
## END

#### promptVal() with invalid chars

# \D{} will be supported with date and time functions
var x = io.promptVal('D')
echo x=$x

# something else
var x = io.promptVal('/')
echo x=$x

var x = io.promptVal('ZZ')
echo x=$x

## status: 3
## STDOUT:
x=<Error: \D{} not in promptVal()> 
x=<Error: \/ is invalid or unimplemented in $PS1> 
## END


#### ysh respects PS1

setglobal ENV.PS1 = r'myprompt\$ '
echo 'echo hi' | $[ENV.SH] -i

## STDOUT:
hi
^D
## END
## stderr-json: "ysh myprompt$ ysh myprompt$ "

#### ysh respects renderPrompt() over PS1

setglobal ENV.PS1 = r'myprompt\$ '

cat >yshrc <<'EOF'
func renderPrompt(io) {
  var parts = []
  call parts->append('hi')
  call parts->append(io.promptVal('$'))
  call parts->append(' ')
  return (join(parts))
}
EOF

echo 'echo hi' | $[ENV.SH] -i --rcfile yshrc

## STDOUT:
hi
^D
## END
## stderr-json: "hi$ hi$ "

#### renderPrompt() doesn't return string

setglobal ENV.PS1 = r'myprompt\$ '

cat >yshrc <<'EOF'
func renderPrompt(io) {
  return ([42, 43])
}
EOF

echo 'echo hi' | $[ENV.SH] -i --rcfile yshrc

## STDOUT:
hi
^D
## END
## stderr-json: "<Error: renderPrompt() should return Str, got List> <Error: renderPrompt() should return Str, got List> "


#### renderPrompt() raises error

setglobal ENV.PS1 = r'myprompt\$ '

cat >yshrc <<'EOF'
func renderPrompt(io) {
  error 'oops'
}
EOF

echo 'echo hi' | $[ENV.SH] -i --rcfile yshrc

## STDOUT:
hi
^D
## END
## stderr-json: "<Runtime error: oops><Runtime error: oops>"


#### renderPrompt() has wrong signature

setglobal ENV.PS1 = r'myprompt\$ '

cat >yshrc <<'EOF'
func renderPrompt() {
  error 'oops'
}
EOF

echo 'echo hi' | $[ENV.SH] -i --rcfile yshrc

## STDOUT:
hi
^D
## END
## stderr-json: "<Runtime error: Func 'renderPrompt' takes no positional args, but got 1><Runtime error: Func 'renderPrompt' takes no positional args, but got 1>"

