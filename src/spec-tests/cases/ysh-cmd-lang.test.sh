## our_shell: ysh
## oils_failures_allowed: 1

#### Redirect with if, case, while, for

if (true) {
  echo ysh-if
} > out

cat out

case (true) {
  (true) {
    echo ysh-case
  }
} > out

cat out

while (true) {
  echo ysh-while
  break
} > out

cat out

for x in ([42]) {
  echo ysh-for
} > out

cat out

## STDOUT:
ysh-if
ysh-case
ysh-while
ysh-for
## END


#### Redirect failure is either fatal or can be checked

# TODO: this fails, but there's no way to check it
#
# We can have shopt -s redir_errexit in YSH then?
# Can you catch the error?

{ echo 1; echo 2 } > /

echo status=$?

## STDOUT:
## END

