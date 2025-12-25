## oils_failures_allowed: 0

#### Conflict with extglob @( can be avoided with ,(

shopt -s extglob

[[ foo.py == @(*.sh|*.py) ]]
echo status=$?

# Synonym.  This is a syntax error in bash.
[[ foo.py == ,(*.sh|*.py) ]]
echo status=$?

## STDOUT:
status=0
status=0
## END

#### split command sub @() in expression mode
shopt --set parse_proc parse_at

var x = @(seq 3)

write -- @x
## STDOUT:
1
2
3
## END

#### split command sub @() in command mode

shopt -s parse_at
write -- @(seq 3)

echo --
IFS=x
x=axbxxc
argv.py $x

# This construct behaves the same with simple_word_eval on
# Not affected by IFS
echo --
shopt -s simple_word_eval
write -- @(seq 3)

echo --
argv.py @(echo $x)

## STDOUT:
1
2
3
--
['a', 'b', '', 'c']
--
1
2
3
--
['axbxxc']
## END

#### @() decodes J8 Lines

# syntax errors - TODO: document this in doc/chap-errors

# - syntax error in J8 string (bad escape, no closing quote)
# - extra text after line
# - unquoted line isn't valid UTF-8

var b = @(
  # unquoted: spaces stripped at beginning and end
  echo '  unquoted "" word  '

  # empty line is ignored
  echo

  # Not allowed, since unquoted lines should be UTF-8
  #echo $'binary \xff';

  echo '  " json \u03bc " '
  echo '  j" json j prefix \u03bc " '
  echo " u' j8 u \\u{3bc} ' "
  echo " b' j8 b \\u{3bc} ' "

  # no prefix is like u''
  echo "  ' j8 no prefix \\u{3bc} ' "
)

json write (b)

## STDOUT:
[
  "unquoted \"\" word",
  " json μ ",
  " json j prefix μ ",
  " j8 u μ ",
  " j8 b μ ",
  " j8 no prefix μ "
]
## END

#### for loop using @(seq $n)
shopt -s oil:upgrade

for x in @(seq 3) {
  echo "[$x]"
}
for x in @(seq 3) {
  argv.py z @[glob("[$x]")]
}
## STDOUT:
[1]
[2]
[3]
['z']
['z']
['z']
## END

#### @() can't start in the middle of the word
shopt -s extglob  # this makes it match in bash
shopt -s oil:upgrade

# This is currently a RUNTIME error when simple_word_eval is on

touch foo.py
echo f@(*.py)
## status: 1
## STDOUT:
## END
## OK bash status: 0
## OK bash STDOUT:
foo.py
## END

#### @() can't have any tokens after it
shopt -s oil:upgrade

write -- @(seq 2)
write -- @(seq 3)x
## status: 2
## STDOUT:
1
2
## END
