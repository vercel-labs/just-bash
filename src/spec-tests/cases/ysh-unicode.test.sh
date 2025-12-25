## oils_failures_allowed: 1

#### ${#s} and len(s)
shopt --set parse_ysh_expr_sub

source $REPO_ROOT/spec/testdata/unicode.sh

# bash agrees
echo "farmer scalars =" ${#farmer}

echo "facepalm scalars =" ${#facepalm}

echo "farmer len =" $[len(farmer)]

echo "facepalm len =" $[len(facepalm)]

## STDOUT:
farmer scalars = 4
facepalm scalars = 5
farmer len = 15
facepalm len = 17
## END


#### JSON \uXXXX\uYYYY as max code point - can't go above

py-decode() {
  python2 -c 'import json, sys; print json.load(sys.stdin).encode("utf-8")'
}

to-hex() {
  od -A n -t x1
}

max='"\udbff\udfff"'

# incrementing by one gives invalid surrogates
# the encoding is "tight"
# too_big='"\udc00\udfff"'

echo "$max" | py-decode | to-hex

echo "$max" | json read
echo "$_reply" | to-hex

## STDOUT:
 f4 8f bf bf 0a
 f4 8f bf bf 0a
## END



#### Parsing data - J8 rejects \u{110000} 

json8 read <<EOF
u'\u{110000}'
EOF
echo status=$?

## STDOUT:
status=1
## END


#### Parsing source code - YSH rejects \u{110000}

# Sanity check first: Python interpreter DOES check big code points,
# whereas shells don't

max=$(python2 -c 'print u"\U0010ffff".encode("utf-8")')
echo status max=$?

too_big=$(python2 -c 'print u"\U00110000".encode("utf-8")')
echo status too_big=$?

#echo py max=$max
#echo py too_big=$too_big

# python2 -c 'import sys; c = sys.argv[1].decode("utf-8"); print len(c)' "$ok"
# python2 -c 'import sys; c = sys.argv[1].decode("utf-8"); print len(c)' "$too_big"

var max = u'\u{10ffff}'
pp test_ (max)

var too_big = u'\u{110000}'
pp test_ (too_big)  # should not get here

# These are errors too
var max = b'\u{10ffff}'
var too_big = b'\u{110000}'

## status: 2
## STDOUT:
status max=0
status too_big=1
(Str)   "􏿿"
## END


#### Parsing source code - YSH source code rejects encoded string

max=$(bash <<'EOF'
echo $'\U0010ffff'
EOF
)

# bash allows the bad one
too_big=$(bash <<'EOF'
echo $'\U00110000'
EOF
)

echo "var x = u'"$max"'; = x" | $SH
echo status=$?
#pp test_ (_reply)

echo "var x = u'"$too_big"'; = x" | $SH
echo status=$?
#pp test_ (_reply)

## STDOUT:
## END


#### JSON and J8 reject encoded string above max code point

max=$(bash <<'EOF'
echo $'\U0010ffff'
EOF
)

# bash allows the bad one
too_big=$(bash <<'EOF'
echo $'\U00110000'
EOF
)

# JSON string

echo '"'$max'"' | json read
echo status=$?
#pp test_ (_reply)

# Need to propagate the reason here

echo '"'$too_big'"' | json read
echo status=$?
#pp test_ (_reply)


# J8 string

echo "u'"$max"'" | json8 read
echo status=$?
#pp test_ (_reply)

echo "u'"$too_big"'" | json8 read
echo status=$?
#pp test_ (_reply)

## STDOUT:
status=0
status=1
status=0
status=1
## END

#### Max code point: json, json8, = keyword, pp test_

var max = u'\u{10ffff}'

json write (max)
json8 write (max)

= max
pp test_ (max)

#echo "var x = u'"$max"'; = x" | $SH

## STDOUT:
"􏿿"
"􏿿"
(Str)   '􏿿'
(Str)   "􏿿"
## END
