# Demonstrations for users.  Could go in docs.

#### Iterate over command sub output with split()
shopt -s ysh:upgrade

output=$(echo '1 one'; echo '2 two')

for x in @[split(output)]; do
  write -- $x
done

echo ___

# Now change IFS.  split() is affected.
IFS=$'\n'
for x in @[split(output)]; do
  write -- $x
done

## STDOUT:
1
one
2
two
___
1 one
2 two
## END

#### split with explicit IFS argument
shopt -s ysh:upgrade

# demonstrate that -- is not special to 'write'
output=$(echo '1 one'; echo --; echo '2 two')

# TODO: accept named arg IFS=
for x in @[split(output, $'\n')]; do
  write -- $x
done

## STDOUT:
1 one
--
2 two
## END

#### split on \0 delimiters
shopt -s ysh:upgrade

write --end '' -- b'1 one\y002 two\y00' | read --all (&output)

#json8 write (split(output, b'\y00'))

for x in @[split(output, b'\y00')]; do
  write -- $x
done

## STDOUT:
1 one
2 two
## END
