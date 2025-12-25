## oils_failures_allowed: 3

# Hay: Hay Ain't YAML

#### hay builtin usage

hay define
echo status=$?

hay define -- package user
echo status=$?

hay pp | wc -l | read n
echo read $?
test $n -gt 0
echo greater $?

## STDOUT:
status=2
status=0
read 0
greater 0
## END

#### hay reset
shopt --set parse_brace

hay define package

hay eval :a {
  package foo
  echo "package $?"
}

hay reset  # no more names

echo "reset $?"

hay eval :b {
  package foo
  echo "package $?"
}

## status: 127
## STDOUT:
package 0
reset 0
## END


#### hay eval can't be nested
shopt --set parse_brace

hay eval :foo {
  echo foo
  hay eval :bar {
    echo bar
  }
}
## status: 127
## STDOUT:
foo
## END

#### hay names at top level
shopt --set parse_brace parse_at parse_ysh_expr_sub
shopt --unset errexit

hay define Package

Package one
echo status=$?

setvar args = _hay()['children'][0]['args']
write --sep ' ' $[len(_hay()['children'])] @args

hay eval :result {
  Package two
  echo status=$?
}

setvar args = result['children'][0]['args']
write --sep ' ' $[len(result['children'])] @args

Package three
echo status=$?

setvar args = _hay()['children'][0]['args']
write --sep ' ' $[len(_hay()['children'])] $[_hay()['children'][0]['args'][0]]

## STDOUT:
status=0
1 one
status=0
1 two
status=0
1 three
## END

#### Parsing Nested Attributes nodes (bug fix)

shopt --set parse_brace parse_equals

hay define Package/License

Package glibc {
  version = '1.0'

  License {
    path = 'LICENSE.txt'
  }

  other = 'foo'
}

json write (_hay()) | jq '.children[0].children[0].attrs' > actual.txt

diff -u - actual.txt <<EOF
{
  "path": "LICENSE.txt"
}
EOF

invalid = 'syntax'  # parse error

## status: 2
## STDOUT:
## END

#### hay eval Attr node, and JSON
shopt --set parse_brace parse_equals

hay define Package User

hay eval :result {
  Package foo {
    # not doing floats now
    int = 42
    bool = true
    mynull = null
    mystr = $'spam\n'

    mylist = [5, 'foo', {}]
    # TODO: Dict literals need to be in insertion order!
    #mydict = {alice: 10, bob: 20}
  }

  User alice
}

# Note: using jq to normalize
json write (result) | jq . > out.txt

diff -u - out.txt <<EOF
{
  "source": null,
  "children": [
    {
      "type": "Package",
      "args": [
        "foo"
      ],
      "children": [],
      "attrs": {
        "int": 42,
        "bool": true,
        "mynull": null,
        "mystr": "spam\n",
        "mylist": [
          5,
          "foo",
          {}
        ]
      }
    },
    {
      "type": "User",
      "args": [
        "alice"
      ]
    }
  ]
}
EOF

echo "diff $?"

## STDOUT:
diff 0
## END

#### hay eval shell node, and JSON
shopt --set parse_brace parse_equals

hay define TASK

hay eval :result {
  TASK { echo hi }

  TASK {
    echo one
    echo two
  }
}

#= result
json write (result) | jq . > out.txt

diff -u - out.txt <<'EOF'
{
  "source": null,
  "children": [
    {
      "type": "TASK",
      "args": [],
      "location_str": "[ stdin ]",
      "location_start_line": 6,
      "code_str": "         echo hi "
    },
    {
      "type": "TASK",
      "args": [],
      "location_str": "[ stdin ]",
      "location_start_line": 8,
      "code_str": "        \n    echo one\n    echo two\n  "
    }
  ]
}
EOF

## STDOUT:
## END


#### _hay() register
shopt --set parse_paren parse_brace parse_equals parse_proc parse_ysh_expr_sub

hay define user

var result = {}

hay eval :result {

  user alice
  # = _hay()
  write -- $[len(_hay()['children'])]

  user bob
  setvar result = _hay()
  write -- $[len(_hay()['children'])]

}

# TODO: Should be cleared here
setvar result = _hay()
write -- $[len(_hay()['children'])]

## STDOUT:
1
2
0
## END


#### haynode builtin can define nodes
shopt --set parse_paren parse_brace parse_equals parse_proc parse_ysh_expr_sub

# It prints JSON by default?  What about the code blocks?
# Or should there be a --json flag?

hay eval :result {

  # note that 'const' is required because haynode isn't capitalized
  haynode parent alice {
    const age = '50'
    
    haynode child bob {
      # TODO: Is 'const' being created in the old ENCLOSING frame?  Not the new
      # ENCLOSED one?
      const age = '10'
    }

    haynode child carol {
      const age = '20'
    }

    const other = 'str'
  }
}

#= result
write -- 'level 0 children' $[len(result['children'])]
write -- 'level 1 children' $[len(result['children'][0]['children'])]

hay eval :result {
  haynode parent foo
  haynode parent bar
}
write -- 'level 0 children' $[len(result['children'])]


