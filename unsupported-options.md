# BashEnv - Unsupported Features & Implementation Plan

This document tracks features **not yet implemented** in BashEnv, prioritized by impact for AI agent use cases.

Last updated: 2024-12

---

## Implementation Priority Overview

### Tier 1: Critical (Blocking for Common Scripts)
1. `return` builtin - Function exit codes
2. `set -u` (nounset) - Catch variable typos
3. `eval` builtin - Dynamic command execution
4. `shift` builtin - Process positional parameters

### Tier 2: High Value (Enables More Use Cases)
5. Brace expansion `{a,b,c}`, `{1..10}` - AST exists, needs execution
6. `mktemp` command - Safe temporary files
7. `seq` command - Number sequences
8. `trap` builtin - Cleanup/error handling
9. Bash arrays `arr=(a b c)` - AST exists, needs execution

### Tier 3: Nice to Have
10. `type`/`command` builtins - Check command existence
11. `set -x` (xtrace) - Debug output
12. `getopts` builtin - Option parsing
13. Process substitution `<(cmd)` - AST exists, needs execution

---

## Tier 1: Critical Missing Features

### `return` Builtin

**Status**: Not implemented
**Impact**: HIGH - Breaks any function that needs to return an exit code
**Implementation**: Follow `break`/`continue` pattern with `ReturnError`

```bash
# Currently broken:
check_file() {
  [ -f "$1" ] || return 1
  cat "$1"
}
check_file /etc/passwd || echo "not found"
```

**Files to modify**:
- `src/interpreter/control-flow.ts` - Add `ReturnError` class
- `src/interpreter/builtins/return.ts` - New file
- `src/interpreter/builtins/index.ts` - Export handler
- `src/interpreter/interpreter.ts` - Handle in `runCommand`
- `src/interpreter/functions.ts` - Catch `ReturnError` in `callFunction`

### `set -u` (nounset)

**Status**: Not implemented
**Impact**: HIGH - Can't catch variable typos, common in robust scripts
**Implementation**: Add to `InterpreterState.options`, check in variable expansion

```bash
set -u
echo $UNDEFINED_VAR  # Should error, currently expands to empty
```

**Files to modify**:
- `src/interpreter/types.ts` - Add `nounset` to options
- `src/interpreter/builtins/set.ts` - Handle `-u`/`+u`
- `src/interpreter/expansion.ts` - Check option before expanding undefined vars

### `eval` Builtin

**Status**: Not implemented
**Impact**: HIGH - Dynamic command execution, common in scripts
**Implementation**: Parse and execute string argument

```bash
cmd="echo hello"
eval "$cmd"  # Should print "hello"
```

**Files to modify**:
- `src/interpreter/builtins/eval.ts` - New file
- `src/interpreter/builtins/index.ts` - Export handler
- `src/interpreter/interpreter.ts` - Handle in `runCommand`

### `shift` Builtin

**Status**: Not implemented
**Impact**: MEDIUM-HIGH - Processing command-line arguments in loops
**Implementation**: Modify positional parameters in state

```bash
while [ $# -gt 0 ]; do
  echo "$1"
  shift
done
```

**Files to modify**:
- `src/interpreter/builtins/shift.ts` - New file
- `src/interpreter/types.ts` - May need positional params tracking
- `src/interpreter/builtins/index.ts` - Export handler

---

## Tier 2: High Value Features

### Brace Expansion

**Status**: AST support exists (`BraceExpansionPart`), execution not wired
**Impact**: MEDIUM - Convenient file operations, sequences
**Implementation**: Expand in `expansion.ts`

```bash
echo {a,b,c}     # Should print: a b c
echo {1..5}      # Should print: 1 2 3 4 5
touch file{1,2,3}.txt
```

**Files to modify**:
- `src/interpreter/expansion.ts` - Handle `BraceExpansionPart`
- `src/parser/` - Verify brace expansion parsing works

### `mktemp` Command

**Status**: Not implemented
**Impact**: MEDIUM - Safe temporary file/directory creation
**Implementation**: Generate unique paths in virtual FS

```bash
tmpfile=$(mktemp)
tmpdir=$(mktemp -d)
```

**Files to create**:
- `src/commands/mktemp/mktemp.ts`
- `src/commands/mktemp/mktemp.test.ts`

