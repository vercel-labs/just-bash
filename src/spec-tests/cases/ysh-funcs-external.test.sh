## our_shell: ysh
## oils_failures_allowed: 3

#### JSON func on top of proc

proc myadd {
  json read (&args)

  # convenient!
  redir >&2 {
    = args
  }

  json write (args[0] + args[1])
}

echo '[1, 2]' | myadd | json read (&result)

# TODO:
# Rewrite this as:
#
# var result = myadd(1,2)
#
# Is that possible?  I think functions can live in their own namespace?
# Or you can have expr.Func() with all the metadata?
# Problem with 'source mytool.hay' is that it can define funcs ANYWHERE
# you might need a namespace like extern::mytool::myfunc()

echo "result = $result"

## STDOUT:
TODO
result = 3
## END

#### QTT func on top of proc

proc myadd {

  # I thought this was 'wok'
  qtt read-rows {
    if (_index === 0) {
      # could write header first here
      write --sep $TAB -- $_schema_str 'result:Int'

      # _schema is the raw schema
    }
    # or use BEGIN and 'when', like awk-style

    const result = _row->x + _row->y
    write --sep $TAB -- $_row_str $result
  }
}

qtt tabify '''
x:Int y:Int
1     2
3     4
''' | myadd | qtt read-cols result

echo "result = $result"

## STDOUT:
## END

#### QTT func on top of wok

wok foo {
  BEGIN {
    write --sep $TAB -- $_schema_str' result:Int'
  }

  # for all rows.  Could be 'each' or 'row'
  when {
    const result = _row->x + _row->y
    write --sep $TAB -- $_row_str $result
  }
}

## STDOUT:
## END


# Notes:
# - consider JSON-RPC
# - consider multiple return values
