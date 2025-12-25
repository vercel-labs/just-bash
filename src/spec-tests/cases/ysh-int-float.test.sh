## oils_failures_allowed: 0

#### Float Literals with e-1

shopt -s ysh:upgrade
# 1+2 2.3
var x = 1.2 + 23.0e-1  # 3.5
if (3.4 < x and x < 3.6) {
  echo ok
}
## STDOUT:
ok
## END

#### Float Literal with _

shopt -s ysh:upgrade

# 1+2 + 2.3
# add this _ here
var x = 1.2 + 2_3.0e-1  # 3.5
if (3.4 < x and x < 3.6) {
  echo ok
}

## STDOUT:
ok
## END


#### Period requires digit on either side, not 5. or .5
shopt --set parse_ysh_expr_sub

echo $[0.5]
echo $[5.0]
echo $[5.]
echo $[.5]

## status: 2
## STDOUT:
0.5
5.0
## END

#### Big float Literals with _
shopt --set parse_ysh_expr_sub

# C++ issue: we currently print with snprintf %g
# Pars

echo $[42_000.000_500]

echo $[42_000.000_500e1]
echo $[42_000.000_500e-1]

## STDOUT:
42000.0005
420000.005
4200.00005
## END

#### Big floats like 1e309 and -1e309 go to Inf / -Inf
shopt --set parse_ysh_expr_sub

# Notes
# - Python float() and JS parseFloat() agree with this behavior
# - JSON doesn't have inf / -inf

echo $[1e309]
echo $[-1e309]

## STDOUT:
inf
-inf
## END

#### Tiny floats go to zero

shopt -s ysh:upgrade
# TODO: need equivalent of in YSh
# '0' * 309
# ['0'] * 309

# 1e-324 == 0.0 in Python

var zeros = []
for i in (1 ..< 324) {
  call zeros->append('0')
}

#= zeros

var s = "0.$[join(zeros)]1"
#echo $s

echo float=$[float(s)]

## STDOUT:
float=0.0
## END


#### floatEquals() INFINITY NAN

shopt --set ysh:upgrade
source $LIB_YSH/list.ysh

# Create inf
var big = repeat('12345678', 100) ++ '.0'

var inf = fromJson(big)
var neg_inf = fromJson('-' ++ big)

if (floatsEqual(inf, INFINITY)) {
  echo inf
}

if (floatsEqual(neg_inf, -INFINITY)) {
  echo neg_inf
}

if (floatsEqual(NAN, INFINITY)) {
  echo bad
}

if (floatsEqual(NAN, NAN)) {
  echo bad
}

if (not floatsEqual(NAN, NAN)) {
  echo 'nan is not nan'
}

## STDOUT:
inf
neg_inf
nan is not nan
## END

#### pretty print INFINITY, -INFINITY, NAN

= [INFINITY, -INFINITY, NAN]
pp test_ ([INFINITY, -INFINITY, NAN])

## STDOUT:
(List)  [INFINITY, -INFINITY, NAN]
(List)   [INFINITY,-INFINITY,NAN]
## END

#### can't convert NAN, INFINITY to integer
shopt --set ysh:upgrade

#echo $[int(NAN)]
try {
  echo $[int(NAN)]
}
echo code $[_error.code]
#pp test_ (_error)

#echo $[int(-INFINITY)]
try {
  echo $[int(-INFINITY)]
}
echo code $[_error.code]
#pp test_ (_error)

## STDOUT:
code 3
code 3
## END

#### Regression: 1/3 gives 0.3+

# We were using float precision, not double

shopt --set ysh:upgrade

pp test_ (1/3) | read --all
if (_reply ~ / '0.' '3'+ / ) {
  echo one-third
}

pp test_ (2/3) | read --all
#pp test_ (_reply)
if (_reply ~ / '0.' '6'+ / ) {
  echo two-thirds
}

## STDOUT:
one-third
two-thirds
## END

#### Number of digits in 1/3 
shopt --set ysh:upgrade

# - Python 2 and bin/ysh: 14
# - Python 3: 18
# - YSH C++: 18

var s = str(1/3)
#echo "ysh len $[len(s)]"
#echo ysh=$s

# Don't bother to distinguish OSH Python vs C++ here
case (len(s)) {
  (14) { echo pass }
  (18) { echo pass }
  (else) { echo FAIL }
}

exit

var py2 = $(python2 -c 'print(1.0/3)')
echo "py2 len $[len(py2)]"
echo py2=$py2

var py3 = $(python3 -c 'print(1/3)')
echo "py3 len $[len(py3)]"
echo py3=$py3

## STDOUT:
pass
## END