### `seq` Command

**Status**: Not implemented
**Impact**: MEDIUM - Generate number sequences for loops
**Implementation**: Simple number generator

```bash
for i in $(seq 1 10); do echo $i; done
seq 5         # 1 2 3 4 5
seq 2 5       # 2 3 4 5
seq 1 2 10    # 1 3 5 7 9
```

**Files to create**:
- `src/commands/seq/seq.ts`
- `src/commands/seq/seq.test.ts`

### `trap` Builtin

**Status**: Not implemented
**Impact**: MEDIUM - Cleanup handlers, error handling
**Implementation**: Store trap handlers in state, execute on signals/exit

```bash
trap 'rm -f $tmpfile' EXIT
trap 'echo "Error on line $LINENO"' ERR
```

**Files to modify**:
- `src/interpreter/types.ts` - Add trap handlers to state
- `src/interpreter/builtins/trap.ts` - New file
- `src/interpreter/interpreter.ts` - Trigger traps on exit/error

### Bash Arrays

**Status**: AST support exists (`ArrayAssignment`), execution not wired
**Impact**: MEDIUM - Complex data manipulation
**Implementation**: Store arrays in state, expand `${arr[@]}`

```bash
arr=(one two three)
echo ${arr[0]}      # one
echo ${arr[@]}      # one two three
echo ${#arr[@]}     # 3
```

**Files to modify**:
- `src/interpreter/types.ts` - Add array storage to state
- `src/interpreter/expansion.ts` - Handle array expansion
- `src/interpreter/builtins/` - Handle array assignment

---

## Tier 3: Nice to Have

### `type` / `command` Builtins

**Status**: Not implemented
**Impact**: LOW-MEDIUM - Check command availability

```bash
type git          # git is /usr/bin/git
command -v git    # /usr/bin/git (or empty + exit 1)
```

### `set -x` (xtrace)

**Status**: Not implemented
**Impact**: LOW-MEDIUM - Debug output

```bash
set -x
echo "hello"  # Should print: + echo hello\nhello
```

### `getopts` Builtin

**Status**: Not implemented
**Impact**: LOW - Parse options in scripts

```bash
while getopts "ab:c" opt; do
  case $opt in
    a) echo "option a";;
    b) echo "option b: $OPTARG";;
  esac
done
```

### Process Substitution

**Status**: AST support exists (`ProcessSubstitutionPart`), not wired
**Impact**: LOW - Advanced piping

```bash
diff <(ls dir1) <(ls dir2)
```

### `pushd` / `popd`

**Status**: Not implemented
**Impact**: LOW - Directory stack navigation

### `wait`

**Status**: Not implemented
**Impact**: LOW - Background processes not supported anyway

---

## Missing Commands by Category

### High Priority (AI Agent Use)

| Command | Example | Status | Notes |
|---------|---------|--------|-------|
| `mktemp` | `mktemp -d` | Not impl | Safe temp files |
| `seq` | `seq 1 10` | Not impl | Number sequences |
| `timeout` | `timeout 5 cmd` | Not impl | Prevent hanging |
| `yes` | `yes \| cmd` | Not impl | Auto-answer |

### Text Processing

| Command | Example | Status | Notes |
|---------|---------|--------|-------|
| `column` | `column -t` | Not impl | Format tabular output |
| `paste` | `paste f1 f2` | Not impl | Merge lines |
| `join` | `join f1 f2` | Not impl | Join on field |
| `comm` | `comm f1 f2` | Not impl | Compare sorted files |
| `fold` | `fold -w 80` | Not impl | Wrap lines |
| `nl` | `nl file` | Not impl | Number lines |
| `rev` | `rev` | Not impl | Reverse lines |
| `expand` | `expand -t 4` | Not impl | Tabs to spaces |

### Data Processing

| Command | Example | Status | Notes |
|---------|---------|--------|-------|
| `md5sum` | `md5sum file` | Not impl | MD5 checksum |
| `sha256sum` | `sha256sum file` | Not impl | SHA256 checksum |
| `xxd` | `xxd file` | Not impl | Hex dump |
| `od` | `od -c file` | Not impl | Octal dump |

### File Operations

