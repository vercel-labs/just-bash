## our_shell:ysh

#### read --raw-line, --all, --num-bytes preserve NUL bytes

proc raw-line {
  read --raw-line (&s)
  echo len=${#s}
  write --end '' $s | od -A n -t x1
}

proc all {
  read --all (&s)
  echo len=${#s}
  write --end '' $s | od -A n -t x1
}

proc num-bytes {
  read --num-bytes 3 (&s)
  echo len=${#s}
  write --end '' $s | od -A n -t x1
}

printf '.\000.' | raw-line
printf '.\000.' | all
printf '.\000.' | num-bytes

## STDOUT:
len=3
 2e 00 2e
len=3
 2e 00 2e
len=3
 2e 00 2e
## END