## STDOUT:
level 0 children
1
level 1 children
2
level 0 children
2
## END


#### haynode: usage errors (name or block required)
shopt --set parse_brace parse_equals parse_proc parse_ysh_expr_sub

# should we make it name or block required?
# license { ... } might be useful?

try {
  hay eval :result {
    haynode package
  }
}
echo "haynode attr $[_error.code]"
var result = _hay()
echo "LEN $[len(result['children'])]"

# requires block arg
try {
  hay eval :result {
    haynode TASK build
  }
}
echo "haynode code $[_error.code]"
echo "LEN $[len(result['children'])]"

echo ---
hay define package TASK

try {
  hay eval :result {
    package
  }
}
echo "define attr $[_error.code]"
echo "LEN $[len(result['children'])]"

try {
  hay eval :result {
    TASK build
  }
}
echo "define code $[_error.code]"
echo "LEN $[len(result['children'])]"

## STDOUT:
haynode attr 2
LEN 0
haynode code 2
LEN 0
---
define attr 2
LEN 0
define code 2
LEN 0
## END

#### haynode: shell nodes require block args; attribute nodes don't

shopt --set parse_brace parse_equals parse_proc parse_ysh_expr_sub

hay define package TASK

try {
  hay eval :result {
    package glibc > /dev/null
  }
}
echo "status $[_error.code]"


try {
  hay eval :result {
    TASK build
  }
}
echo "status $[_error.code]"

## STDOUT:
status 0
status 2
## END


#### hay eval with shopt -s ysh:all
shopt --set parse_brace parse_equals parse_proc

hay define Package

const x = 'foo bar'

hay eval :result {
  Package foo {
    # set -e should be active!
    #false

    version = '1.0'

    # simple_word_eval should be active!
    write -- $x
  }
}

## STDOUT:
foo bar
## END

#### Attr block with duplicate names

shopt --set ysh:upgrade

hay define Package

Package cpython {
  version = '3.11'
  version = '3.12'
}

= _hay()

## status: 1
## STDOUT:
## END

#### Scope of Variables Inside Hay Blocks

shopt --set ysh:all

hay define package
hay define deps/package

hay eval :result {

  const URL_PATH = 'downloads/foo.tar.gz'

  package foo {
    echo "location = https://example.com/$URL_PATH"
    echo "backup = https://archive.example.com/$URL_PATH"
  }

  # Note: PushTemp() happens here
  deps spam {
    # OVERRIDE
    const URL_PATH = 'downloads/spam.tar.gz'

    const URL2 = 'downloads/spam.tar.xz'

    package foo {
      # this is a global
      echo "deps location https://example.com/$URL_PATH"
      echo "deps backup https://archive.example.com/$URL2"
    }
  }

  echo "AFTER $URL_PATH"

}

## STDOUT:
location = https://example.com/downloads/foo.tar.gz
backup = https://archive.example.com/downloads/foo.tar.gz
deps location https://example.com/downloads/spam.tar.gz
deps backup https://archive.example.com/downloads/spam.tar.xz
AFTER downloads/foo.tar.gz
## END

#### Nested bare assignment
shopt --set ysh:all

hay define Package/Deps

Package {
  x = 10
  Deps {
    # this is a const
    x = 20
  }
}

json write (_hay())

## STDOUT:
{
  "source": null,
  "children": [
    {
      "type": "Package",
      "args": [],
      "children": [
        {
          "type": "Deps",
          "args": [],
          "children": [],
          "attrs": {
            "x": 20
          }
        }
      ],
      "attrs": {
        "x": 10
      }
    }
  ]
}
## END

#### Param with same name as Hay attribute
shopt --set ysh:all

# Danilo reported this on Zulip

hay define Service

proc gen-service(; ; variant = null) {
  Service {
    variant = variant
    port = 80
  }
}

gen-service 
gen-service (variant = 'z')

var attrs = _hay().children[0].attrs
json write (attrs)

## STDOUT:
{
  "variant": null,
  "port": 80
}
## END


#### hay define and then an error
shopt --set parse_brace parse_equals parse_proc

hay define Package/License User TASK

hay pp defs > /dev/null

hay eval :result {
  User bob
  echo "user $?"

  Package cppunit
  echo "package $?"

  TASK build {
    configure
  }
  echo "TASK $?"

  Package unzip {
    version = '1.0'

    License FOO {
      echo 'inside'
    }
    echo "license $?"

    License BAR
    echo "license $?"

    zz foo
    echo 'should not get here'
  }
}

echo 'ditto'

## status: 127
## STDOUT:
user 0
package 0
TASK 0
inside
license 0
license 0
## END

#### parseHay()
shopt --set parse_proc

const config_path = "$REPO_ROOT/spec/testdata/config/ci.oil"
const block = parseHay(config_path)

# Are blocks opaque?
{
  = block
} | wc -l | read n

# Just make sure we got more than one line?
if test "$n" -eq 1; then
  echo "OK"
fi

## STDOUT:
OK
## END


#### Code Blocks: parseHay() then shvar _DIALECT= { evalHay() }
shopt --set parse_brace parse_proc parse_ysh_expr_sub