| Command | Example | Status | Notes |
|---------|---------|--------|-------|
| `file` | `file unknown` | Not impl | Detect file type |
| `split` | `split -l 1000` | Not impl | Split files |
| `install` | `install -m 755` | Not impl | Copy with perms |

### Archive (Lower Priority - Virtual FS)

| Command | Notes |
|---------|-------|
| `tar` | Complex, may need library |
| `gzip`/`gunzip` | Compression |
| `zip`/`unzip` | ZIP archives |

---

## Command Option Gaps

### `sed` - Missing

- Branching (`b`, `t`, `:label`) - Complex conditional scripts
- `-f file` - Read script from file

### `awk` - Missing

- User-defined functions (`function name() {}`)
- I/O redirection within awk (`print > "file"`, `getline < "file"`)

### `touch` - Major Limitation

- Does not update timestamps on existing files (only creates)
- Missing: `-a`, `-m`, `-d`, `-t`, `-r` options

### `tail` - Missing

- `-f` follow mode (log monitoring) - may not suit virtual env
- `-r` reverse display

### `find` - Missing

- `-user`, `-group` - Owner matching
- `-atime`, `-ctime` - Access/change time filtering
- `-prune` - Skip directories

### `curl` - Missing Options

| Option | Long Form | Why It Matters |
|--------|-----------|----------------|
| `-u` | `--user` | HTTP basic auth |
| `-A` | `--user-agent` | Set User-Agent |
| `-b`/`-c` | `--cookie`/`--cookie-jar` | Cookie handling |
| `-F` | `--form` | Multipart form upload |
| `-T` | `--upload-file` | PUT upload |
| `-m` | `--max-time` | Request timeout |
| `--retry` | | Retry on failure |

---

## Shell Language Features Not Planned

| Feature | Why |
|---------|-----|
| Coprocesses (`coproc`) | Complex, rare |
| `select` loops | Interactive menus |
| Real process management | No background jobs |
| Network commands (`wget`, `ssh`, `nc`) | Use `curl` with allow-list |

---

## Already Implemented

### Shell Builtins
`cd`, `export`, `unset`, `exit`, `local`, `set` (-e, -o pipefail), `break`, `continue`, `read`, `source`/`.`, `test`/`[`/`[[`

### Shell Features
- `if`/`elif`/`else`/`fi`, `for`, `while`, `until`, `case...esac`
- C-style for loops `for ((i=0; i<10; i++))`
- Functions with `local` variables
- Pipes, redirections (all types)
- Variable expansion (extensive: `${VAR:-default}`, `${VAR#pattern}`, etc.)
- Command substitution `$(cmd)`
- Arithmetic expansion `$((expr))` and `(( ))`
- Conditional `[[ ]]` with regex `=~`
- Glob patterns, negation `!`, here documents

### Commands (48 total)
`alias`, `awk`, `base64`, `basename`, `bash`, `cat`, `chmod`, `clear`, `cp`, `curl`, `cut`, `date`, `diff`, `dirname`, `du`, `echo`, `env`, `false`, `find`, `grep`, `head`, `history`, `html-to-markdown`, `jq`, `ln`, `ls`, `mkdir`, `mv`, `printf`, `printenv`, `pwd`, `readlink`, `rm`, `sed`, `sh`, `sleep`, `sort`, `stat`, `tail`, `tee`, `touch`, `tr`, `tree`, `true`, `unalias`, `uniq`, `wc`, `xargs`

---

## Implementation Notes

### Pattern for New Builtins

Follow existing patterns in `src/interpreter/builtins/`:

1. Create handler file (e.g., `return.ts`)
2. Export from `index.ts`
3. Add case in `interpreter.ts` `runCommand()`
4. For control flow, create custom Error class (see `BreakError`, `ContinueError`)

### Pattern for New Commands

1. Create directory `src/commands/<name>/`
2. Create `<name>.ts` with command implementation
3. Create `<name>.test.ts` with unit tests
4. Register in `src/commands/registry.ts`
5. Add comparison tests if behavior is complex

### Testing Requirements

- Unit tests in command directory
- Comparison tests for complex behavior (`src/comparison-tests/`)
- Use `pnpm dev:exec` for quick testing
- All tests must pass before merge
