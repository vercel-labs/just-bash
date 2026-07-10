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

## 1.1 Trust Assumptions

The following components are **trusted** and outside the scope of just-bash's runtime defenses:

- **Host-provided `fs`, `fetch`, `customCommands`, and transform plugins**: These are supplied by the embedding application. A compromised or malicious host hook can bypass all sandboxing by design — just-bash protects untrusted *scripts*, not untrusted *hosts*.
- **The Node.js runtime and underlying OS**: just-bash assumes the Node.js binary, V8, and OS kernel are not compromised. Exploits targeting V8 internals or kernel vulnerabilities are out of scope.
- **Dependencies**: Supply-chain attacks via npm dependencies are a deployment-level concern (addressed by lockfiles, audits, etc.), not a runtime defense.

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
│  │  │ Blocks: Function, eval, setTimeout, process.*,   │    │  │
│  │  │   performance, Module._resolveFilename,           │    │  │
│  │  │   __defineGetter__/__defineSetter__, stdout/stderr │    │  │
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
| Glob depth bomb | `**/**/**/**/**/**/x` | MAX_GLOBSTAR_SEGMENTS (5) rejects excessive `**` segments | `src/shell/glob.ts` |
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
| Module._resolveFilename() | Module resolution (require + import) | Blocked by defense-in-depth proxy — partially mitigates `import()` for file-based specifiers | `src/security/defense-in-depth-box.ts` |
| process.mainModule | Access main module (CJS) | Blocked via defineProperty getter | `src/security/defense-in-depth-box.ts` |
| Error.prepareStackTrace | Leak Function via stack frames | Set blocked via defineProperty | `src/security/defense-in-depth-box.ts` |
| WebAssembly | Compile/run arbitrary code | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| Proxy constructor | Create intercepting proxies | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| WeakRef/FinalizationRegistry | GC observation/side channels | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| process.chdir() | Confuse CWD tracking | Blocked by defense-in-depth proxy | `src/security/blocked-globals.ts` |
| **dynamic import()** | `import('/tmp/evil.js')` | **BLOCKED**: `Module._resolveFilename` blocks file specifiers; ESM loader hooks block `data:`/`blob:` URLs (Node.js 20.6+; see §4.1) | `src/security/defense-in-depth-box.ts` |
| child_process | spawn/exec/fork | Not imported anywhere; no code path from interpreter. **With `javascript` enabled**, a *virtual* `child_process` module exists *inside* QuickJS (`js-exec-worker.ts:261–280`) whose `execSync`/`spawnSync` re-enter the sandbox via the SAB bridge, not the host OS — see §4.11 | Architecture (+ virtual shim, §4.11) |

### 3.6 Information Disclosure

