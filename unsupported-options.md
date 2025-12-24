# BashEnv - Unsupported Features

This document lists features **not yet implemented** in BashEnv. Use this as a reference for future development priorities.

---

## Shell Builtins (Not Implemented)

These builtins are commonly used by AI agents and scripts:

| Builtin | Syntax | Why It Matters (AI Agent Use) |
|---------|--------|-------------------------------|
| `eval` | `eval "$cmd"` | Dynamic command execution from strings |
| `trap` | `trap 'cleanup' EXIT` | Error handling, cleanup on exit |
| `shift` | `shift`, `shift 2` | Process positional parameters |
| `getopts` | `getopts "ab:" opt` | Parse command-line options |
| `type` | `type cmd` | Check if command exists |
| `command` | `command -v git` | Check command availability |
| `return` | `return 0` | Return from functions with exit code |
| `pushd`/`popd` | `pushd /tmp` | Directory stack navigation |
| `wait` | `wait $pid` | Wait for background processes |

### `set` Options (Partially Implemented)

Currently `-e` (errexit) and `-o pipefail` are supported. Missing:

| Option | Long Form | Why It Matters |
|--------|-----------|----------------|
| `-u` | `set -o nounset` | Error on unset variables (catch typos) |
| `-x` | `set -o xtrace` | Print commands before execution (debugging) |
| `-f` | `set -o noglob` | Disable glob expansion |

---

## Missing Commands

### High Priority for AI Agents

| Command | Example | Why It Matters |
|---------|---------|----------------|
| `sleep` | `sleep 1` | Delays, rate limiting |
| `timeout` | `timeout 5 cmd` | Prevent hanging commands |
| `mktemp` | `mktemp -d` | Create temporary files/directories safely |
| `seq` | `seq 1 10` | Generate number sequences |
| `patch` | `patch < fix.patch` | Apply patches |
| `yes` | `yes \| cmd` | Auto-answer prompts |

### Text Processing

| Command | Example | Why It Matters |
|---------|---------|----------------|
| `column` | `column -t` | Format tabular output |
| `paste` | `paste file1 file2` | Merge lines side-by-side |
| `join` | `join file1 file2` | Join files on common field |
| `comm` | `comm file1 file2` | Compare sorted files |
| `fold` | `fold -w 80` | Wrap long lines |
| `nl` | `nl file` | Number lines |
| `rev` | `rev` | Reverse lines |
| `expand` | `expand -t 4` | Convert tabs to spaces |

### Data Processing

| Command | Example | Why It Matters |
|---------|---------|----------------|
| `md5sum` | `md5sum file` | File checksums |
| `sha256sum` | `sha256sum file` | Secure checksums |
| `xxd` | `xxd file` | Hex dump |
| `od` | `od -c file` | Octal/other dumps |

### File Operations

| Command | Example | Why It Matters |
|---------|---------|----------------|
| `file` | `file unknown` | Determine file type |
| `split` | `split -l 1000` | Split large files |
| `csplit` | `csplit file '/pattern/'` | Context-based splitting |
| `install` | `install -m 755` | Copy with permissions |
| `shred` | `shred file` | Secure delete |

### Archive/Compression (Lower Priority - Virtual FS)

| Command | Example | Notes |
|---------|---------|-------|
| `tar` | `tar -xzf` | Archive extraction |
| `gzip`/`gunzip` | `gzip file` | Compression |
| `zip`/`unzip` | `unzip file.zip` | ZIP archives |

### Network

| Command | Notes |
|---------|-------|
| `wget` | HTTP downloads (use `curl -O` instead) |
| `ssh`/`scp` | Remote access - out of scope |
| `nc` (netcat) | Network connections - out of scope |

---

## Shell Language Features (Not Implemented)

### Secondary Missing Features

| Feature | Syntax | Why It Matters |
|---------|--------|----------------|
| Bash arrays | `arr=(a b c)`, `${arr[@]}` | Indexed and associative arrays in bash |
| Brace expansion | `{a,b,c}`, `{1..10}` | Generate sequences and combinations |
| Process substitution | `<(cmd)`, `>(cmd)` | Treat command output as a file |
| `select` loops | `select x in a b c` | Interactive menu selection |
| `declare`/`readonly` | `declare -i`, `readonly` | Variable attributes and constants |
| Coprocesses | `coproc cmd` | Bidirectional pipe to command |

---

## Command Options (Not Implemented)

### Text Processing

**sed** - Missing:
- Branching (`b`, `t`, `:label`) - Complex conditional scripts
- `-f file` - Read script from file

