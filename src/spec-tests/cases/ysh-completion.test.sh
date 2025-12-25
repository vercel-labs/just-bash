## oils_failures_allowed: 6

#### compexport

compexport -c 'hay'

## STDOUT:
"haynode "
"hay "
## END

#### compexport with multi-line commands

# TODO: Why do we get 3 copies of echo?
# compexport -c $'for x in y; do\nec'

compexport -c $'for x in y; do\ncompl'


## STDOUT:
"complete "
## END

#### redirect completions are quoted

touch "can't touch this"

compexport -c 'echo hi > c'
## STDOUT:
"echo hi > can\\'t\\ touch\\ this"
## END

#### dir completions have trailing slash

mkdir -p "can't touch this"
compexport -c 'cd ca'

## STDOUT:
"cd can\\'t\\ touch\\ this/"
## END


#### complete -F strings are not quoted again

. $REPO_ROOT/testdata/completion/quoting.bash

compexport -c 'pq-argv c'
echo

# note: excluding "can't" because there's an intentional bug
compexport -c 'sq-argv ch'

# Quoting doesn't match bash exactly, but it definitely works interactively!

## STDOUT:
"pq-argv $'can\\'t' "
"pq-argv 'ch with space' "
"pq-argv checkout "
"pq-argv cherry "

"sq-argv 'ch with space' "
"sq-argv 'checkout' "
"sq-argv 'cherry' "
## END

#### complete -W quoting

. $REPO_ROOT/testdata/completion/quoting.bash

compexport -c 'q2-argv c'
echo

## STDOUT:
"q2-argv can\\'t "
"q2-argv checkout "
"q2-argv cherry "
## END

#### filenames are completed

touch foo bar baz

compexport -c $'echo ba'


## STDOUT:

TODO: Is the order reversed?  I guess this is file system order, which is
nondeterministic.  YSH can sort them

echo baz 
echo bar 
## END

#### complete both -W and -F: words and functions

__git() {
  COMPREPLY=(corn dill)
}
complete -W 'ale $(echo bean)' -F __git GIT

compexport -c 'GIT '

## STDOUT:
Hm they are kinda reversed, I want to fix that.  This is true even in Python
though, weird.
## END


#### -o default is an "else action", when zero are shown

touch file1 file2

echo '-- nothing registered'
compexport -c 'GIT '

__git() {
  #argv.py "$@"
  COMPREPLY=(foo bar)
}

complete -F __git GIT

echo '-- func'
compexport -c 'GIT '

complete -F __git -o default GIT
echo '-- func default'
compexport -c 'GIT '

__git() {
  # don't show anything
  true
}

# have to RE-REGISTER after defining function!  Hm
complete -F __git -o default GIT

echo '-- empty func default'
compexport -c 'GIT '

# Is the order reversed?
# Does GNU readline always sort them?

## STDOUT:
TODO
git
## END

# TODO:
# --begin --end  
# --table ?  For mulitiple completions
# compatible with -C ?
# --trace - show debug_f tracing on stderr?  Would be very nice!

#### git completion space issue (disabled for old git, e.g. v2.17.1)

# Hack for lenny: version detection for 2.17.1 on Ubuntu 18.02
if ! git --list-cmds=list-complete >/dev/null; then
  cat <<'EOF'
status=0
"git cherry "
"git cherry-pick "
"git checkout "
EOF
  return
fi

. $REPO_ROOT/testdata/completion/git-completion.bash
echo status=$?

#complete

# Bug: it has an extra \ on it
compexport -c 'git ch'

## status: 0
## STDOUT:
status=0
"git cherry "
"git cherry-pick "
"git checkout "
## END

#### Complete Filenames with bad characters

touch hello
touch $'hi\xffthere'

compexport -c 'echo h'
## STDOUT:
TODO
## END

#### Complete Command with bad characters

touch foo fooz

compexport -c $'echo "bad \xff byte" f'

## STDOUT:
TODO
## END