| Vector | Description | Defense | Files |
|--------|-------------|---------|-------|
| process.env | Leak API keys, secrets | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| process.argv | CLI args with secrets | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| process.execPath | Reveal Node.js path | Blocked via defineProperty | `src/security/defense-in-depth-box.ts` |
| process.stdout/stderr | Bypass interpreter output | Blocked by defense-in-depth (workers); skipped in main thread due to console.log dependency | `src/security/blocked-globals.ts` |
| process.connected | IPC connection status | Blocked in **worker contexts only** (WorkerDefenseInDepth) | `src/security/defense-in-depth-box.ts` |
| process.send | IPC messaging to parent | Blocked in **worker contexts only** (WorkerDefenseInDepth); main thread skipped to avoid interfering with test runners/process managers | `src/security/blocked-globals.ts` |
| process.channel | IPC channel access | Blocked in **worker contexts only** (WorkerDefenseInDepth); main thread skipped for same reason | `src/security/blocked-globals.ts` |
| Host PID/UID | Expose process identity | Virtualized (processInfo option, defaults: pid=1, uid=1000) | `src/Bash.ts` |
| hostname/whoami/uname | System enumeration | Return generic/virtual values | `src/commands/hostname/` |
| Host timezone | `date` leaks host TZ via `%Z`/`%z` or time values | Defaults to UTC; only honored when the host explicitly sets `$TZ` to an IANA zone | `src/commands/date/date.ts` |
| Error messages | Reveal file paths | `sanitizeError()` in FS layers + `sanitizeErrorMessage()` at all error choke points (builtin-dispatch, Bash.ts, CLI, Python bridge) | `src/fs/real-fs-utils.ts`, `src/interpreter/builtin-dispatch.ts`, `src/Bash.ts`, `src/cli/just-bash.ts` |
| Timing side-channels | hrtime, cpuUsage, memoryUsage | Blocked by defense-in-depth | `src/security/blocked-globals.ts` |
| performance.now() | Sub-ms timing for side-channels | Blocked by defense-in-depth; internal uses pre-capture `_performanceNow` | `src/security/blocked-globals.ts`, `src/timers.ts` |

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
| Source depth bomb | Self-sourcing script | maxSourceDepth (100) | `src/limits.ts`, `src/interpreter/builtins/source.ts` |
| FD exhaustion | `exec N>/dev/null` in loop | `checkFdLimit()` enforces maxFileDescriptors (1024) before every `fileDescriptors.set()` | `src/interpreter/helpers/result.ts` |
| Glob `**` depth | `**/**/**/**/**/**/x` | MAX_GLOBSTAR_SEGMENTS (5) rejects patterns with excessive recursive segments | `src/shell/glob.ts` |

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
| `__defineGetter__`/`__defineSetter__` | Inject getters/setters on prototypes | Blocked by defense-in-depth (strategy: "throw") | `src/security/blocked-globals.ts` |
| `__lookupGetter__`/`__lookupSetter__` | Introspect prototype getters/setters | Blocked by defense-in-depth (strategy: "throw") | `src/security/blocked-globals.ts` |
| JSON/Math mutation | Poison shared utility objects | Frozen by defense-in-depth (strategy: "freeze") | `src/security/blocked-globals.ts` |

---

## 4. Known Gaps & Residual Risks

### 4.1 Dynamic import() Mitigated (Three Layers)

**Risk**: LOW (comprehensively mitigated on Node.js 20.6+)

Dynamic `import()` is a language-level keyword, not a property on any object. It cannot be intercepted by Proxy or defineProperty. However, it CAN be intercepted via Node.js ESM loader hooks.

**Attack scenario**: If attacker achieves JS code execution → `import('data:text/javascript,...')` → full escape.

**Mitigations** (three layers):
1. **Module._resolveFilename blocked** — file-based `import()` specifiers (e.g., `import('/tmp/evil.js')`) are intercepted at the CJS module resolution level and blocked
2. **ESM loader hooks** — `module.registerHooks()` (Node.js 23.5+) or `module.register()` (Node.js 20.6+) installs hooks that reject `data:` and `blob:` URL specifiers process-wide. No CLI flags required.
3. **Filesystem restrictions** — OverlayFs writes to memory only, InMemoryFs has no real FS backing, so attacker cannot write .js files to the real filesystem
4. **Architecture** — no code path exists from bash interpretation to JS execution; all paths (Function, eval, setTimeout, constructor chains) are blocked

**Residual risk**: On Node.js < 20.6 where `module.register()` is unavailable, `data:` URL imports remain unblockable. For those deployments, use `--experimental-loader` CLI hooks as an additional layer.

**Note**: The ESM loader hooks are process-wide and permanent (cannot be unregistered). This is an accepted trade-off — `data:` and `blob:` URL imports are essentially never used in production Node.js applications.

### 4.2 Pre-Captured References Bypass Defense-in-Depth

**Risk**: LOW (defense-in-depth is secondary)

If any code captures a reference to `Function`, `eval`, etc. **before** the defense-in-depth box is activated, that reference bypasses the proxy. This is documented and tested.

**Mitigation**: Defense-in-depth is a secondary layer. The primary defense is that no code path exists from bash interpretation to JavaScript execution.

