# This syntax is available with OSH too

#### ... with simple command
... echo  # comment
    hi  # comment
    there
    ;
echo ---
## STDOUT:
hi there
---
## END

#### ... with pipeline
... { echo one; echo two; }
  | sort
  | wc -l
  ;
## STDOUT:
2
## END

#### ... with multiline $()

# newlines mean the normal thing
echo $(echo one
       echo two)

... echo
    $(echo 3
      echo 4)  # is this right?
  | wc -l
  ;
## STDOUT:
one two
1
## END

#### ... inside command sub $()
echo one $(... echo
              two
              three) four
echo five
## STDOUT:
one two three four
five
## END

#### ... with && and [[
echo one && false || echo two

... echo three
 && [[ 0 -eq 0 ]]
 && echo four
 && false
 || echo five
 ;

echo ---

## STDOUT:
one
two
three
four
five
---
## END

#### '... for' is allowed, but NOT recommended
... for x in foo bar; do echo $x; done
    ;

... for x in foo bar; do
      echo $x;
    done
    ;

return

# This style gets messed up because of translation, but that is EXPECTED.
... for x in foo bar
    do
      echo $x;
    done
    ;

## STDOUT:
foo
bar
foo
bar
## END

#### Blank line in multiline command is syntax error
... echo comment
    # comment
    is OK
    ;

... echo blank line

    is not OK
    ;

## status: 2
## STDOUT:
comment is OK
## END

#### Blank line with spaces and tabs isn't OK either
... echo comment
    # comment
    is OK
    ;

# NOTE: invisible spaces and tabs below (:set list in vim)
... echo blank line
   
    is not OK
    ;
## status: 2
## STDOUT:
comment is OK
## END



# Notes:
# - MakeParserForCommandSub() instantiates a new WordParser, so we can safely
# change state in the top-level one only
# - BoolParser is called for [[ ]] and uses the same self.w_parser.  I think
# that's OK?

# So I think we can change state in WordParser.  (Also possible in
# CommandParser but meh).
#
# self.is_multiline = False
#
# When this is flag is on, then we
#
# Id.Op_Newline -> Id.WS_Space or Id.Ignored_LineCont
#  - and then that is NOT passed to the command parser?
#  - Or you can make it Id.Ignored_Newline
#
# BUT if you get 2 of them in a row without a comment, you can change it to:
# - Id.Op_Newline?
#
# Actually this is very simple rule and maybe can be done without much
# disturbance to the code.
#
# cursor_was_newline might need more state?


#### Combine multi-line command and strings
shopt --set ysh:all
shopt --unset no_parse_osh  # allow $'' for this test

var x = 'one'

# Print 3 args without separators
... write --sep '' --end '' -- 
    """
    $x
    """                         # 1. Double quoted
    '''
    two
    three
    '''                         # 2. Single quoted
    $'four\n'                   # 3. C-style with explicit newline
   | tac                        # Reverse
   | tr a-z A-Z                 # Uppercase
   ;

## STDOUT:
FOUR
THREE
TWO
ONE
## END
