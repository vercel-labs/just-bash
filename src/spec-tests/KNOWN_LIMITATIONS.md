# Known Limitations

This document describes bash features that are intentionally not implemented in bash-env. Tests for these features are marked with `## SKIP:` in the spec test files.

## Recently Implemented

The following features were recently added and are now working:

### $LINENO Tracking ✅
The `$LINENO` variable now correctly tracks the current line number during script execution, including in:
- Simple commands
- Function bodies
- Loops (for, while)
- Case statements

### Word Splitting with Mixed Quoted/Unquoted Parts ✅
Word splitting now correctly handles:
- `$a"$b"` - unquoted followed by quoted parts
- `"$@"` with adjacent text (e.g., `"-$@-"` produces `['-arg1', 'arg2', 'arg3-']`)
- `"$*"` vs `"$@"` semantics (different behavior with empty params)
- Unquoted `$@`/`$*` going through IFS splitting

---

## Summary by Category

| Category | Tests | Priority |
|----------|-------|----------|
| Interactive/Shell invocation | ~85 | Out of scope |
| Test helpers not available | ~70 | Infrastructure |
| extglob patterns | 50 | Low |
| Right brace in default value | 46 | Medium |
| Test data/external deps | ~55 | Infrastructure |
| Advanced read options | 22 | Low |
| History builtin | 29 | Out of scope |
| Printf %q format | 14 | Low |
| mapfile/readarray | 13 | Low |
| Here-doc edge cases | 11 | Medium |
| errexit in compound commands | 9 | High |
| IFS edge cases | ~8 | High |
| File descriptor operations | ~15 | Low |
| Other | ~100 | Various |

---

## High Priority (Core functionality gaps)

### IFS Edge Cases (~8 tests)
Complex IFS handling edge cases remain:
- Empty IFS with positional parameter existence checks (bash checks if params exist, not if expansion is empty)
- IFS with backslash in certain contexts
- Some `$*` joining edge cases with empty IFS

### errexit in Compound Commands (9 tests)
`set -e` (errexit) doesn't interact correctly with:
- Brace groups `{ }`
- Pipelines
- Subshells

### PIPESTATUS Variable (7 tests)
The `PIPESTATUS` array containing exit statuses of pipeline commands is not implemented.

---

## Medium Priority (Commonly used features)

### Right Brace in Default Value (46 tests)
Complex parameter expansions with `}` in default values like `${x:-a}b}` have parsing limitations.

### Here-Document Edge Cases (11 tests)
- Quoted delimiters with special characters
- Multiple here-docs on same line
- Here-doc after function definition

### Parse Error Detection (10 tests)
Some parse error messages and detection differ from bash:
- Unterminated quotes
- Nested array literals
- Ambiguous syntax

---

## Low Priority (Advanced/rarely used features)

### Shell Options

#### extglob (50 tests)
Extended glob patterns like `@(foo|bar)`, `+(pattern)`, `?(pattern)`, `!(pattern)` are not supported.

#### noclobber / set -C (6 tests)
The `set -C` option to prevent overwriting files with `>` is not implemented.

#### noglob / set -f (2 tests)
The `set -f` option to disable pathname expansion is not implemented.

#### noexec / set -n (1 test)
The `set -n` option to parse but not execute commands is not implemented.

#### globskipdots (3 tests)
The `shopt -s globskipdots` option is not implemented.

#### POSIX mode (8 tests)
`set -o posix` for strict POSIX compliance is not implemented.

### Builtins

#### read Options (22 tests)
Advanced `read` options are not implemented:
- `-n N` / `-N N` - read N characters
- `-d delim` - custom delimiter
- `-t timeout` - timeout
- `-u fd` - read from file descriptor
- `-s` - silent mode
- `-e` - use readline
- `-i text` - default text
- `-a array` - read into array
- `-p prompt` - prompt string
- `-P` - physical path

#### mapfile/readarray (13 tests)
The `mapfile` and `readarray` builtins for reading lines into an array are not implemented.

#### printf %q Format (14 tests)
The `%q` format for shell quoting and `set` output format are not implemented.