**Architectural invariant**: §4.2 and §4.3 both depend on a single invariant — **no bash→host-JS code path**: there must be no route by which an untrusted bash script can reach the host's `eval`, `new Function`, or dynamic `import()`, the only primitives that could turn these defense-in-depth gaps into a real escape. While that invariant holds, §4.2 and §4.3 stay LOW (defense-in-depth is secondary). If the invariant ever breaks, these residuals become **CRITICAL** — a pre-captured `Function` reference (§4.2) or a `globalThis.Function` reassignment (§4.3) would then be a direct JS-execution escape. The invariant is **guarded by the `check-banned-patterns` linter** (`scripts/check-banned-patterns.js`), which bans `eval(`, `new Function(`, and non-literal dynamic `import()` in source, so a path to host-JS code execution cannot be introduced silently. See §4.1 (three-layer `import()` mitigation) and §4.11 (the opt-in js-exec surface, the *only* intentional guest-JS execution path, which keeps the guest off the host's `eval`/`Function`).

### 4.3 globalThis Property Reassignment

**Risk**: LOW (defense-in-depth is secondary)

Attackers within the sandbox could overwrite `globalThis.Function` or use `Object.defineProperty` to replace blocking proxies. This is documented and tested.

**Mitigation**: Same as §4.2 — relies on no code path existing, not on the monkey-patching being unbypassable.

**Architectural invariant**: See §4.2 — relies on the same no-bash→host-JS-code-path invariant, which is guarded by the `check-banned-patterns` linter (`scripts/check-banned-patterns.js` bans `eval(`, `new Function(`, non-literal `import()`). Becomes **CRITICAL** if that invariant ever breaks.

### 4.4 Signal/Job Control Not Fully Modeled

**Risk**: LOW

Bash `trap` command has limited security testing. Background job control (`&`, `fg`, `bg`) not systematically tested.

**Mitigation**: just-bash doesn't spawn real processes, so signals/jobs operate within the virtual model only.

### 4.5 Unicode/Encoding Edge Cases

**Risk**: LOW

No systematic testing for invalid UTF-8, homograph attacks, or RTL override characters. These are display/confusion attacks, not execution escape vectors.

### 4.6 File Descriptor Manipulation

**Risk**: LOW (mitigated)

FD exhaustion is now enforced: `checkFdLimit()` is called before every `fileDescriptors.set()` across interpreter.ts, redirections.ts, and subshell-group.ts, enforcing `maxFileDescriptors` (default: 1024). No tests for `/dev/fd/` access — the virtual filesystem doesn't implement `/dev/fd/`.

### 4.7 Python Execution Surface (When Enabled)

**Risk**: MEDIUM (intentional, opt-in, isolation by construction)

When `python: true`, CPython 3.13 Emscripten provides full Python execution via WASM. Unlike the previous Pyodide-based approach, CPython Emscripten has zero JS bridge code — `import js` fails with `ModuleNotFoundError` because the module simply doesn't exist in the binary. No Python-level sandbox is needed; isolation is by construction.

**Build-time restrictions** (capabilities removed from binary):
- No `-sMAIN_MODULE`: dynamic linking disabled, `dlopen` fails with "dynamic linking not enabled"
- No `-lnodefs.js`, `-lidbfs.js`, `-lproxyfs.js`, `-lworkerfs.js`: no host FS mount types available
- No `_ctypes` C extension: `import ctypes` fails with `ImportError`
- No `_emscripten_run_script`: JS eval not callable from WASM
- `__emscripten_system` patched to return -1 (no `child_process.spawnSync`)
- Test modules (`_testcapi`, `_testinternalcapi`, etc.) stripped from binary

**Runtime mitigations**:
- Disabled by default; must be explicitly enabled via `{ python: true }`
- 30-second timeout (`maxPythonTimeoutMs`; configurable)
- Fresh Worker thread per execution (EXIT_RUNTIME; no state leakage between runs)
- `WorkerDefenseInDepth` with only 2 exclusions: `shared_array_buffer`, `atomics`
- Stdlib shipped as `.pyc`-only zip in MEMFS (no real FS access, no runtime compilation)
- 18+ file operations (open, stat, glob, pathlib, shutil, etc.) redirected through `/host` mount
- C-level file operations (`_io.open`) also confined by Emscripten VFS (no NODEFS/NODERAWFS)
- HTTP bridge via custom HTTPFS mount at `/_jb_http` (requires `secureFetch` allow-list)
- Environment variables explicitly passed (no host `process.env` leakage)
- Raw TCP/UDP sockets blocked by Emscripten ("Host is unreachable")
- `os.system()` returns -1, `subprocess`/`os.popen()` raise `OSError`

