/**
 * Defense-in-Depth Box
 *
 * A security layer that monkey-patches dangerous JavaScript globals during
 * bash script execution. Uses AsyncLocalStorage to track execution context,
 * so blocks only apply to code running within bash.exec() - not to concurrent
 * operations in the same process.
 *
 * IMPORTANT: This is a SECONDARY defense layer. It should never be relied upon
 * as the primary security mechanism. The primary security comes from proper
 * sandboxing, input validation, and architectural constraints.
 *
 * Key design decisions:
 * - AsyncLocalStorage for context tracking (blocks only affect sandboxed code)
 * - Reference counting for nested exec() calls
 * - Patches are process-wide but checks are context-aware
 * - Violations are recorded even in audit mode
 *
 * KNOWN LIMITATION - Dynamic import() cannot be blocked:
 * Dynamic `import()` is a language-level feature that cannot be intercepted
 * by property proxies or monkey-patching. An attacker with write access to
 * the filesystem could create a malicious JS module and import it:
 *   import('data:text/javascript,console.log("escaped")')
 *   import('/tmp/malicious.js')
 *
 * Mitigations for import() must be applied at other layers:
 * - Filesystem restrictions (prevent writing .js/.mjs files)
 * - Node.js module resolution hooks (--experimental-loader)
 * - Worker isolation (separate V8 contexts)
 */

import { type BlockedGlobal, getBlockedGlobals } from "./blocked-globals.js";
import type {
  DefenseInDepthConfig,
  DefenseInDepthHandle,
  DefenseInDepthStats,
  SecurityViolation,
  SecurityViolationType,
} from "./types.js";

/**
 * Whether we're running in a browser environment.
 * This is defined by the bundler via --define:__BROWSER__=true
 * In Node.js builds, this will be false (or undefined, which is falsy).
 */
declare const __BROWSER__: boolean | undefined;
const IS_BROWSER = typeof __BROWSER__ !== "undefined" && __BROWSER__;

/**
 * Generate a random UUID. Works in both Node.js and browsers.
 */