#### printf strftime (4 tests)
The `%(format)T` strftime format is not implemented.

#### hash (3 tests)
The `hash` builtin for managing the command hash table is not implemented.

### File Descriptors

#### {fd} Variable Syntax (3 tests)
Automatic file descriptor allocation with `{fd}>file` syntax is not implemented.

#### Close/Move Syntax (5 tests)
File descriptor close (`>&-`, `<&-`) and move (`>&N-`) syntax is not implemented.

#### Advanced Redirections (6 tests)
- `exec N<file` - opening specific file descriptors
- `N<&M` - duplicating file descriptors
- Read-write mode `<>` (2 tests)
- Stderr output inside command block with stdout redirect

#### High FD Numbers (2 tests)
Redirect to file descriptor numbers > 99 is not implemented.

### Filesystem

#### Symbolic Links (6 tests)
Symlink operations including:
- `ln -s` command
- `-h` / `-L` test operators
- `pwd -P` / `cd -P` physical path resolution

#### File Time Comparison (2 tests)
`-ot` (older than), `-nt` (newer than), `-ef` (same file) test operators are not implemented.

#### Permission Denied (1 test)
Execution permission checking returns exit code 127 instead of 126.

### Arithmetic

#### 64-bit Integers (7 tests)
JavaScript uses 53-bit precision for numbers and 32-bit for bitwise operations:
- Large integer overflow
- 64-bit shift operations
- printf with unsigned/octal/hex of negative numbers

#### Dynamic Variable Names (5 tests)
Runtime variable name construction in arithmetic like `$((f$x + 1))` is not implemented.

#### Comments in Arithmetic (1 test)
Comments inside `$((...))` are not supported.

#### Array Operations in Arithmetic (8 tests)
- Array comparison `(( a == b ))`
- Array value coercion
- Associative array key expansion with `$var`

### Parameter Expansion

#### ${@:0:N} Slice (5 tests)
Slicing positional parameters starting from position 0 (which includes `$0`) is not implemented.

#### Glob After $@ (2 tests)
Glob expansion after `$@` expansion has edge cases.

### Brace Expansion

#### Variable Expansion Order (1 test)
In bash, brace expansion happens before variable expansion.

#### Mixed Case Ranges (1 test)
Character ranges like `{z..A}` mixing cases are not implemented.

#### Side Effects (1 test)
Side effects in brace expansion like `{a,b}-$((i++))` don't evaluate correctly.

#### Escaped Braces (1 test)
Complex escaped braces in expansion are not handled.

#### Tilde in Braces (1 test)
`~{a,b}` tilde expansion within braces is not implemented.

### Quoting

#### Backtick Quoting (4 tests)
Complex escape sequences within backticks `` `...` `` are not fully supported.

### Conditional Expressions

#### [[ ]] Edge Cases (5 tests)
- Runtime evaluation via variable expansion
- Environment variable prefix
- Arguments resembling operators
- Tilde expansion edge cases

### Functions

#### Name with Expansion (2 tests)
Function names containing `$` or command substitution are not supported.

#### Here-doc After Definition (1 test)
`func() { } <<EOF` syntax is not implemented.

### Scoping

#### Temp Binding Edge Cases (4 tests)
Temporary variable bindings (`VAR=value command`) have edge cases with:
- Dynamic local variables
- Nested temp bindings
- Mutation within temp scope

---

## Out of Scope

### Interactive Shell Invocation (85 tests)
Tests requiring `$SH -c` or `$SH -i` to spawn subshells, TTY interaction, or process control.

### History Builtin (29 tests)
The `history` builtin and history expansion are not implemented.

### Oils-Specific Features (10 tests)
YSH/Oils extensions like `shopt -s ysh:*`, `strict_arg_parse`, `command_sub_errexit`.

### ZSH-Specific (3 tests)
ZSH-specific `setopt` options.

---

## Infrastructure (Test Environment)

### Test Helpers Not Available (~70 tests)
Python test helpers used by upstream tests:
- `argv.py` (42 tests) - Now implemented
- `printenv.py` (7 tests) - Now implemented
- `stdout_stderr.py` (7 tests) - Now implemented
- `read_from_fd.py` (4 tests)
- `python2` command (14 tests)

