#### Turn off external binaries with shvar PATH='' {}
shopt --set parse_brace parse_proc

echo hi > file

# Note: this CACHES the lookup, so shvar has to clear cache when modifying it
cp -v file /tmp >&2
echo status=$?

# TODO: implement this, and call it whenever shvar mutates PATH?
# what about when PATH is mutated?   No leave it out for now.

# hash -r  # clear the cache, no longer necessary

shvar PATH='' {
  cp -v file /tmp
  echo status=$?

  # this also doesn't work
  command cp -v file /tmp
  echo status=$?
}

# Now it's available again
cp -v file /tmp >&2
echo status=$?

## STDOUT:
status=0
status=127
status=127
status=0
## END

#### More shvar PATH=''
shopt --set parse_brace command_sub_errexit parse_proc parse_ysh_expr_sub

shvar PATH='' {
  ( cp -v file /tmp >&2 )
  echo status=$?

  forkwait {
    cp -v file /tmp >&2
  }
  echo status=$?

  try {
    true $(cp -v file /tmp >&2)
  }
  echo _status $[_error.code]
}

## STDOUT:
status=127
status=127
_status 127
## END


#### builtins and externals not available in hay eval
shopt --set parse_brace parse_ysh_expr_sub
shopt --unset errexit

hay define Package

try {
  hay eval :result {
    Package foo {
      /bin/ls
    }
  }
}
echo "status $[_error.code]"

try {
  hay eval :result {
    cd /tmp
  }
}
echo "status $[_error.code]"

## STDOUT:
status 127
status 127
## END

#### procs in hay eval
shopt --set parse_brace parse_at parse_proc parse_ysh_expr_sub

hay define Package

proc outside {
  echo outside
  Package OUT
}

hay eval :result {
  outside

  proc inside {
    echo inside
  }

  inside
}

const args = result['children'][0]['args']
write --sep ' ' -- $[len(result['children'])] @args

## STDOUT:
outside
inside
1 OUT
## END


#### variables mutated within hay eval don't persist
shopt --set parse_brace

hay define Package

setvar x = 42

hay eval :result {
  Package foo

  setvar x = 1
}

echo "x = $x"

## STDOUT:
x = 42
## END



#### hay at top level allows arbitrary commands
shopt --set parse_brace

hay define Package

Package $(seq 2) {
  seq 3 4
}

json write (_hay()) | jq '.children[0].args' > actual.txt

diff -u - actual.txt <<EOF
[
  "1",
  "2"
]
EOF

hay eval :result {
  echo inside
  Package $(seq 2) {
    seq 3 4
  }
}

## status: 127
## STDOUT:
3
4
inside
## END

