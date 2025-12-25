## our_shell: ysh
## oils_failures_allowed: 2

# dynamically generate procs

#### myproc.docString()

source $[ENV.REPO_ROOT]/spec/testdata/doc-comments.sh

pp test_ (myproc.docComment())
pp test_ (getVar('proc-none').docComment())

var f = get(__sh_function__, 'f')
pp test_ (f.docComment())

var g = get(__sh_function__, 'g')
pp test_ (g.docComment())

#pp proc

## STDOUT:
(Str)   "YSH-style proc"
(Null)   null
(Str)   "doc ' comment with \" quotes"
(Null)   null
## END

#### Mutate __sh_function__

f() { echo sh-func; }
f

setvar __sh_function__.f = 42

f

## STDOUT:
sh-func
## END


#### with eval builtin command, in global scope

for param in a b {
  eval """
  proc echo_$param(prefix) {
    echo \$prefix $param
  }
  """
  # We need to "escape" the for loop scope
  call setVar("echo_$param", getVar("echo_$param"), global=true)
}

echo_a prefix
echo_b prefix

## STDOUT:
prefix a
prefix b
## END

#### with eval builtin command, in local scope

proc p {
  for param in a b {
    eval """
    proc echo_$param(prefix) {
      echo \$prefix $param
    }
    """
    # We need to "escape" the for loop scope
    call setVar("echo_$param", getVar("echo_$param"), global=true)
  }

  # calling globals
  echo_a prefix
  echo_b prefix
}

p

# the global is available
echo_a prefix

## STDOUT:
prefix a
prefix b
prefix a
## END

#### with eval builtin command, reeturning Dict

func genProcs() {
  var result = {}
  for param in a b {
    eval """
    proc echo_$param(prefix) {
      echo \$prefix $param
    }
    """
    setvar result["echo_$param"] = getVar("echo_$param")
  }
  return (result)
}

var procs = genProcs()

# bind to global scope
for name in (procs) {
  call setVar("my_$name", procs[name], global=true)
}

my_echo_a prefix
my_echo_b prefix

## STDOUT:
prefix a
prefix b
## END

#### with parseCommand() then io->eval(), in local scope

proc p {
  var result = {}
  for param in a b {
    var s = """
    proc echo_$param (prefix) {
      echo \$prefix $param
    }
    """
    var cmd = parseCommand(s)
    #pp test_ (cmd)
    #pp asdl_ (cmd)

    # note: this creates its own frame, unlike 'eval'
    # call io->eval(cmd)

    var d = io->eval(cmd, to_dict=true)

    # bind my_echo_a globally
    call setVar("my_echo_$param", d["echo_$param"], global=true)
  }

  #= dict(vm.getFrame(0))

  my_echo_a in-proc
  my_echo_b in-proc
}

p

my_echo_a global
my_echo_b global

## STDOUT:
in-proc a
in-proc b
global a
global b
## END

#### with parseCommand() then io->eval(cmd, vars={out_dict: {}})

# This could take the place of evalToDict()?  But evalToDict() is useful in
# Hay?

func genProcs() {
  var vars = {out_dict: {}}
  for param in a b {
    var s = """
    proc echo_$param(prefix) {
      echo \$prefix $param
    }
    setvar out_dict.echo_$param = echo_$param
    """
    var cmd = parseCommand(s)
    call io->eval(cmd, vars=vars)
  }
  return (vars.out_dict)
}

var procs = genProcs()

var my_echo_a = procs.echo_a
var my_echo_b = procs.echo_b

my_echo_a prefix
my_echo_b prefix

## STDOUT:
prefix a
prefix b
## END

#### with evalToDict()

func genProcs() {
  var result = {}
  for param in a b {
    var s = """
    # This is defined locally
    proc echo_$param(prefix) {
      echo \$prefix $param
    }
    if false {
      = echo_$param
      var a = 42
      pp frame_vars_
    }
    """
    var cmd = parseCommand(s)

    var d = io->evalToDict(cmd)

    # accumulate
    setvar result["echo_$param"] = d["echo_$param"]
  }
  return (result)
}

var procs = genProcs()

var my_echo_a = procs.echo_a
var my_echo_b = procs.echo_b

my_echo_a prefix
my_echo_b prefix

## STDOUT:
prefix a
prefix b
## END


#### with runtime REFLECTION via __invoke__ - no parsing

# self is the first typed arg
proc p (prefix; self) {
  echo $prefix $[self.param]
}

# p is invoked with "self", which has self.param
var methods = Object(null, {__invoke__: p})

var procs = {}
for param in a b {
  setvar procs["echo_$param"] = Object(methods, {param: param})
}

var my_echo_a = procs.echo_a
var my_echo_b = procs.echo_b

if false {
  = my_echo_a
  = my_echo_b
  type -t my_echo_a
  type -t my_echo_b
}

# Maybe show an error if this is not value.Obj?
my_echo_a prefix
my_echo_b prefix

## STDOUT:
prefix a
prefix b
## END
