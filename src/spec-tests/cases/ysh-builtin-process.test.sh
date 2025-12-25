# fork and forkwait

#### fork and forkwait usage  errors
shopt --set oil:upgrade
shopt --unset errexit

fork
echo status=$?

fork extra
echo status=$?

fork extra {
  echo hi
}
echo status=$?

#

forkwait
echo status=$?

forkwait extra
echo status=$?

forkwait extra {
  echo hi
}
echo status=$?

## STDOUT:
status=2
status=2
status=2
status=2
status=2
status=2
## END

#### forkwait
shopt --set oil:upgrade
shopt --unset errexit

old=$PWD

forkwait {
  cd /
  echo hi
  exit 42
}
echo status=$?
if test "$old" = "$PWD"; then
  echo ok
fi
## STDOUT:
hi
status=42
ok
## END

#### fork
shopt --set oil:upgrade
shopt --unset errexit

old=$PWD

fork {
  cd /
  echo hi
  sleep 0.01 
  exit 42
}
#echo status=$?  race condition

wait -n
echo status=$?

if test "$old" = "$PWD"; then
  echo ok
fi
## STDOUT:
hi
status=42
ok
## END
