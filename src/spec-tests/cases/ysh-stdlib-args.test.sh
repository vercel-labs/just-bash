## our_shell: ysh
## oils_failures_allowed: 1

#### Basic help message

source $LIB_YSH/args.ysh

parser (&spec) {
  # TODO: implement description, prog and help message
  description '''
     Reference Implementation
  '''
  prog "program-name"

  arg -v --verbose (Bool, help = "Verbose")
  arg src
  arg dst
}
var argv = ['-h', 'src', 'dst']

# Help
var args = parseArgs(spec, argv)

## STDOUT:
usage: program-name [-h] [-v] src dst

Reference Implementation

positional arguments:
 src
 dst

options:
 -h, --help           show this help message and exit
 -v, --verbose        Verbose
## END

