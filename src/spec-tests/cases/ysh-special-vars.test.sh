## our_shell: ysh

#### _this_dir in main and oshrc

$[ENV.SH] $[ENV.REPO_ROOT]/spec/testdata/module/this_dir.ysh

echo interactive

$[ENV.SH] -i --rcfile $[ENV.REPO_ROOT]/spec/testdata/module/this_dir.ysh -c 'echo -c'

## STDOUT:
hi from this_dir.ysh
$_this_dir = REPLACED/oils/spec/testdata/module
interactive
hi from this_dir.ysh
$_this_dir = REPLACED/oils/spec/testdata/module
-c
## END

#### _this_dir not set on stdin

echo ${_this_dir:-'not yet'}
## STDOUT:
not yet
## END


#### _this_dir in sourced module
source $[ENV.REPO_ROOT]/spec/testdata/module/this_dir.ysh
## STDOUT:
hi from this_dir.ysh
$_this_dir = REPLACED/oils/spec/testdata/module
## END


#### _this_dir not affected by 'cd'
cd /tmp
source $[ENV.REPO_ROOT]/spec/testdata/module/this_dir.ysh
## STDOUT:
hi from this_dir.ysh
$_this_dir = REPLACED/oils/spec/testdata/module
## END

#### _this_dir used with relative path
cd $[ENV.REPO_ROOT]
source spec/testdata/module/this_dir.ysh
## STDOUT:
hi from this_dir.ysh
$_this_dir = REPLACED/oils/spec/testdata/module
## END
