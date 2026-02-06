/**
 * Blocked Globals for Defense-in-Depth Box
 *
 * This module defines which JavaScript globals should be blocked during
 * bash script execution to prevent code execution escape vectors.
 *
 * IMPORTANT: This is a SECONDARY defense layer. The primary security comes
 * from proper sandboxing and architectural constraints.
 *
 * NOTE: Dynamic import() CANNOT be blocked by this approach. See the
 * "KNOWN LIMITATION" section in defense-in-depth-box.ts for details
 * and recommended mitigations.
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
    // Note: process.mainModule is handled specially in defense-in-depth-box.ts
    // and worker-defense-in-depth.ts because it may be undefined in ESM contexts
    // but we still want to block both reading and setting it.

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
  ];

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
