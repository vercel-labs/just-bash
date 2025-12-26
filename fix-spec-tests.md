# Plan to Fix Remaining Spec Tests

**Current Status:** 373 failing tests out of 1380 total (73% passing)
**Goal:** 0 failing tests (100% pass rate)

## Process

- Pick 8-20 related failing tests to fix
- Figure out how to fix them
  - Analyze common root causes
  - Make a plan to fix. Ideally in one process.
  - Apply the fixes to the code
- Then run the tests again to validate you succeded.
- If there are still failures in the group, fix them
- Otherwise move on to the next 8-20

---

## Progress Summary

| Session   | Starting | Ending | Fixed | Key Changes                                                               |
| --------- | -------- | ------ | ----- | ------------------------------------------------------------------------- |
| Initial   | 467      | 441    | 26    | Brace cartesian, array subscript, printf -v/--                            |
| Session 2 | 441      | 425    | 16    | Lazy eval, octal/hex numerics, range steps, zero-padding                  |
| Session 3 | 425      | 403    | 22    | Printf precision, backslash escapes, quoted patterns, brace in assignment |
| Session 4 | 403      | 383    | 20    | String slice, arithmetic in slice, ${#v:x} error, pattern var expansion   |
| Session 5 | 383      | 373    | 10    | Pattern slash as pattern, POSIX char classes, quoted patterns in patsub   |

### Completed Fixes ✅

1. **Brace Expansion Cartesian Product** - `{a,b}_{c,d}` now produces `a_c a_d b_c b_d`
2. **Trailing/Leading Incomplete Braces** - `{a,b}_{` outputs `a_{ b_{`
3. **Array Subscript Assignment** - `a[3]=foo` and `a[-1]=bar` work correctly
4. **Printf Format Specifiers** - `--` option, `-v varname` option
5. **Read Builtin Options** - `-n count`, `-a array` options, exit code for no delimiter
6. **Redirect Operators** - `>&2` and `2>&1` fd duplication
7. **Lazy Evaluation** - `${x:-$((i++))}` only evaluates default when needed
8. **Double Bracket Numerics** - Octal (017), hex (0xff), base-N (64#a), string→0 coercion
9. **Brace Range Steps** - `{1..8..-3}` → `1 4 7` (uses abs(step), natural direction)
10. **Brace Range Zero-Padding** - `{01..03}` → `01 02 03`
11. **Char Range with Step** - `{a..e..2}` → `a c e`
12. **Printf Precision** - `%6.d` and `%.d` (empty precision = 0)
13. **Printf %q Shell Quoting** - Uses backslash escaping for printable chars
14. **Backslash Quote Escaping** - `\"` and `\'` outside quotes produce literal quotes
15. **Quoted Patterns in [[** - `[[ foo.py == '*.py' ]]` treats RHS literally
16. **Brace Expansion in Assignment** - `v={X,Y}` stores literal `{X,Y}`
17. **$OSTYPE, $MACHTYPE, $HOSTTYPE** - Now set in initial environment
18. **String Slice Parsing** - `${foo:1:3}` now correctly parses offset/length
19. **Arithmetic in Slice** - `${foo: i+4-2 : i+2}` evaluates expressions
20. **UTF-8 String Slicing** - `${foo:1:3}` now slices by character, not byte
21. **Negative Length in Slice** - `${foo:3:-1}` correctly treats negative length as end position
22. **${#v:x} Error** - `${#v:1:3}` now throws "bad substitution" error
23. **Pattern Variable Expansion** - `${var//$pat/repl}` now expands $pat and $repl
24. **Slash as Pattern** - `${x///}` and `${x////c}` now correctly parse `/` as pattern
25. **POSIX Character Classes** - `[[:alpha:]]`, `[[:digit:]]` etc. in patterns
26. **Quoted Patterns in Char Class** - `[^'><+-.,[]']` handles single quotes inside `[...]`
27. **Empty Pattern Handling** - `${x//$undef/y}` returns original when pattern is empty
28. **Glob vs Literal in Pattern** - `\*` is literal, unquoted `$g` where g=* is glob
29. **Invalid Range Graceful** - `[z-a]` returns original value instead of error

---

## Remaining High-Priority Fixes

### A. Brace Expansion Edge Cases (~15 tests)

**File:** `src/parser/word-parser.ts`, `src/interpreter/expansion.ts`

**Problems:**

- `{{a,b}` - bash treats first `{` as prefix, outputs `{a {b`
- Mixed quotes in braces: `{\X"b",'cd'}` should expand
- Variable expansion in braces: `{$a,b}_{c,d}` has bash-specific behavior
- Command substitution in braces: `{$(echo a),b}` not expanding
- RHS of assignment: `v={X,Y}` should NOT expand (stays as literal)

### B. Double Bracket Conditionals (~15 tests)

**File:** `src/interpreter/conditionals.ts`, `src/parser/parser.ts`

**Problems:**

- Quoted patterns: `[[ foo.py == '*.py' ]]` - quoted pattern should be literal
- `[[ -z ]]` should be syntax error
- Multi-line `[[`: newlines between `[[` and `]]` should work
- `[[ -f < ]]` should be parse error (not "is < a file?")
- Dynamic arithmetic in `-eq`: `[[ 1+2 -eq 3 ]]` should evaluate expression
- `[[ at runtime doesn't work: `$dbracket foo == foo ]]` where dbracket=[[

### C. Printf Formatting (~30 tests)

**File:** `src/commands/printf/printf.ts`

**Problems:**

- Precision with integers: `printf '[%6.4d]' 42` → `[  0042]`
- %q shell quoting
- %b escape sequences
- Argument reuse when format has more specifiers than args
- Width/precision with `*` (read from args)

### D. Assignment Edge Cases (~12 tests)

**File:** `src/interpreter/interpreter.ts`, `src/parser/command-parser.ts`

**Problems:**

- `FOO=bar [[ x == x ]]` should fail (env prefix before compound command)
- `FOO=foo printenv.py FOO` - temp env binding for command
- `readonly x=` should set empty string
- `local x` without value should not set variable
- `declare -A foo; foo["$key"]=value` associative array

### E. Arithmetic Edge Cases (~15 tests)

**File:** `src/interpreter/arithmetic.ts`

**Problems:**

- Dynamic variable names: `$((f$x))` where x=oo evaluates `foo`
- Side effects in array index: `${a[b=2]}`
- Nested arithmetic: `$((1 + $((2 + 3)) + 4))`
- Quoted numbers: `$(('1' + 2))`

### F. Glob Expansion (~10 tests)

**File:** `src/shell/glob.ts`

**Problems:**

- Character classes: `[[:punct:]]`, `[[:alpha:]]`
- Escaped patterns: `*\(\)` should match `foo()`
- Glob in double quotes should be literal

### G. Variable Operations (~10 tests)

**File:** `src/interpreter/expansion.ts`

**Problems:**

- `${!prefix*}` - list vars starting with prefix
- `${var@Q}` - quoting transformations
- Pattern substitution edge cases

### H. Special Variables (~15 tests)

**File:** `src/interpreter/expansion.ts`

**Problems:**

- `$LINENO` tracking
- `$FUNCNAME` array
- `$BASH_SOURCE` array
- `$PIPESTATUS` array

---

## Current Failure Distribution

Run `pnpm test:run src/spec-tests/spec.test.ts 2>&1 | grep "FAIL" | sed 's/.*> //' | cut -d'>' -f1 | sort | uniq -c | sort -rn` to get updated counts.

Estimated distribution:

- brace-expansion.test.sh: ~25
- builtin-printf.test.sh: ~35
- array.test.sh: ~20
- dbracket.test.sh: ~15
- assign.test.sh: ~12
- arith.test.sh: ~15
- glob.test.sh: ~10
- vars-special.test.sh: ~15
- redirect.test.sh: ~15
- Other: ~263

---

## Testing Commands

```bash
# Run all spec tests
pnpm test:run src/spec-tests/spec.test.ts

# Run specific test file
pnpm test:run src/spec-tests/spec.test.ts -t "brace-expansion.test.sh"

# Quick test with real bash comparison
echo 'your script' | pnpm dev:exec --no-ast --real-bash

# Get failure count
pnpm test:run src/spec-tests/spec.test.ts 2>&1 | tail -5
```

---

## Code Reference

| Feature          | Primary File                      | Key Functions                                   |
| ---------------- | --------------------------------- | ----------------------------------------------- |
| Brace Expansion  | `src/interpreter/expansion.ts`    | `safeExpandNumericRange`, `safeExpandCharRange` |
| Conditionals     | `src/interpreter/conditionals.ts` | `evaluateConditional`, `parseNumeric`           |
| Printf           | `src/commands/printf/printf.ts`   | `handlePrintf`                                  |
| Expansion Parser | `src/parser/expansion-parser.ts`  | `parseParameterOperation`                       |
| Word Parser      | `src/parser/word-parser.ts`       | `tryParseBraceExpansion`                        |