function generateUUID(): string {
  // Use Web Crypto API (available in both Node.js 19+ and browsers)
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for older Node.js versions
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Dynamically import AsyncLocalStorage only in Node.js environments.
 * This avoids bundler errors in browser builds.
 */
type AsyncLocalStorageType<T> = {
  run<R>(store: T, callback: () => R): R;
  getStore(): T | undefined;
};

let AsyncLocalStorageClass: (new <T>() => AsyncLocalStorageType<T>) | null =
  null;

// Only load AsyncLocalStorage in Node.js (not in browser builds)
if (!IS_BROWSER) {
  try {
    // Use createRequire for ESM compatibility (require is not defined in ESM)
    // This approach works in both CJS and ESM Node.js environments
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const asyncHooks = require("node:async_hooks");
    AsyncLocalStorageClass = asyncHooks.AsyncLocalStorage;
  } catch (e) {
    // AsyncLocalStorage not available (e.g., in some edge runtimes)
    console.debug(
      "[DefenseInDepthBox] AsyncLocalStorage not available, defense-in-depth disabled:",
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * Suffix added to all security violation messages.
 */
const DEFENSE_IN_DEPTH_NOTICE =
  "\n\nThis is a defense-in-depth measure and indicates a bug in just-bash. " +
  "Please report this at security@vercel.com";

/**
 * Error thrown when a security violation is detected and blocking is enabled.
 */
export class SecurityViolationError extends Error {
  constructor(
    message: string,
    public readonly violation: SecurityViolation,
  ) {
    super(message + DEFENSE_IN_DEPTH_NOTICE);
    this.name = "SecurityViolationError";
  }
}

/**
 * Context stored in AsyncLocalStorage to track sandboxed execution.
 */
interface DefenseContext {
  /** Flag indicating this context is within sandboxed execution */
  sandboxActive: true;
  /** Unique ID for this execution, useful for correlating violations */
  executionId: string;
}

// AsyncLocalStorage instance to track whether current async context is within bash.exec()
// Only created in Node.js environments (not in browser builds)
const executionContext: AsyncLocalStorageType<DefenseContext> | null =
  !IS_BROWSER && AsyncLocalStorageClass
    ? new AsyncLocalStorageClass<DefenseContext>()
    : null;

// Maximum number of violations to store (prevent memory issues)
const MAX_STORED_VIOLATIONS = 1000;

/**
 * Default configuration for the defense-in-depth box.
 */
const DEFAULT_CONFIG: DefenseInDepthConfig = {
  enabled: true,
  auditMode: false,
};

/**
 * Resolve user config with defaults.
 */
function resolveConfig(
  config?: DefenseInDepthConfig | boolean,
): DefenseInDepthConfig {
  if (config === undefined) {
    return { ...DEFAULT_CONFIG, enabled: false };
  }
  if (typeof config === "boolean") {
    return { ...DEFAULT_CONFIG, enabled: config };
  }
  return {
    ...DEFAULT_CONFIG,
    ...config,
  };
}

/**
 * Defense-in-Depth Box
 *
 * Singleton class that manages security patches during bash execution.
 * Use getInstance() to get or create the instance.
 */
export class DefenseInDepthBox {
  private static instance: DefenseInDepthBox | null = null;

  private config: DefenseInDepthConfig;
  private refCount = 0;
  private originalDescriptors: Array<{
    target: object;
    prop: string;
    descriptor: PropertyDescriptor | undefined;
  }> = [];
  private violations: SecurityViolation[] = [];
  private activationTime = 0;
  private totalActiveTimeMs = 0;

  private constructor(config: DefenseInDepthConfig) {
    this.config = config;
  }

  /**
   * Get or create the singleton instance.
   *
   * @param config - Configuration for the defense box. Only used on first call.
   */
  static getInstance(
    config?: DefenseInDepthConfig | boolean,
  ): DefenseInDepthBox {
    if (!DefenseInDepthBox.instance) {
      DefenseInDepthBox.instance = new DefenseInDepthBox(resolveConfig(config));
    }
    return DefenseInDepthBox.instance;
  }

  /**
   * Reset the singleton instance. Only use in tests.
   */
  static resetInstance(): void {
    if (DefenseInDepthBox.instance) {
      DefenseInDepthBox.instance.forceDeactivate();
      DefenseInDepthBox.instance = null;
    }
  }

  /**
   * Check if the current async context is within sandboxed execution.
   */
  static isInSandboxedContext(): boolean {
    if (!executionContext) return false;
    return executionContext?.getStore()?.sandboxActive === true;
  }

  /**
   * Get the current execution ID if in a sandboxed context.
   */
  static getCurrentExecutionId(): string | undefined {
    if (!executionContext) return undefined;
    return executionContext?.getStore()?.executionId;
  }

  /**
   * Update configuration. Only affects future activations.
   */
  updateConfig(config: Partial<DefenseInDepthConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Activate the defense box. Returns a handle for scoped execution.
   *
   * Usage:
   * ```
   * const { run, deactivate } = box.activate();
   * try {
   *   await run(async () => {
   *     // Code here is protected
   *   });
   * } finally {
   *   deactivate();
   * }
   * ```
   */
  activate(): DefenseInDepthHandle {
    // In browser environments, defense-in-depth is disabled (no AsyncLocalStorage)
    // Also disabled when config.enabled is false
    if (IS_BROWSER || !this.config.enabled) {
      // Return a no-op handle
      const executionId = generateUUID();
      return {
        run: <T>(fn: () => Promise<T>): Promise<T> => fn(),
        deactivate: () => {},
        executionId,
      };
    }

    this.refCount++;
    if (this.refCount === 1) {
      this.applyPatches();
      this.activationTime = Date.now();
    }

    const executionId = generateUUID();

    return {
      run: <T>(fn: () => Promise<T>): Promise<T> => {
        // executionContext is guaranteed to be non-null here (checked IS_BROWSER above)
        // biome-ignore lint/style/noNonNullAssertion: guarded by IS_BROWSER check
        return executionContext!.run({ sandboxActive: true, executionId }, fn);
      },
      deactivate: () => {
        this.refCount--;
        if (this.refCount === 0) {
          this.restorePatches();
          this.totalActiveTimeMs += Date.now() - this.activationTime;
        }
        // Prevent negative ref count from unbalanced calls
        if (this.refCount < 0) {
          this.refCount = 0;
        }
      },
      executionId,
    };
  }

  /**
   * Force deactivation, restoring all patches regardless of ref count.
   * Use for error recovery only.
   */
  forceDeactivate(): void {
    if (this.refCount > 0) {
      this.restorePatches();
      this.totalActiveTimeMs += Date.now() - this.activationTime;
    }
    this.refCount = 0;
  }

  /**
   * Check if patches are currently applied.
   */
  isActive(): boolean {
    return this.refCount > 0;
  }

  /**
   * Get statistics about the defense box.
   */
  getStats(): DefenseInDepthStats {
    return {
      violationsBlocked: this.violations.length,
      violations: [...this.violations],
      activeTimeMs:
        this.totalActiveTimeMs +
        (this.refCount > 0 ? Date.now() - this.activationTime : 0),
      refCount: this.refCount,
    };
  }

  /**
   * Clear stored violations. Useful for testing.
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Get a human-readable path for a target object and property.
   */
  private getPathForTarget(target: object, prop: string): string {
    if (target === globalThis) {
      return `globalThis.${prop}`;
    }
    if (target === process) {
      return `process.${prop}`;
    }
    if (target === Error) {
      return `Error.${prop}`;
    }
    // For prototype targets, try to identify them
    if (target === Function.prototype) {
      return `Function.prototype.${prop}`;
    }
    if (target === Object.prototype) {
      return `Object.prototype.${prop}`;
    }
    // Fallback
    return `<object>.${prop}`;
  }

  /**
   * Check if current context should be blocked.
   * Returns false in audit mode, browser environment, or outside sandboxed context.
   */
  private shouldBlock(): boolean {
    if (IS_BROWSER || this.config.auditMode || !executionContext) {
      return false;
    }
    return executionContext?.getStore()?.sandboxActive === true;
  }

  /**
   * Record a violation and optionally invoke the callback.
   */
  private recordViolation(
    type: SecurityViolationType,
    path: string,
    message: string,
  ): SecurityViolation {
    const violation: SecurityViolation = {
      timestamp: Date.now(),
      type,
      message,
      path,
      stack: new Error().stack,
      executionId: executionContext?.getStore()?.executionId,
    };

    // Store violation (with cap to prevent memory issues)
    if (this.violations.length < MAX_STORED_VIOLATIONS) {
      this.violations.push(violation);
    }

    // Invoke callback if configured
    if (this.config.onViolation) {
      try {
        this.config.onViolation(violation);
      } catch (e) {
        // Ignore callback errors but log for debugging
        console.debug(
          "[DefenseInDepthBox] onViolation callback threw:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    return violation;
  }

  /**
   * Create a blocking proxy for a function.
   */
  // @banned-pattern-ignore: intentional use of Function type for security proxy
  private createBlockingProxy<T extends (...args: unknown[]) => unknown>(
    original: T,
    path: string,
    violationType: SecurityViolationType,
  ): T {
    const box = this;

    // @banned-pattern-ignore: intentional Proxy usage for security blocking
    return new Proxy(original, {
      apply(target, thisArg, args) {
        if (box.shouldBlock()) {
          const message = `${path} is blocked during script execution`;
          const violation = box.recordViolation(violationType, path, message);
          throw new SecurityViolationError(message, violation);
        }
        // Record violation in audit mode but allow the call
        if (
          box.config.auditMode &&
          executionContext?.getStore()?.sandboxActive === true
        ) {
          box.recordViolation(
            violationType,
            path,
            `${path} called (audit mode)`,
          );
        }
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args, newTarget) {
        if (box.shouldBlock()) {
          const message = `${path} constructor is blocked during script execution`;
          const violation = box.recordViolation(violationType, path, message);
          throw new SecurityViolationError(message, violation);
        }
        // Record violation in audit mode but allow the call
        if (
          box.config.auditMode &&
          executionContext?.getStore()?.sandboxActive === true
        ) {
          box.recordViolation(
            violationType,
            path,
            `${path} constructor called (audit mode)`,
          );
        }
        return Reflect.construct(target, args, newTarget);
      },
    }) as T;
  }

  /**
   * Create a blocking proxy for an object (blocks all property access).
   */
  private createBlockingObjectProxy<T extends object>(
    original: T,
    path: string,
    violationType: SecurityViolationType,
  ): T {
    const box = this;

    // @banned-pattern-ignore: intentional Proxy usage for security blocking
    return new Proxy(original, {
      get(target, prop, receiver) {
        if (box.shouldBlock()) {
          const fullPath = `${path}.${String(prop)}`;
          const message = `${fullPath} is blocked during script execution`;
          const violation = box.recordViolation(
            violationType,
            fullPath,
            message,
          );
          throw new SecurityViolationError(message, violation);
        }
        // Record violation in audit mode but allow access
        if (
          box.config.auditMode &&
          executionContext?.getStore()?.sandboxActive === true
        ) {
          const fullPath = `${path}.${String(prop)}`;
          box.recordViolation(
            violationType,
            fullPath,
            `${fullPath} accessed (audit mode)`,
          );
        }
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        if (box.shouldBlock()) {
          const fullPath = `${path}.${String(prop)}`;
          const message = `${fullPath} modification is blocked during script execution`;
          const violation = box.recordViolation(
            violationType,
            fullPath,
            message,
          );
          throw new SecurityViolationError(message, violation);
        }
        return Reflect.set(target, prop, value, receiver);
      },
      // Block enumeration (Object.keys, Object.entries, for...in, etc.)
      ownKeys(target) {
        if (box.shouldBlock()) {
          const message = `${path} enumeration is blocked during script execution`;
          const violation = box.recordViolation(violationType, path, message);
          throw new SecurityViolationError(message, violation);
        }
        return Reflect.ownKeys(target);
      },
      // Block Object.getOwnPropertyDescriptor
      getOwnPropertyDescriptor(target, prop) {
        if (box.shouldBlock()) {
          const fullPath = `${path}.${String(prop)}`;
          const message = `${fullPath} descriptor access is blocked during script execution`;
          const violation = box.recordViolation(
            violationType,
            fullPath,
            message,
          );
          throw new SecurityViolationError(message, violation);
        }
        return Reflect.getOwnPropertyDescriptor(target, prop);
      },
      // Block 'in' operator
      has(target, prop) {
        if (box.shouldBlock()) {
          const fullPath = `${path}.${String(prop)}`;
          const message = `${fullPath} existence check is blocked during script execution`;
          const violation = box.recordViolation(
            violationType,
            fullPath,
            message,
          );
          throw new SecurityViolationError(message, violation);
        }
        return Reflect.has(target, prop);
      },
    }) as T;
  }

  /**
   * Apply security patches to dangerous globals.
   */
  private applyPatches(): void {
    const blockedGlobals = getBlockedGlobals();

    for (const blocked of blockedGlobals) {
      this.applyPatch(blocked);
    }

    // Protect against .constructor.constructor escape vector
    // by patching Function.prototype.constructor (and similar)
    this.protectConstructorChain();

    // Protect Error.prepareStackTrace (only block setting, not reading)
    this.protectErrorPrepareStackTrace();

    // Protect Module._load BEFORE process.mainModule, since protectModuleLoad()
    // needs to read process.mainModule to find the Module class.
    this.protectModuleLoad();

    // Protect process.mainModule (may be undefined in ESM but still blockable)
    this.protectProcessMainModule();
  }

  /**
   * Protect against .constructor.constructor escape vector.
   *
   * The pattern `{}.constructor.constructor` accesses Function via:
   * - {}.constructor → Object (via Object.prototype.constructor)
   * - Object.constructor → Function (via Function.prototype.constructor)
   *
   * By patching Function.prototype.constructor to return our blocked proxy,
   * we block the escape vector without breaking normal .constructor access.
   */
  private protectConstructorChain(): void {
    // Patch Function.prototype.constructor
    this.patchPrototypeConstructor(
      Function.prototype,
      "Function.prototype.constructor",
      "function_constructor",
    );

    // Patch AsyncFunction.prototype.constructor if it exists
    try {
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      if (AsyncFunction && AsyncFunction !== Function) {
        this.patchPrototypeConstructor(
          AsyncFunction.prototype,
          "AsyncFunction.prototype.constructor",
          "async_function_constructor",
        );
      }
    } catch (e) {
      console.debug(
        "[DefenseInDepthBox] Could not patch AsyncFunction.prototype.constructor:",
        e instanceof Error ? e.message : e,
      );
    }

    // Patch GeneratorFunction.prototype.constructor if it exists
    try {
      const GeneratorFunction = Object.getPrototypeOf(
        function* () {},
      ).constructor;
      if (GeneratorFunction && GeneratorFunction !== Function) {
        this.patchPrototypeConstructor(
          GeneratorFunction.prototype,
          "GeneratorFunction.prototype.constructor",
          "generator_function_constructor",
        );
      }
    } catch (e) {
      console.debug(
        "[DefenseInDepthBox] Could not patch GeneratorFunction.prototype.constructor:",
        e instanceof Error ? e.message : e,
      );
    }

    // Patch AsyncGeneratorFunction.prototype.constructor if it exists
    try {
      const AsyncGeneratorFunction = Object.getPrototypeOf(
        async function* () {},
      ).constructor;
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      if (
        AsyncGeneratorFunction &&
        AsyncGeneratorFunction !== Function &&
        AsyncGeneratorFunction !== AsyncFunction
      ) {
        this.patchPrototypeConstructor(
          AsyncGeneratorFunction.prototype,
          "AsyncGeneratorFunction.prototype.constructor",
          "async_generator_function_constructor",
        );
      }
    } catch (e) {
      console.debug(
        "[DefenseInDepthBox] Could not patch AsyncGeneratorFunction.prototype.constructor:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Protect Error.prepareStackTrace from being set in sandbox context.
   *
   * The attack vector is:
   * ```
   * Error.prepareStackTrace = (err, stack) => {
   *   return stack[0].getFunction().constructor; // Gets Function
   * };
   * const F = new Error().stack;
   * F("return process")();
   * ```
   *
   * We only block SETTING, not reading, because V8 reads it internally
   * when creating error stack traces.
   */
  private protectErrorPrepareStackTrace(): void {
    const box = this;

    try {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        Error,
        "prepareStackTrace",
      );
      this.originalDescriptors.push({
        target: Error,
        prop: "prepareStackTrace",
        descriptor: originalDescriptor,
      });

      let currentValue = originalDescriptor?.value;

      Object.defineProperty(Error, "prepareStackTrace", {
        get() {
          // Always allow reading (V8 needs this internally)
          return currentValue;
        },
        set(value) {
          if (box.shouldBlock()) {
            const message =
              "Error.prepareStackTrace modification is blocked during script execution";
            const violation = box.recordViolation(
              "error_prepare_stack_trace",
              "Error.prepareStackTrace",
              message,
            );
            throw new SecurityViolationError(message, violation);
          }
          // Record in audit mode
          if (
            box.config.auditMode &&
            executionContext?.getStore()?.sandboxActive === true
          ) {
            box.recordViolation(
              "error_prepare_stack_trace",
              "Error.prepareStackTrace",
              "Error.prepareStackTrace set (audit mode)",
            );
          }
          currentValue = value;
        },
        configurable: true,
      });
    } catch (e) {
      console.debug(
        "[DefenseInDepthBox] Could not protect Error.prepareStackTrace:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Patch a prototype's constructor property to block access in sandbox context.
   */
  private patchPrototypeConstructor(
    prototype: object,
    path: string,
    violationType: SecurityViolationType,
  ): void {
    const box = this;

    try {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        prototype,
        "constructor",
      );
      this.originalDescriptors.push({
        target: prototype,
        prop: "constructor",
        descriptor: originalDescriptor,
      });

      const originalValue = originalDescriptor?.value;

      Object.defineProperty(prototype, "constructor", {
        get() {
          if (box.shouldBlock()) {
            const message = `${path} access is blocked during script execution`;
            const violation = box.recordViolation(violationType, path, message);
            throw new SecurityViolationError(message, violation);
          }
          // Record in audit mode
          if (
            box.config.auditMode &&
            executionContext?.getStore()?.sandboxActive === true
          ) {
            box.recordViolation(
              violationType,
              path,
              `${path} accessed (audit mode)`,
            );
          }
          return originalValue;
        },
        set(value) {
          if (box.shouldBlock()) {
            const message = `${path} modification is blocked during script execution`;
            const violation = box.recordViolation(violationType, path, message);
            throw new SecurityViolationError(message, violation);
          }
          // Allow setting outside sandbox context
          Object.defineProperty(this, "constructor", {
            value,
            writable: true,
            configurable: true,
          });
        },
        configurable: true,
      });
    } catch (e) {
      console.debug(
        `[DefenseInDepthBox] Could not patch ${path}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Protect process.mainModule from being accessed or set in sandbox context.
   *
   * The attack vector is:
   * ```
   * process.mainModule.require('child_process').execSync('whoami')
   * process.mainModule.constructor._load('vm')
   * ```
   *
   * process.mainModule may be undefined in ESM contexts but could exist in
   * CommonJS workers. We block both reading and setting.
   */
  private protectProcessMainModule(): void {
    if (typeof process === "undefined") return;

    const box = this;

    try {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        process,
        "mainModule",
      );
      this.originalDescriptors.push({
        target: process,
        prop: "mainModule",
        descriptor: originalDescriptor,
      });

      const currentValue = originalDescriptor?.value;

      // Only protect if mainModule exists (CJS contexts).
      // In ESM, mainModule is undefined and Node.js internals (createRequire)
      // access this property during module loading - blocking it would break
      // module loading within the sandbox context.
      if (currentValue !== undefined) {
        Object.defineProperty(process, "mainModule", {
          get() {
            if (box.shouldBlock()) {
              const message =
                "process.mainModule access is blocked during script execution";
              const violation = box.recordViolation(
                "process_main_module",
                "process.mainModule",
                message,
              );
              throw new SecurityViolationError(message, violation);
            }
            if (
              box.config.auditMode &&
              executionContext?.getStore()?.sandboxActive === true
            ) {
              box.recordViolation(
                "process_main_module",
                "process.mainModule",
                "process.mainModule accessed (audit mode)",
              );
            }
            return currentValue;
          },
          set(value) {
            if (box.shouldBlock()) {
              const message =
                "process.mainModule modification is blocked during script execution";
              const violation = box.recordViolation(
                "process_main_module",
                "process.mainModule",
                message,
              );
              throw new SecurityViolationError(message, violation);
            }
            // Allow setting outside sandbox context
            Object.defineProperty(process, "mainModule", {
              value,
              writable: true,
              configurable: true,
            });
          },
          configurable: true,
        });
      }
    } catch (e) {
      console.debug(
        "[DefenseInDepthBox] Could not protect process.mainModule:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Protect Module._load from being called in sandbox context.
   *
   * The attack vector is:
   * ```
   * module.constructor._load('child_process')
   * require.main.constructor._load('vm')
   * ```
   *
   * We access the Module class and replace _load with a blocking proxy.
   */
  private protectModuleLoad(): void {
    if (IS_BROWSER) return;

    try {
      // Access the Module class via Function.prototype (which exists before patching starts)
      // Try multiple paths to find Module
      let ModuleClass: Record<string, unknown> | null = null;

      // Path 1: via process.mainModule (CJS contexts)
      if (typeof process !== "undefined") {
        const mainModule = (process as unknown as Record<string, unknown>)
          .mainModule;
        if (mainModule && typeof mainModule === "object") {
          ModuleClass = (mainModule as unknown as Record<string, unknown>)
            .constructor as unknown as Record<string, unknown>;
        }
      }

      // Path 2: via require.main (CJS contexts)
      if (
        !ModuleClass &&
        typeof require !== "undefined" &&
        typeof require.main !== "undefined"
      ) {
        ModuleClass = (require.main as unknown as Record<string, unknown>)
          .constructor as unknown as Record<string, unknown>;
      }

      if (!ModuleClass || typeof ModuleClass._load !== "function") {
        return;
      }

      const original = ModuleClass._load as (...args: unknown[]) => unknown;
      const descriptor = Object.getOwnPropertyDescriptor(ModuleClass, "_load");
      this.originalDescriptors.push({
        target: ModuleClass,
        prop: "_load",
        descriptor,
      });

      const path = "Module._load";
      const proxy = this.createBlockingProxy(original, path, "module_load");

      Object.defineProperty(ModuleClass, "_load", {
        value: proxy,
        writable: true,
        configurable: true,
      });
    } catch (e) {
      console.debug(
        "[DefenseInDepthBox] Could not protect Module._load:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Apply a single patch to a blocked global.
   */
  private applyPatch(blocked: BlockedGlobal): void {
    const { target, prop, violationType, strategy } = blocked;

    try {
      const original = (target as Record<string, unknown>)[prop];
      if (original === undefined) {
        return;
      }

      // Store original descriptor for restoration
      const descriptor = Object.getOwnPropertyDescriptor(target, prop);
      this.originalDescriptors.push({ target, prop, descriptor });

      if (strategy === "freeze") {
        // For freeze strategy, freeze the object and replace with frozen version
        if (typeof original === "object" && original !== null) {
          Object.freeze(original);
        }
      } else {
        // For throw strategy, create a blocking proxy
        // Construct path based on target
        const path = this.getPathForTarget(target, prop);
        // @banned-pattern-ignore: intentional check for function type in security code
        const proxy =
          typeof original === "function"
            ? this.createBlockingProxy(
                original as (...args: unknown[]) => unknown,
                path,
                violationType,
              )
            : this.createBlockingObjectProxy(
                original as object,
                path,
                violationType,
              );

        Object.defineProperty(target, prop, {
          value: proxy,
          writable: true, // Keep writable so external code (vitest, etc.) can reassign if needed
          configurable: true, // Must be configurable for restoration
        });
      }
    } catch (e) {
      const path = this.getPathForTarget(target, prop);
      console.debug(
        `[DefenseInDepthBox] Could not patch ${path}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Restore all original values.
   */
  private restorePatches(): void {
    // Restore in reverse order to handle dependencies
    for (let i = this.originalDescriptors.length - 1; i >= 0; i--) {
      const { target, prop, descriptor } = this.originalDescriptors[i];

      try {
        if (descriptor) {
          Object.defineProperty(target, prop, descriptor);
        } else {
          // Property didn't exist originally, delete it
          delete (target as Record<string, unknown>)[prop];
        }
      } catch (e) {
        const path = this.getPathForTarget(target, prop);
        console.debug(
          `[DefenseInDepthBox] Could not restore ${path}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }

    this.originalDescriptors = [];
  }
}