**Accepted behaviors** (not vulnerabilities):
- Python's `eval()` and `exec()` execute arbitrary Python (same as bash `eval`; no JS escalation path)
- `/lib` (MEMFS stdlib) is writable within a single execution (each execution is fresh)
- Symlink targets are readable via `os.readlink()` but not followable outside root
- Python can allocate memory up to WASM limits (mitigated by 30s timeout)

### 4.8 Error Message Information Leakage

**Risk**: LOW (mitigated)

Error sanitization is now systematic: `sanitizeError()` in FS layers (OverlayFs, ReadWriteFs) strips `.path` from `ErrnoException` objects, and `sanitizeErrorMessage()` strips OS paths, Node.js internal module paths (`node:internal/...`), and stack traces from raw error messages at all major choke points (builtin-dispatch catch-all, `Bash.exec()` error handlers including SecurityViolationError and ExecutionLimitError, CLI error outputs, Python FS bridge). Remaining risk is limited to custom commands that catch and re-format errors without using the sanitization function.

### 4.9 Heredoc Expansion Interaction

**Risk**: LOW

Heredocs with variable expansion are size-limited (10MB) but nested heredocs with complex expansion haven't been exhaustively fuzzed.

### 4.10 Reflect Object Frozen But Available

**Risk**: LOW

`Reflect` is frozen (not blocked) in the defense-in-depth layer. `Reflect.construct`, `Reflect.apply` etc. remain callable but cannot construct `Function` directly because the `Function` constructor itself is blocked.

### 4.11 JavaScript Execution Surface (When Enabled)

**Risk**: MEDIUM (intentional, opt-in, isolation by construction)

When `javascript: true` — or an `invokeTool` hook is provided, which implicitly enables js-exec (`src/Bash.ts`) — the `js-exec` and `node` commands execute untrusted JavaScript/TypeScript inside QuickJS (compiled to WASM via Emscripten) in a dedicated Worker thread. The `node` command is a stub that reroutes to js-exec; both surface the same boundary. Like Python (§4.7), this is an opt-in code-execution surface whose safety rests on isolation by construction rather than on a JS-level sandbox over the host.

**Enabling the surface**: js-exec is registered only when `options.javascript || jsConfig.invokeTool` (`src/Bash.ts`). It is absent from the command registry and unreachable from any bash script unless the host explicitly turns it on. The `invokeTool` hook enables js-exec implicitly because the hook is meaningless without it.

**Host bridge (SharedArrayBuffer)**: User code runs inside QuickJS, which has no Node.js APIs of its own. A synchronous SharedArrayBuffer protocol (`src/commands/worker-bridge/protocol.ts`) bridges selected host capabilities back into the guest:
- **Virtual filesystem** — file read/write/stat are routed through the bridge to the in-memory OverlayFS, the same VFS the interpreter uses; no host-FS access.
- **`exec`** — `bridge-handler.ts` calls the host `exec` callback, which is `Bash.exec.bind(this)` (`src/Bash.ts`), i.e. it **re-enters the sandbox interpreter**, not the OS. Output is capped to the remaining execution deadline.
- **`fetch`** — Web Fetch API, gated by the host `secureFetch` allow-list (off by default).
- **`invokeTool`** — host-supplied tool hook for agent-driven tool calls; absent unless the host provides it.

**Virtual `child_process` shim**: Inside QuickJS, `import "child_process"` resolves to a **virtual module** (`js-exec-worker.ts:261–280`), not Node's `child_process`. Its `execSync`/`exec`/`spawnSync` route through `globalThis[Symbol.for('jb:exec')]` → the bridge → `Bash.exec`, so they re-enter the sandbox (no `spawn`/`fork`/OS process). This is the shim referenced from §3.5. Re-entrant js-exec is detected via AsyncLocalStorage and rejected to prevent deadlock ("recursive invocation is not supported").

