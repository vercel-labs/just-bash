## our_shell: ysh

#### help topic not found

help zz

## status: 1
## STDOUT:
## END

#### help topics that are embedded

help > help.txt
echo no args $?
echo

for topic in help oils-usage {osh,ysh}-usage {osh,ysh}-chapters; do
  help $topic | fgrep -o "~~~ $topic"
  echo $topic $?
  echo
done

## STDOUT:
no args 0

~~~ help
help 0

~~~ oils-usage
oils-usage 0

~~~ osh-usage
osh-usage 0

~~~ ysh-usage
ysh-usage 0

~~~ osh-chapters
osh-chapters 0

~~~ ysh-chapters
ysh-chapters 0

## END

#### help topics that print URLs

help command-sub | grep -o chap-word-lang.html
echo status=$?

help read | grep -o chap-builtin-cmd.html
echo status=$?

## STDOUT:
chap-word-lang.html
status=0
chap-builtin-cmd.html
status=0
## END

#### help shows 'ysh-chapters' topic

# shows ~~~ instead of ANSI text
help | grep ysh-chapters

echo status=$?

## STDOUT:
~~~ ysh-chapters ~~~
status=0
## END

#### help List/append, runes, etc.

shopt --set ysh:upgrade

proc assert-lines {
  var num_lines = $(@ARGV | wc -l)
  #echo "lines = $num_lines"
  if (num_lines < 2) {
    error "only got $num_lines lines"
  }
}

assert-lines help List/append
echo status=$?

assert-lines help cmd/append
echo status=$?

assert-lines help runes
echo status=$?

## STDOUT:
status=0
status=0
status=0
## END


#### help oils-err-12 (case insensitive)

# note that the topics are lower-casedo

help oils-err-12 | grep -o 'catalog.html#oils-err-12'
echo status=$?

help OILS-ERR-12 | grep -o 'catalog.html#oils-err-12'
echo status=$?

# these are bad

# help oils-err-zz
# echo status=$?

# help OILS-ERR-zz
# echo status=$?

## STDOUT:
catalog.html#oils-err-12
status=0
catalog.html#oils-err-12
status=0
## END