**awk** - Missing:
- User-defined functions (`function name() {}`)
- I/O redirection within awk (`print > "file"`, `getline < "file"`)

### File Operations

**touch** - Major limitation:
- Does not update timestamps on existing files (only creates new files)
- Missing: `-a`, `-m`, `-d`, `-t`, `-r` options

**tail** - Missing:
- `-f` follow mode (log monitoring)
- `-r` reverse display

**find** - Missing:
- `-user`, `-group` - Owner matching
- `-atime`, `-ctime` - Access/change time filtering
- `-prune` - Skip directories

### curl

**curl** - Missing options:

| Option | Long Form | Why It Matters |
|--------|-----------|----------------|
| `-u` | `--user USER:PASS` | HTTP basic authentication |
| `-A` | `--user-agent STRING` | Set User-Agent header |
| `-b` | `--cookie DATA` | Send cookies |
| `-c` | `--cookie-jar FILE` | Save cookies to file |
| `-e` | `--referer URL` | Set Referer header |
| `-F` | `--form NAME=VALUE` | Multipart form data upload |
| | `--data-urlencode` | URL-encode POST data |
| | `--data-binary` | Send binary data exactly |
| `-T` | `--upload-file FILE` | Upload file (PUT) |
| `-C` | `--continue-at OFFSET` | Resume transfer |
| | `--connect-timeout SECS` | Connection timeout |
| `-m` | `--max-time SECS` | Maximum time for request |
| `-r` | `--range RANGE` | Request byte range |
| | `--retry NUM` | Retry on failure |
| `-x` | `--proxy URL` | Use proxy server |
| `-k` | `--insecure` | Allow insecure SSL |
| | `--cert FILE` | Client certificate |
| | `--compressed` | Request compressed response |
| `-4` | `--ipv4` | Resolve to IPv4 only |
| `-6` | `--ipv6` | Resolve to IPv6 only |
| `-g` | `--globoff` | Disable URL globbing |
| | `--resolve HOST:PORT:ADDR` | Resolve host to IP |
| | Multiple URLs | Process multiple URLs |
| `-Z` | `--parallel` | Parallel transfers |

**curl** - Partial implementations:
- `-w, --write-out` - Only supports: `%{http_code}`, `%{content_type}`, `%{url_effective}`, `%{size_download}`

### Other Commands

**tree** - Missing:
- File metadata (`-s`, `-p`, `-D`)
- Filtering (`-I`, `-P` patterns)
- Sorting options (`-t`, `-r`)

---

## Common Missing Features Across Commands

- Interactive prompts (`-i`)
- Backup functionality (`-b`, `--backup`)
- Color output (`--color`)
- Real ownership (user/group hardcoded)

---

## Implementation Priority (AI Agent Focus)

### Tier 1: Critical for AI Agents ✅ DONE

All Tier 1 features have been implemented:
- `jq` - JSON parsing
- `read` - Parse input line-by-line
- `set -o pipefail` - Detect failures in pipelines
- `source` / `.` - Modular scripts, load configs
- `diff` - Compare files, detect changes
- `false` - Testing, conditional logic
- `break`/`continue` - Loop control

### Tier 2: Very Useful

| # | Feature | Type | Why It Matters |
|---|---------|------|----------------|
| 1 | `set -u` (nounset) | option | Catch variable typos |
| 2 | `mktemp` | command | Safe temporary files |
| 3 | `seq` | command | Generate number sequences |
| 4 | `trap` | builtin | Cleanup on exit/error |
| 5 | `eval` | builtin | Dynamic command execution |

### Tier 3: Nice to Have

| # | Feature | Type | Why It Matters |
|---|---------|------|----------------|
| 6 | Brace expansion | shell | `{a,b,c}`, `{1..10}` |
| 7 | Bash arrays | shell | `arr=(a b c)`, `${arr[@]}` |
| 8 | `set -x` (xtrace) | option | Debug output |
| 9 | `shift` | builtin | Process arguments |
| 10 | `return` | builtin | Function exit codes |
| 11 | `column` | command | Format tabular output |
| 12 | `md5sum`/`sha256sum` | command | File checksums |

### Lower Priority

| Feature | Type | Notes |
|---------|------|-------|
| `sleep` | command | Delays (may not suit virtual env) |
| `timeout` | command | Command timeouts |
| `yes` | command | Auto-answer prompts |
| `getopts` | builtin | Option parsing |
| `pushd`/`popd` | builtin | Directory stack |
| Process substitution | shell | `<(cmd)` - complex feature |

