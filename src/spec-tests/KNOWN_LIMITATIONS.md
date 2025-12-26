# Known Limitations

This document describes bash features that are intentionally not implemented in bash-env. Tests for these features are marked with `## SKIP:` in the spec test files.

## Shell Options

### extglob (51 tests)
Extended glob patterns like `@(foo|bar)`, `+(pattern)`, `?(pattern)`, `!(pattern)` are not supported.

### noglob / set -f (7 tests)
The `set -f` option to disable pathname expansion is not implemented.

### noclobber / set -C (6 tests)
The `set -C` option to prevent overwriting files with `>` is not implemented.

### noexec / set -n (1 test)
The `set -n` option to parse but not execute commands is not implemented.

### globskipdots (3 tests)
The `shopt -s globskipdots` option is not implemented.

### POSIX mode (9 tests)
`set -o posix` for strict POSIX compliance is not implemented.

## Builtins

### read options (39 tests)
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

### mapfile/readarray (13 tests)
The `mapfile` and `readarray` builtins for reading lines into an array are not implemented.

### hash (3 tests)
The `hash` builtin for managing the command hash table is not implemented.

### history (29 tests)
The `history` builtin and history expansion are not implemented.

### which (31 tests)
The `which` command is not implemented (use `command -v` instead).

## Variables

### PIPESTATUS (11 tests)
The `PIPESTATUS` array containing exit statuses of pipeline commands is not implemented.

### $LINENO tracking (14 tests)
`$LINENO` is partially implemented but not tracked accurately in:
- Redirects
- Loops (for, while)
- Case statements
- Assignments
- Conditional/arithmetic contexts

### $_ special variable (3 tests)
The `$_` variable with declare/colon builtin interactions has edge cases not implemented.

## File Descriptors

### {fd} variable syntax (4 tests)
Automatic file descriptor allocation with `{fd}>file` syntax is not implemented.

### Close/move syntax (8 tests)
File descriptor close (`>&-`, `<&-`) and move (`>&N-`) syntax is not implemented.

### Advanced redirections (9 tests)
- `exec N<file` - opening specific file descriptors
- `N<&M` - duplicating file descriptors
- Read-write mode `<>` (3 tests)

### FD propagation (1 test)
File descriptor inheritance across statements is not fully implemented.

## Filesystem

### Symbolic links (7 tests)
Symlink operations including:
- `ln -s` command
- `-h` / `-L` test operators
- `pwd -P` / `cd -P` physical path resolution

### File time comparison (3 tests)
`-ot` (older than), `-nt` (newer than), `-ef` (same file) test operators are not implemented.

### Permission denied execution (2 tests)
Execution permission checking for scripts is not fully implemented.

## Arithmetic

### 64-bit integers (13 tests)
JavaScript uses 53-bit precision for numbers and 32-bit for bitwise operations:
- Large integer overflow (7 tests)
- 64-bit shift operations (3 tests)
- printf with unsigned/octal/hex of negative numbers (3 tests)

### Dynamic variable names (5 tests)
Runtime variable name construction in arithmetic like `$((f$x + 1))` is not implemented.

### Comments in arithmetic (5 tests)
Comments inside `$((...))` are not supported.

### Array operations (11 tests)
- Array comparison `(( a == b ))` (1 test)
- Array value coercion (8 tests)
- Associative array key expansion with `$var` (2 tests)

## Parameter Expansion

### Right brace in default value (75 tests)
Complex parameter expansions with `}` in default values like `${x:-a}b}` have parsing limitations.

### ${@:0:N} slice (5 tests)
Slicing positional parameters starting from position 0 (which includes `$0`) is not implemented.

### Backslash edge cases (5 tests)
Some backslash escape sequences in parameter expansion are not handled.

### Pattern with literal $ (1 test)
Strip patterns containing literal `$` characters have edge cases.

## Brace Expansion

### Variable expansion order (2 tests)
In bash, brace expansion happens before variable expansion. `{$a,b}` expands differently.

### Mixed case ranges (1 test)
Character ranges like `{z..A}` mixing cases are not implemented.

### Side effects (1 test)
Side effects in brace expansion like `{a,b}-$((i++))` don't evaluate correctly.

### Escaped braces (1 test)
Complex escaped braces in expansion are not handled.

### Tilde in braces (1 test)
`~{a,b}` tilde expansion within braces is not implemented.

## Control Flow

### errexit in compound commands (21 tests)
`set -e` (errexit) doesn't interact correctly with:
- Brace groups `{ }`
- Pipelines
- Subshells

### Redirect on control flow (1 test)
Redirections on `break`, `continue`, `return` are not implemented.

## Quoting

### Backtick quoting (6 tests)
Complex escape sequences within backticks `` `...` `` are not fully supported.

### Unterminated quote errors (4 tests)
Parse error messages for unterminated quotes differ from bash.

## Conditional Expressions

### [[ ]] edge cases (7 tests)
- Runtime evaluation via variable expansion
- Environment variable prefix
- Arguments resembling operators

### Tilde in [[ ]] (1 test)
Tilde expansion edge cases within `[[ ]]`.

## Functions

### Name with expansion (3 tests)
Function names containing `$` or command substitution are not supported.

### Here-doc after definition (1 test)
`func() { } <<EOF` syntax is not implemented.

## IFS and Splitting

### Special IFS values (7 tests)
IFS with newline, backslash, or empty string has edge cases.

### IFS with newline (1 test)
`IFS=$'\n'` behavior differs in some contexts.

## Here-Documents

### Edge cases (11 tests)
- Quoted delimiters with special characters
- Multiple here-docs on same line
- Here-doc after function definition

## printf

### %q format (14 tests)
The `%q` format for shell quoting and `set` output format are not implemented.

### strftime format (4 tests)
The `%(format)T` strftime format is not implemented.

## Parsing

### Parse error detection (16 tests)
Some parse error messages and detection differ from bash.

### Newlines in compound lists (1 test)
Newline handling in some compound command contexts.

### Variable vs redirect ambiguity (1 test)
`x=1>file` parsing ambiguity.

## Scoping

### Temp binding edge cases (9 tests)
Temporary variable bindings (`VAR=value command`) have edge cases with:
- Dynamic local variables
- Nested temp bindings
- Mutation within temp scope

## exec Builtin

### Special behaviors (2 tests)
Some `exec` edge cases without arguments or with special redirections.

## Special Builtins

### Redefinition (1 test)
Redefining special builtins like `eval`, `export` as functions is not implemented.

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

---

## Out of Scope

The following are intentionally not implemented as they are outside the scope of bash-env:

### Interactive shell invocation (81 tests)
Tests requiring `$SH -c` or `$SH -i` to spawn subshells.

### Oils-specific features (13 tests)
YSH/Oils extensions like `shopt -s ysh:*`, `strict_arg_parse`, `command_sub_errexit`.
