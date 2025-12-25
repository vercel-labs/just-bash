## our_shell: ysh
## oils_failures_allowed: 2

#### Local place

# Work around stdin buffering issue with read --line
#
# The framework test/sh_spec.py uses echo "$code_string" | $[ENV.SH]
#
# But then we have TWO different values of file descriptor 0 (stdin)
#
# - the pipe with the code
# - the pipe created in th shell for echo zzz | read --line
#
# Shells read one line at a time, but read --line explicitly avoids this.
#
# TODO: I wonder if we should consider outlawing read --line when stdin has code
# Only allow it for:
#
# $[ENV.SH] -c 'echo hi'
# $[ENV.SH] myscript.sh
#
# There could be a warning like read --line --no-fighting or something.

cat >tmp.sh <<'EOF'
func f(place) {
  var x = 'f'
  echo zzz | read --all (place)
  echo "f x=$x"
}

func fillPlace(place) {
  var x = 'fillPlace'
  call f(place)
  echo "fillPlace x=$x"
}

proc p {
  var x = 'hi'
  call fillPlace(&x)
  echo "p x=$x"
}

x=global

p

echo "global x=$x"
EOF

$[ENV.SH] tmp.sh

## STDOUT:
f x=f
fillPlace x=fillPlace
p x=zzz

global x=global
## END

#### place->setValue()

func f(place) {
  var x = 'f'
  call place->setValue('zzz')
  echo "f x=$x"
}

func fillPlace(place) {
  var x = 'fillPlace'
  call f(place)
  echo "fillPlace x=$x"
}

proc p {
  var x = 'hi'
  call fillPlace(&x)
  echo "p x=$x"
}

x=global

p
echo "global x=$x"

## STDOUT:
f x=f
fillPlace x=fillPlace
p x=zzz
global x=global
## END

#### [DISABLED] Places can't dangle; they should passed UP the stack only

func f() {
  var f_local = null
  return (&f_local)
}

func g() {
  # This place is now INVALID!
  var place = f()

  # Should fail when we try to use the place
  echo zzz | read --all (place)

  # This should also fail
  # call place->setValue('zzz')

}

call g()

echo done

## status: 1
## STDOUT:
## END


#### Container Place (Dict)

var d = {key: 'hi'}

echo zzz | read --all (&d.key)

# I guess this works
echo newkey | read --all (&d.newkey)

echo key=$[d.key]
echo key=$[d.newkey]

## STDOUT:
## END