### External Commands (~40 tests)
Commands not implemented:
- `od` (27 tests)
- `tac` (12 tests)
- `hostname` (2 tests)

### Test Data Directory (29 tests)
Tests requiring `$REPO_ROOT/spec/testdata/` files.

---

## Skipped Test Files

The following test files are entirely skipped in `spec.test.ts`:

### Interactive Shell (require TTY)
- `interactive.test.sh`
- `interactive-parse.test.sh`
- `prompt.test.sh`
- `builtin-history.test.sh`
- `builtin-fc.test.sh`
- `builtin-bind.test.sh`
- `builtin-completion.test.sh`

### Process/Job Control (require real processes)
- `background.test.sh`
- `builtin-process.test.sh`
- `builtin-kill.test.sh`
- `builtin-trap.test.sh`
- `builtin-trap-bash.test.sh`
- `builtin-trap-err.test.sh`
- `builtin-times.test.sh`
- `process-sub.test.sh`

### Shell Features Not Implemented
- `alias.test.sh` - alias expansion
- `xtrace.test.sh` - set -x tracing
- `builtin-dirs.test.sh` - directory stack
- `sh-usage.test.sh` - shell invocation options

### ZSH-Specific
- `zsh-assoc.test.sh`
- `zsh-idioms.test.sh`

### BLE (Bash Line Editor)
- `ble-features.test.sh`
- `ble-idioms.test.sh`
- `ble-unset.test.sh`

### External Dependencies
- `nul-bytes.test.sh` - NUL byte handling
- `unicode.test.sh` - Unicode support

### Meta/Introspection
- `introspect.test.sh`
- `print-source-code.test.sh`
- `serialize.test.sh`
- `spec-harness-bug.test.sh`

### Documentation (not real tests)
- `known-differences.test.sh`
- `divergence.test.sh`

### Toysh-Specific
- `toysh.test.sh`
- `toysh-posix.test.sh`

### Blog/Exploration (not spec tests)
- `blog1.test.sh`
- `blog2.test.sh`
- `blog-other1.test.sh`
- `explore-parsing.test.sh`

### Extended Globbing
- `extglob-match.test.sh`
- `extglob-files.test.sh`
- `globstar.test.sh`
- `globignore.test.sh`
- `nocasematch-match.test.sh`

### Advanced Features Not Implemented
- `builtin-getopts.test.sh` - getopts builtin
- `nameref.test.sh` - nameref/declare -n
- `var-ref.test.sh` - ${!var} indirect references
- `regex.test.sh` - =~ regex matching
- `sh-options.test.sh` - shopt options
- `sh-options-bash.test.sh`

### Bash-Specific Builtins
- `builtin-bash.test.sh`
- `builtin-type-bash.test.sh`
- `builtin-vars.test.sh`
- `builtin-meta.test.sh`
- `builtin-meta-assign.test.sh`

### Advanced Array Features
- `array-assoc.test.sh` - associative arrays
- `array-sparse.test.sh` - sparse arrays
- `array-compat.test.sh`
- `array-literal.test.sh`
- `array-assign.test.sh`

### Complex Assignment
- `assign-extended.test.sh`
- `assign-deferred.test.sh`
- `assign-dialects.test.sh`

### Advanced Arithmetic
- `arith-dynamic.test.sh`

### Complex Redirections
- `redirect-multi.test.sh`
- `redirect-command.test.sh`
- `redir-order.test.sh`

### Other Advanced Features
- `command-sub-ksh.test.sh`
- `vars-bash.test.sh`
- `var-op-bash.test.sh`
- `type-compat.test.sh`
- `shell-grammar.test.sh`
- `shell-bugs.test.sh`
- `nix-idioms.test.sh`
- `paren-ambiguity.test.sh`
- `fatal-errors.test.sh`
- `for-expr.test.sh`
- `glob-bash.test.sh`
- `bool-parse.test.sh`
- `arg-parse.test.sh`
- `append.test.sh`
- `bugs.test.sh`
