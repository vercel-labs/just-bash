## oils_failures_allowed: 0

# Hay Metaprogramming

#### Conditional Inside Blocks
shopt --set ysh:all

hay define Rule

const DEBUG = true

Rule one {
  if (DEBUG) {
    deps = 'foo'
  } else {
    deps = 'bar'
  }
}

json write (_hay()) | jq '.children[0]' > actual.txt

diff -u - actual.txt <<EOF
{
  "type": "Rule",
  "args": [
    "one"
  ],
  "children": [],
  "attrs": {
    "deps": "foo"
  }
}
EOF

## STDOUT:
## END


#### Conditional Outside Block
shopt --set ysh:all

hay define Rule

const DEBUG = true

if (DEBUG) {
  Rule two {
    deps = 'spam'
  } 
} else {
  Rule two {
    deps = 'bar'
  } 
}

json write (_hay()) | jq '.children[0].attrs' > actual.txt

diff -u - actual.txt <<EOF
{
  "deps": "spam"
}
EOF

## STDOUT:
## END


#### Iteration Inside Block
shopt --set ysh:all

hay define Rule

Rule foo {
  var d = {}
  # private var with _
  for name_ in spam eggs ham {
    setvar d[name_] = true
  }
}

json write (_hay()) | jq '.children[0].attrs' > actual.txt

# For loop name leaks!  Might want to make it "name_" instead!

#cat actual.txt

diff -u - actual.txt <<EOF
{
  "d": {
    "spam": true,
    "eggs": true,
    "ham": true
  }
}
EOF


## STDOUT:
## END


#### Iteration Outside Block
shopt --set ysh:all

hay define Rule

for name in spam eggs ham {
  Rule $name {
    path = "/usr/bin/$name"
  }
}

json write (_hay()) | jq '.children[].attrs' > actual.txt

diff -u - actual.txt <<EOF
{
  "path": "/usr/bin/spam"
}
{
  "path": "/usr/bin/eggs"
}
{
  "path": "/usr/bin/ham"
}
EOF

## STDOUT:
## END


#### Iteration outside Hay node - example from Samuel

shopt --set ysh:all

hay define task

# BUG with hay eval!
hay eval :result {
  var all_hellos = [ "You", "lovely", "people", "Chuck Norris" ]
  for hello in (all_hellos) {
    task "Say $hello" {
      var extend = "Say Hello"
      var overrides = {
        WORD: hello
      }
    }
  }
}

json write (result) | jq '.children[].attrs' > actual.txt

#json write (_hay()) | jq '.children[].attrs' > actual.txt

diff -u - actual.txt <<EOF
{
  "extend": "Say Hello",
  "overrides": {
    "WORD": "You"
  }
}
{
  "extend": "Say Hello",
  "overrides": {
    "WORD": "lovely"
  }
}
{
  "extend": "Say Hello",
  "overrides": {
    "WORD": "people"
  }
}
{
  "extend": "Say Hello",
  "overrides": {
    "WORD": "Chuck Norris"
  }
}
EOF
echo status=$?

## STDOUT:
status=0
## END

#### Proc Inside Block
shopt --set ysh:all

hay define rule  # lower case allowed

proc p(name; out) {
  echo 'p'
  call out->setValue(name)
}

rule hello {
  var eggs = ''
  var bar = ''

  p spam (&eggs)
  p foo (&bar)
}

json write (_hay()) | jq '.children[0].attrs' > actual.txt

diff -u - actual.txt <<EOF
{
  "eggs": "spam",
  "bar": "foo"
}
EOF

## STDOUT:
p
p
## END



#### Proc That Defines Block
shopt --set ysh:all

hay define Rule

proc myrule(name) {
  Rule $name {
    path = "/usr/bin/$name"
  }
}

myrule spam
myrule eggs
myrule ham

json write (_hay()) | jq '.children[].attrs' > actual.txt

diff -u - actual.txt <<EOF
{
  "path": "/usr/bin/spam"
}
{
  "path": "/usr/bin/eggs"
}
{
  "path": "/usr/bin/ham"
}
EOF

## STDOUT:
## END

#### Param scope issue (from Zulip, 2025-02)
shopt --set ysh:all

hay define Service

setvar variant = 'local'

proc gen_service(; ; variant=null) {

  pp test_ (variant)

  Service auth.example.com {    # node taking a block
    pp test_ (variant)
    if (variant === 'local') {  # condition
      port = 8001
    } else {
      port = 80
    }
  }
}

gen_service (variant='remote')
const result = _hay()
json write (result)

## STDOUT:
(Str)   "remote"
(Str)   "remote"
{
  "source": null,
  "children": [
    {
      "type": "Service",
      "args": [
        "auth.example.com"
      ],
      "children": [],
      "attrs": {
        "port": 80
      }
    }
  ]
}
## END


#### Hay node with exression block arg now allowed - Node (; ; ^(var x = 1))
shopt --set ysh:all

hay define Foo

Foo (; ; ^(echo hi))

## status: 1
## STDOUT:
## END