hay define TASK

const config_path = "$REPO_ROOT/spec/testdata/config/ci.oil"
const block = parseHay(config_path)

shvar _DIALECT=sourcehut {
  const d = evalHay(block)
}

const children = d['children']
write 'level 0 children' $[len(children)] ---

# TODO: Do we need @[] for array expression sub?
write 'child 0' $[children[0].type] $[join(children[0].args)] ---
write 'child 1' $[children[1].type] $[join(children[1].args)] ---

## STDOUT:
level 0 children
2
---
child 0
TASK
cpp
---
child 1
TASK
publish-html
---
## END

#### evalHay() usage
shopt -s parse_brace parse_ysh_expr_sub

try {
  var d = evalHay()
}
echo status $[_error.code]

try {
  var d = evalHay(3)
}
echo status $[_error.code]

try {
  var d = evalHay(^(echo hi), 5)
}
echo status $[_error.code]

## STDOUT:
status 3
status 3
status 3
## END

#### Attribute / Data Blocks (package-manager)
shopt --set parse_proc parse_ysh_expr_sub

const path = "$REPO_ROOT/spec/testdata/config/package-manager.oil"

const block = parseHay(path)

hay define Package
const d = evalHay(block)
write 'level 0 children' $[len(d['children'])]
write 'level 1 children' $[len(d['children'][1]['children'])]

## STDOUT:
level 0 children
3
level 1 children
0
## END


#### Typed Args to Hay Node
shopt --set ysh:all

hay define when

# Hm I get 'too many typed args'
# Ah this is because of 'haynode'
# 'haynode' could silently pass through blocks and typed args?

when NAME [x > 0] { 
  const version = '1.0'
  const other = 'str'
}

= _hay()

## STDOUT:
## END


#### OSH and hay (dynamic parsing)

source $REPO_ROOT/spec/testdata/config/osh-hay.osh

## STDOUT:
backticks
eval
TYPE TASK
CODE         
    echo `echo task backticks`
    eval 'echo task eval'
  ___
## END

#### CODE node provides code_str, serialized code - issue #2050
shopt --set ysh:all

hay define Package
hay define Package/INSTALL

Package {
  name = "osh"
  INSTALL {
    #echo hi

    # The block causes a bug?  Nesting?
    cd dist {
      ./install
    }
  }
}

= _hay()

## STDOUT:
## END

#### Proc within Hay node
shopt --set ysh:all

hay define Package

Package cpython {
  version = '3.11'

  proc build {
    # procs have to capture
    echo "version=$version"
    make
  }
}

# OK we have the proc
= _hay()

var build_proc = _hay().children[0].attrs.build

= build_proc

build_proc

#json write (_hay())

## STDOUT:
## END


#### Using Hay node from another module
shopt --set ysh:all

hay define Package/INSTALL

use $[ENV.REPO_ROOT]/spec/testdata/config/use-hay.ysh

#pp test_ (_hay())
json write (_hay().children[0].attrs)

## STDOUT:
{
  "version": "3.3"
}
## END

#### Defining Hay node in another module
shopt --set ysh:all

use $[ENV.REPO_ROOT]/spec/testdata/config/define-hay.ysh

Package foo {
  version = '3.3'
  INSTALL {
    echo version=$version
  }
}

json write (_hay().children[0].attrs)

## STDOUT:
{
  "version": "3.3"
}
## END


#### Using Hay with --eval flags
shopt --set ysh:all

echo 'hay define Package' >pre.ysh 

echo '
Package cpython {
  version = "3.12"
  url = "https://python.org/release/$version/"
  proc build {
    echo "version = $version, url = $url"
  }
}
' >def.hay

# TODO:
# null_replacer=true
# JavaScript has a second "replacer" arg, which can be a function, or an array
# I guess you can specify replacer=null
#
# Invert it: Or maybe type_errors=true
#
# When type_errors=false (default), any unserializable value becomes null

echo 'json write (_hay().children[0], type_errors=false)' > stage-1.ysh

# Stage 1

... $[ENV.SH] -o ysh:all
  # TODO: restore purity
  #--eval-pure pre.ysh
  #--eval-pure def.hay
  #--eval-pure stage-1.ysh
  --eval pre.ysh
  --eval def.hay
  --eval stage-1.ysh
  -c '' 
  || true
  ;

# Stage 2

echo '
var pkg = _hay().children[0]
var build_proc = pkg.attrs.build
build_proc
' > stage-2.ysh

# Stage 1

... $[ENV.SH] -o ysh:all
  # TODO: restore purity
  #--eval-pure pre.ysh
  #--eval-pure def.hay
  --eval pre.ysh
  --eval def.hay
  --eval stage-2.ysh  # This one isn't pure
  -c ''
  ;


## STDOUT:
{
  "type": "Package",
  "args": [
    "cpython"
  ],
  "children": [],
  "attrs": {
    "version": "3.12",
    "url": "https://python.org/release/3.12/",
    "build": null
  }
}
version = 3.12, url = https://python.org/release/3.12/
## END
