/**
 * Blocked Globals for Defense-in-Depth Box
 *
 * This module defines which JavaScript globals should be blocked during
 * bash script execution to prevent code execution escape vectors.
 *
 * IMPORTANT: This is a SECONDARY defense layer. The primary security comes
 * from proper sandboxing and architectural constraints.
 *
 * NOTE: Dynamic import() is handled separately in defense-in-depth-box.ts via
 * ESM loader hooks. This module only defines global/property patching.
 */

import type { SecurityViolationType } from "./types.js";

/**
 * Strategy for handling a blocked global.
 * - "throw": Replace with a proxy that throws on access/call
 * - "freeze": Freeze the object to prevent modification
 */
export type BlockStrategy = "throw" | "freeze";

/**
 * Configuration for a blocked global.
 */
export interface BlockedGlobal {
  /**
   * The property name on the target object (e.g., "Function", "eval").
   */
  prop: string;

  /**
   * The target object containing the property.
   * Usually globalThis, but can be other objects like Object.prototype.
   */
  target: object;

  /**
   * Type of violation to record when this global is accessed.
   */
  violationType: SecurityViolationType;

  /**
   * Strategy for blocking this global.
   */
  strategy: BlockStrategy;

  /**
   * Human-readable description of why this is blocked.
   */
  reason: string;

  /**
   * For object proxies (strategy: "throw" on objects): allow reads of these
   * specific property names even inside the sandbox context. Node.js internals
   * read certain properties (e.g., process.env keys) during module loading
   * within the AsyncLocalStorage context, so they must be allowed through.
   */
  allowedKeys?: Set<string>;
}

/**
 * Get the list of globals to block during script execution.
 *
 * Note: This function must be called at runtime (not module load time)
 * because some globals may not exist in all environments.
 */