**Isolation rests on**:
- **QuickJS WASM** — untrusted JS executes in the QuickJS interpreter within WASM linear memory; the guest has no access to Node.js host objects, only the four explicitly bridged primitives above.
- **Worker thread** — a dedicated worker per execution; terminated on timeout (`worker.terminate()`) and recycled after idle.
- **`WorkerDefenseInDepth`** — activated after QuickJS loads with only `shared_array_buffer`, `atomics`, `process_stdout`, `process_stderr` excluded (SAB/Atomics are required by the sync bridge; stdout/stderr because Emscripten routes WASM output through Node's console).
- **Memory cap** — QuickJS memory limited to 64MB (`MEMORY_LIMIT`, `js-exec-worker.ts`).
- **Timeout** — 10s default, 60s when network/fetch is enabled (`DEFAULT_JS_TIMEOUT_MS` / `DEFAULT_JS_NETWORK_TIMEOUT_MS`, `js-exec.ts`); enforced by terminating the worker.

**Accepted behaviors** (not vulnerabilities):
- `eval()`/`new Function()` inside QuickJS execute arbitrary *guest* JS — same posture as Python's `eval()`/`exec()` (§4.7); no host-JS escalation path because the guest cannot reach the host's `eval`/`Function`.
- The bridge `exec` re-enters the sandbox, so any command reachable from js-exec is one the host already permitted in the bash environment; it does not widen the command surface beyond what bash itself can reach.
- TS source is transpiled to JS before being handed to QuickJS; this is a guest-side convenience, not a host code path.

**Residual risk**: The security of this surface depends on the QuickJS/WASM boundary holding — i.e. the guest genuinely cannot reach host-JS primitives except through the four bridged calls above. The escape vectors to watch are a QuickJS/WASM breakout, or a bridge-call handler that acts on attacker-controlled arguments without validation (path validation in the FS bridge is delegated to the OverlayFs gates; `exec` re-enters the interpreter, which applies its own limits). Severity is **MEDIUM**, analogous to Python (§4.7): opt-in, isolated by construction, bounded by memory + timeout, and only as trustworthy as the WASM boundary it rests on. This surface is also the one residual that can weaken the no-bash→host-JS-code-path invariant of §4.2/§4.3 — but only if the WASM boundary is broken, since the guest is intentionally kept off the host's `eval`/`Function`/`import()`.

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
| **Error sanitization** | Secondary | Info disclosure | High — systematic at FS layers + all error choke points + node:internal paths |

---

## 6. Threat Scenarios & Verdicts

| # | Scenario | Path | Verdict |
|---|----------|------|---------|
| 1 | Read /etc/passwd | `cat /etc/passwd` → OverlayFs → not under root → ENOENT | **BLOCKED** (primary FS) |
| 2 | Symlink escape | `ln -s /etc/passwd x` → allowSymlinks=false → EPERM | **BLOCKED** (symlink policy) |
| 3 | Access process.env | No bash→JS path. If bug: defense-in-depth → throw | **BLOCKED** (arch + secondary) |
| 4 | Infinite loop | `while true; do :; done` → maxLoopIterations → throw | **BLOCKED** (limits) |
| 5 | Prototype pollution | `arr[__proto__]=evil` → Map/null-prototype → no effect | **BLOCKED** (data guards) |
| 6 | dynamic import() escape | Hypothetical JS exec → `import('data:...')` → ESM hooks block data:/blob: URLs | **BLOCKED** (Node.js 20.6+; residual on older) |
| 7 | Network exfiltration | `curl evil.com` → network off → curl not registered | **BLOCKED** (network isolation) |
| 8 | process.exit() | No bash→JS path. If bug: defense-in-depth → throw | **BLOCKED** (arch + secondary) |
| 9 | Brace expansion OOM | `{1..999999999}` → maxBraceExpansionResults → truncated | **BLOCKED** (limits) |
| 10 | Python escape | Python off by default. If on: worker + defense + virtual FS | **RESIDUAL RISK** (opt-in) |
| 11 | ReDoS via user regex | `[[ str =~ evil_pattern ]]` → re2js → linear-time match | **BLOCKED** (re2js) |
| 12 | Path traversal | `cat ../../etc/shadow` → normalize → `isPathWithinRoot()` → ENOENT | **BLOCKED** (primary FS) |
| 13 | Null byte injection | `cat "file\x00../../etc/passwd"` → `validatePath()` → rejected | **BLOCKED** (path validation) |
| 14 | Error path leak | FS error with real path → `sanitizeError()` → path stripped | **BLOCKED** (error sanitization) |
| 15 | Constructor chain | `({}).constructor.constructor('code')()` → constructor patched → throw | **BLOCKED** (defense-in-depth) |
| 16 | Source depth bomb | Self-sourcing `source /s.sh` → maxSourceDepth (100) → throw | **BLOCKED** (limits) |
| 17 | FD exhaustion | `exec N>/dev/null` loop → checkFdLimit → maxFileDescriptors (1024) → throw | **BLOCKED** (limits) |
| 18 | Glob `**` depth | `**/**/**/**/**/**/x` → MAX_GLOBSTAR_SEGMENTS (5) → throw | **BLOCKED** (limits) |
| 20 | performance.now() timing | Sub-ms timing attack → blocked by defense-in-depth | **BLOCKED** (secondary) |
| 21 | Prototype pollution via `__defineGetter__` | Inject getter on prototype → blocked by defense-in-depth | **BLOCKED** (secondary) |
| 22 | File-based import() | `import('/tmp/evil.js')` → Module._resolveFilename blocked → throw | **BLOCKED** (secondary) |
| 23 | data: URL import() | `import('data:text/javascript,...')` → ESM loader hooks → throw | **BLOCKED** (Node.js 20.6+) |

---

## 7. Recommendations for Future Hardening

1. ~~**`--experimental-loader` for import() blocking**~~ — **IMPLEMENTED**: ESM loader hooks via `module.register()` (Node.js 20.6+) / `module.registerHooks()` (Node.js 23.5+) block `data:` and `blob:` URL imports process-wide. Combined with `Module._resolveFilename` blocking for file specifiers, `import()` is fully mitigated on Node.js 20.6+. No CLI flags required.
2. ~~**Systematic error message audit**~~ — **IMPLEMENTED**: `sanitizeErrorMessage()` applied at all error choke points; strips OS paths, `node:internal/` paths, and stack traces
3. **Content Security Policy for output** — Consider sanitizing output to prevent XSS when sandbox output is rendered in web contexts
4. **Expand fuzzing corpus** — Add grammar rules for trap, job control (`&`, `fg`, `bg`), and deeply nested heredocs with expansion
5. **Total memory ceiling** — Track total memory allocated per `exec()` call to provide a hard memory ceiling (not just per-object limits)
6. ~~**process.connected / process.send / process.channel**~~ — **IMPLEMENTED**: Blocked via defense-in-depth (proxy for send/channel, defineProperty for connected)
7. ~~**process.chdir**~~ — **IMPLEMENTED**: Blocked via defense-in-depth proxy
8. ~~**import() expression blocking**~~ — **IMPLEMENTED**: `Module._resolveFilename` blocked by defense-in-depth proxy (data: URLs still bypass)
9. ~~**source/. depth limit**~~ — **IMPLEMENTED**: maxSourceDepth (100) enforced in `handleSource()`
10. ~~**process.stdout/stderr blocking**~~ — **IMPLEMENTED**: Blocked via defense-in-depth in worker contexts; skipped in main thread (console.log dependency)
11. ~~**performance.now() blocking**~~ — **IMPLEMENTED**: Blocked via defense-in-depth; internal uses pre-captured `_performanceNow`
12. ~~**Stack trace sanitization**~~ — **IMPLEMENTED**: `sanitizeErrorMessage()` applied to SecurityViolationError and ExecutionLimitError in `Bash.exec()`; `node:internal/` paths stripped
13. ~~**FD exhaustion enforcement**~~ — **IMPLEMENTED**: `checkFdLimit()` before every `fileDescriptors.set()` across interpreter, redirections, subshell-group
14. ~~**Glob pattern depth limit**~~ — **IMPLEMENTED**: MAX_GLOBSTAR_SEGMENTS (5) rejects patterns with excessive `**` segments
15. ~~**Intl/TextDecoder/TextEncoder audit**~~ — **ACCEPTED RISK**: Used by 40+ internal files; no escape vectors; documented in blocked-globals.ts
16. ~~**Frozen builtins**~~ — **IMPLEMENTED**: `__defineGetter__`/`__defineSetter__`/`__lookupGetter__`/`__lookupSetter__` blocked; JSON and Math frozen