### Not Planned

- **Network commands** (`wget`, `ssh`, `nc`) - Out of scope (use `curl` with allow-list)
- **Interactive features** (`select` loops, interactive prompts)
- **Real process management** (`wait`, `kill`, background jobs)

---

## Already Implemented ✅

### Shell Features
- `if`/`elif`/`else`/`fi` statements
- `for` loops (including `for x in list`)
- `while` and `until` loops
- User-defined functions (`function name {}` and `name() {}`)
- `local` variables in functions
- Variable expansion (`$VAR`, `${VAR}`, `${VAR:-default}`)
- Pipes (`|`), redirections (`>`, `>>`, `2>`, `<`, `2>&1`)
- Command chaining (`&&`, `||`, `;`)
- Glob patterns (`*`, `?`, `[...]`)
- Negation operator (`!`)
- **Command substitution** `$(cmd)` - Capture command output
- **Arithmetic expansion** `$((expr))` - Math operations (+, -, *, /, %, **, comparisons, logical, bitwise)
- **`case...esac` statements** - Switch-case with pattern matching
- **`[[ ]]` test expressions** - String/numeric/file tests, pattern matching, regex `=~`
- **Here documents** `<<EOF` - Multi-line input to commands
- **`set -e`** (errexit) - Exit immediately on command failure
- **`set -o pipefail`** - Pipeline fails if any command fails
- **`break`/`continue`** - Loop control with optional level (`break 2`)

### Shell Builtins
- `cd` - Change directory
- `export` - Set environment variables
- `unset` - Remove variables/functions
- `exit` - Exit shell with code
- `local` - Declare local variables in functions
- `set` - Shell options (`-e` errexit, `-o pipefail`)
- `test` / `[` / `[[` - Conditional expressions
- `read` - Read input line-by-line (`-r`, `-d`, `-p` options)
- `source` / `.` - Execute commands from file in current environment
- `break` / `continue` - Loop control

### Commands (Well-Supported)
- **grep**: `-E`, `-F`, `-i`, `-v`, `-w`, `-c`, `-l`, `-L`, `-n`, `-h`, `-o`, `-q`, `-r`, `-R`, `-A`, `-B`, `-C`, `--include`, `--exclude`
- **sed**: `-n`, `-i`, `-e`, `-E`, `s///`, `d`, `p`, `a`, `i`, `c`, `h/H/g/G/x`, `n`, `N`, `q`, `y`, `=`
- **awk**: `-F`, `-v`, `BEGIN`/`END`, pattern ranges, `getline`, math functions, arrays, control structures
- **find**: `-name`, `-type`, `-size`, `-mtime`, `-perm`, `-exec`, `-delete`, `-print0`
- **ls**: `-a`, `-l`, `-h`, `-S`, `-r`, `-R`, `-t`
- **sort**: `-r`, `-n`, `-u`, `-k`, `-t`, `-f`, complex key syntax
- **tr**: `-d`, `-s`, `-c`, character classes
- **jq**: `.key`, `.[n]`, `.[]`, pipes, builtins (`keys`, `values`, `length`, `type`, `sort`, `unique`, `add`, etc.)
- **diff**: `-u`, `-q`, `-s`, `-i` (unified diff format, uses `diff` npm package)
- **date**: `+FORMAT`, `-d`, `-u`, `-I`, `-R` (format specifiers: `%Y`, `%m`, `%d`, `%H`, `%M`, `%S`, etc.)
- **base64**: `-d`, `-w` (encode/decode)
- **curl**: `-X`, `-H`, `-d`, `--data-raw`, `-o`, `-O`, `-I`, `-i`, `-s`, `-S`, `-f`, `-L`, `--max-redirs`, `-w`, `-v` (requires `network.allowedUrlPrefixes` config; URL allow-list enforced)
- **html-to-markdown**: `-b`, `-c`, `-r`, `--heading-style` (non-standard, uses turndown npm package)

### All Implemented Commands
`alias`, `awk`, `base64`, `basename`, `bash`, `cat`, `chmod`, `clear`, `cp`, `curl`, `cut`, `date`, `diff`, `dirname`, `du`, `echo`, `env`, `false`, `find`, `grep`, `head`, `history`, `html-to-markdown`, `jq`, `ln`, `ls`, `mkdir`, `mv`, `printf`, `pwd`, `readlink`, `rm`, `sed`, `sort`, `stat`, `tail`, `tee`, `touch`, `tr`, `tree`, `true`, `uniq`, `wc`, `xargs`