// @banned-pattern-ignore: intentional reference to Function/eval for security blocking
export function getBlockedGlobals(): BlockedGlobal[] {
  const globals: BlockedGlobal[] = [
    // Direct code execution vectors
    {
      prop: "Function",
      target: globalThis,
      violationType: "function_constructor",
      strategy: "throw",
      reason: "Function constructor allows arbitrary code execution",
    },
    {
      prop: "eval",
      target: globalThis,
      violationType: "eval",
      strategy: "throw",
      reason: "eval() allows arbitrary code execution",
    },

    // Timer functions with string argument allow code execution
    {
      prop: "setTimeout",
      target: globalThis,
      violationType: "setTimeout",
      strategy: "throw",
      reason: "setTimeout with string argument allows code execution",
    },
    {
      prop: "setInterval",
      target: globalThis,
      violationType: "setInterval",
      strategy: "throw",
      reason: "setInterval with string argument allows code execution",
    },
    {
      prop: "setImmediate",
      target: globalThis,
      violationType: "setImmediate",
      strategy: "throw",
      reason: "setImmediate could be used to escape sandbox context",
    },

    // Note: We intentionally do NOT block `process` entirely because:
    // 1. Node.js internals (Promise resolution, etc.) use process.nextTick
    // 2. Blocking process entirely breaks normal async operation
    // 3. The primary code execution vectors (Function, eval) are already blocked
    // However, we DO block specific dangerous process properties.
    {
      prop: "env",
      target: process,
      violationType: "process_env",
      strategy: "throw",
      reason: "process.env could leak sensitive environment variables",
      // Node.js internals and bundled dependencies read these env vars
      // during module loading, file watching, and I/O within the
      // AsyncLocalStorage context. None are user secrets.
      allowedKeys: new Set([
        // Node.js core
        "NODE_V8_COVERAGE",
        "NODE_DEBUG",
        "NODE_DEBUG_NATIVE",
        "NODE_COMPILE_CACHE",
        "WATCH_REPORT_DEPENDENCIES",
        // Dependencies
        "FORCE_COLOR", // chalk/supports-color
        "DEBUG", // debug package
        "UNDICI_NO_FG", // undici (Node.js fetch)
        "JEST_WORKER_ID", // jest/vitest worker detection
        "__MINIMATCH_TESTING_PLATFORM__", // minimatch
        "LOG_TOKENS", // query engine debug logging
        "LOG_STREAM", // query engine debug logging
      ]),
    },
    {
      prop: "binding",
      target: process,
      violationType: "process_binding",
      strategy: "throw",
      reason: "process.binding provides access to native Node.js modules",
    },
    {
      prop: "_linkedBinding",
      target: process,
      violationType: "process_binding",
      strategy: "throw",
      reason:
        "process._linkedBinding provides access to native Node.js modules",
    },
    {
      prop: "dlopen",
      target: process,
      violationType: "process_dlopen",
      strategy: "throw",
      reason: "process.dlopen allows loading native addons",
    },
    {
      prop: "getBuiltinModule",
      target: process,
      violationType: "process_get_builtin_module",
      strategy: "throw",
      reason:
        "process.getBuiltinModule allows loading native Node.js modules (fs, child_process, vm)",
    },
    // Note: process.mainModule is handled specially in defense-in-depth-box.ts
    // and worker-defense-in-depth.ts because it may be undefined in ESM contexts
    // but we still want to block both reading and setting it.

    // Process control vectors
    {
      prop: "exit",
      target: process,
      violationType: "process_exit",
      strategy: "throw",
      reason: "process.exit could terminate the interpreter",
    },
    {
      prop: "abort",
      target: process,
      violationType: "process_exit",
      strategy: "throw",
      reason: "process.abort could crash the interpreter",
    },
    {
      prop: "kill",
      target: process,
      violationType: "process_kill",
      strategy: "throw",
      reason: "process.kill could signal other processes",
    },

    // Privilege escalation vectors
    {
      prop: "setuid",
      target: process,
      violationType: "process_setuid",
      strategy: "throw",
      reason: "process.setuid could escalate privileges",
    },
    {
      prop: "setgid",
      target: process,
      violationType: "process_setuid",
      strategy: "throw",
      reason: "process.setgid could escalate privileges",
    },
    {
      prop: "seteuid",
      target: process,
      violationType: "process_setuid",
      strategy: "throw",
      reason: "process.seteuid could escalate effective user privileges",
    },
    {
      prop: "setegid",
      target: process,
      violationType: "process_setuid",
      strategy: "throw",
      reason: "process.setegid could escalate effective group privileges",
    },
    {
      prop: "initgroups",
      target: process,
      violationType: "process_setuid",
      strategy: "throw",
      reason: "process.initgroups could modify supplementary group IDs",
    },
    {
      prop: "setgroups",
      target: process,
      violationType: "process_setuid",
      strategy: "throw",
      reason: "process.setgroups could modify supplementary group IDs",
    },

    // File permission manipulation
    {
      prop: "umask",
      target: process,
      violationType: "process_umask",
      strategy: "throw",
      reason: "process.umask could modify file creation permissions",
    },

    // Information disclosure vectors
    // Note: process.argv is an array (object) so gets an object proxy
    {
      prop: "argv",
      target: process,
      violationType: "process_argv",
      strategy: "throw",
      reason: "process.argv may contain secrets in CLI arguments",
    },
    // Note: process.execPath is a string primitive, handled specially
    // in defense-in-depth-box.ts and worker-defense-in-depth.ts

    // Note: process.connected is a boolean primitive, handled specially
    // in defense-in-depth-box.ts and worker-defense-in-depth.ts

    // Working directory access/manipulation
    {
      prop: "cwd",
      target: process,
      violationType: "process_chdir",
      strategy: "throw",
      reason: "process.cwd could disclose real host working directory path",
    },
    {
      prop: "chdir",
      target: process,
      violationType: "process_chdir",
      strategy: "throw",
      reason: "process.chdir could confuse the interpreter's CWD tracking",
    },

    // Diagnostic report (leaks full environment, host paths, system info)
    {
      prop: "report",
      target: process,
      violationType: "process_report",
      strategy: "throw",
      reason:
        "process.report could disclose full environment, host paths, and system info",
    },

    // Environment file loading (Node 21.7+)
    {
      prop: "loadEnvFile",
      target: process,
      violationType: "process_env",
      strategy: "throw",
      reason: "process.loadEnvFile could load env files bypassing env proxy",
    },

    // Exception handler manipulation
    {
      prop: "setUncaughtExceptionCaptureCallback",
      target: process,
      violationType: "process_exception_handler",
      strategy: "throw",
      reason:
        "setUncaughtExceptionCaptureCallback could intercept security errors",
    },

    // IPC communication vectors (may be undefined in non-IPC contexts)
    {
      prop: "send",
      target: process,
      violationType: "process_send",
      strategy: "throw",
      reason:
        "process.send could communicate with parent process in IPC contexts",
    },
    {
      prop: "channel",
      target: process,
      violationType: "process_channel",
      strategy: "throw",
      reason: "process.channel could access IPC channel to parent process",
    },

    // Timing side-channel vectors
    {
      prop: "cpuUsage",
      target: process,
      violationType: "process_timing",
      strategy: "throw",
      reason: "process.cpuUsage could enable timing side-channel attacks",
    },
    {
      prop: "memoryUsage",
      target: process,
      violationType: "process_timing",
      strategy: "throw",
      reason: "process.memoryUsage could enable timing side-channel attacks",
    },
    {
      prop: "hrtime",
      target: process,
      violationType: "process_timing",
      strategy: "throw",
      reason: "process.hrtime could enable timing side-channel attacks",
    },

    // We also don't block `require` because:
    // 1. It may not exist in all environments (ESM)
    // 2. import() is the modern escape vector and can't be blocked this way

    // Reference leak vectors
    {
      prop: "WeakRef",
      target: globalThis,
      violationType: "weak_ref",
      strategy: "throw",
      reason: "WeakRef could be used to leak references outside sandbox",
    },
    {
      prop: "FinalizationRegistry",
      target: globalThis,
      violationType: "finalization_registry",
      strategy: "throw",
      reason:
        "FinalizationRegistry could be used to leak references outside sandbox",
    },

    // Introspection/interception vectors (freeze instead of throw)
    // SECURITY RATIONALE: Reflect is frozen (not blocked) because:
    // 1. Defense infrastructure uses Reflect.apply/get/set/construct internally
    // 2. Frozen Reflect cannot be mutated but remains fully functional
    // 3. Reflect.construct(Function, ['code']) IS safe because globalThis.Function
    //    is replaced with a blocking proxy — Reflect.construct receives the proxy
    // 4. Security depends on NEVER leaking original Function/eval references.
    //    If an unpatched Function ref leaked, Reflect.construct would bypass defense.
    {
      prop: "Reflect",
      target: globalThis,
      violationType: "reflect",
      strategy: "freeze",
      reason: "Reflect provides introspection capabilities",
    },
    {
      prop: "Proxy",
      target: globalThis,
      violationType: "proxy",
      strategy: "throw",
      reason: "Proxy allows intercepting and modifying object behavior",
    },

    // WebAssembly allows arbitrary code execution
    {
      prop: "WebAssembly",
      target: globalThis,
      violationType: "webassembly",
      strategy: "throw",
      reason: "WebAssembly allows executing arbitrary compiled code",
    },

    // SharedArrayBuffer and Atomics can enable side-channel attacks
    {
      prop: "SharedArrayBuffer",
      target: globalThis,
      violationType: "shared_array_buffer",
      strategy: "throw",
      reason:
        "SharedArrayBuffer could enable side-channel communication or timing attacks",
    },
    {
      prop: "Atomics",
      target: globalThis,
      violationType: "atomics",
      strategy: "throw",
      reason:
        "Atomics could enable side-channel communication or timing attacks",
    },

    // Note: Error.prepareStackTrace is handled specially in defense-in-depth-box.ts
    // because we only want to block SETTING it, not reading (V8 reads it internally)

    // Timing side-channel: performance.now() provides sub-millisecond resolution
    // Note: Date.now() is intentionally NOT blocked — it's used for $SECONDS,
    // date command, and has only ~1ms resolution (vs process.hrtime at ns).
    {
      prop: "performance",
      target: globalThis,
      violationType: "performance_timing",
      strategy: "throw",
      reason:
        "performance.now() provides sub-millisecond timing for side-channel attacks",
    },

    // Block direct access to process.stdout and process.stderr to prevent
    // writing to the host's actual stdout/stderr, bypassing the interpreter's
    // output accumulation.
    {
      prop: "stdout",
      target: process,
      violationType: "process_stdout",
      strategy: "throw",
      reason:
        "process.stdout could bypass interpreter output to write to host stdout",
    },
    {
      prop: "stderr",
      target: process,
      violationType: "process_stderr",
      strategy: "throw",
      reason:
        "process.stderr could bypass interpreter output to write to host stderr",
    },

    // Prototype pollution vectors
    {
      prop: "__defineGetter__",
      target: Object.prototype,
      violationType: "prototype_mutation",
      strategy: "throw",
      reason:
        "__defineGetter__ allows prototype pollution via getter injection",
    },
    {
      prop: "__defineSetter__",
      target: Object.prototype,
      violationType: "prototype_mutation",
      strategy: "throw",
      reason:
        "__defineSetter__ allows prototype pollution via setter injection",
    },
    {
      prop: "__lookupGetter__",
      target: Object.prototype,
      violationType: "prototype_mutation",
      strategy: "throw",
      reason:
        "__lookupGetter__ enables introspection for prototype pollution attacks",
    },
    {
      prop: "__lookupSetter__",
      target: Object.prototype,
      violationType: "prototype_mutation",
      strategy: "throw",
      reason:
        "__lookupSetter__ enables introspection for prototype pollution attacks",
    },

    // Freeze JSON and Math to prevent mutation of built-in utility objects
    {
      prop: "JSON",
      target: globalThis,
      violationType: "json_mutation",
      strategy: "freeze",
      reason: "Freeze JSON to prevent mutation of parsing/serialization",
    },
    {
      prop: "Math",
      target: globalThis,
      violationType: "math_mutation",
      strategy: "freeze",
      reason: "Freeze Math to prevent mutation of math utilities",
    },
  ];

  // Audit conclusion for Intl, TextDecoder, TextEncoder:
  // TextEncoder/TextDecoder are used by 40+ files in the interpreter for
  // binary string handling. Intl is used by printf %()T for date formatting.
  // Neither provides code execution escape vectors. ACCEPTED RISK - no blocking.

  // Add async/generator function constructors if they exist
  // These are accessed via: (async function(){}).constructor
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    if (AsyncFunction && AsyncFunction !== Function) {
      globals.push({
        prop: "constructor",
        target: Object.getPrototypeOf(async () => {}),
        violationType: "async_function_constructor",
        strategy: "throw",
        reason:
          "AsyncFunction constructor allows arbitrary async code execution",
      });
    }
  } catch {
    // AsyncFunction not available in this environment
  }

  try {
    const GeneratorFunction = Object.getPrototypeOf(
      function* () {},
    ).constructor;
    if (GeneratorFunction && GeneratorFunction !== Function) {
      globals.push({
        prop: "constructor",
        target: Object.getPrototypeOf(function* () {}),
        violationType: "generator_function_constructor",
        strategy: "throw",
        reason:
          "GeneratorFunction constructor allows arbitrary generator code execution",
      });
    }
  } catch {
    // GeneratorFunction not available in this environment
  }

  try {
    const AsyncGeneratorFunction = Object.getPrototypeOf(
      async function* () {},
    ).constructor;
    if (
      AsyncGeneratorFunction &&
      AsyncGeneratorFunction !== Function &&
      AsyncGeneratorFunction !==
        Object.getPrototypeOf(async () => {}).constructor
    ) {
      globals.push({
        prop: "constructor",
        target: Object.getPrototypeOf(async function* () {}),
        violationType: "async_generator_function_constructor",
        strategy: "throw",
        reason:
          "AsyncGeneratorFunction constructor allows arbitrary async generator code execution",
      });
    }
  } catch {
    // AsyncGeneratorFunction not available in this environment
  }

  // Filter out globals that don't exist in the current environment
  return globals.filter((g) => {
    try {
      return (g.target as Record<string, unknown>)[g.prop] !== undefined;
    } catch {
      return false;
    }
  });
}

// Note: We don't protect Object.prototype.constructor because:
// 1. It's too aggressive and breaks normal JavaScript (e.g., new Error())
// 2. Accessing .constructor.constructor just returns our blocked Function proxy
// The protection of globalThis.Function is sufficient for the constructor escape vector.
