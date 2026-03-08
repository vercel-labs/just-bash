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
 * Dynamic import() mitigation (three layers):
 * 1. Module._resolveFilename blocked — catches file-based specifiers
 * 2. ESM loader hooks (module.register/registerHooks) — blocks data:/blob: URLs
 * 3. Filesystem restrictions — OverlayFs writes to memory only
 *
 * Residual gap: On Node.js < 20.6 where module.register() is unavailable,
 * data: URL imports remain unblockable. For those deployments, use
 * --experimental-loader CLI hooks as an additional layer.
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

type AsyncLocalStorageType<T> = {
  run<R>(store: T, callback: () => R): R;
  getStore(): T | undefined;
};

let AsyncLocalStorageClass: (new <T>() => AsyncLocalStorageType<T>) | null =
  null;

// Only load AsyncLocalStorage in Node.js (not in browser builds).
// Uses require() instead of a static import so that esbuild can
// dead-code-eliminate this block in browser builds (static imports
// cannot be tree-shaken even when unused).
if (!IS_BROWSER) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AsyncLocalStorage } = require("node:async_hooks");
    AsyncLocalStorageClass = AsyncLocalStorage as
      | (new <T>() => AsyncLocalStorageType<T>)
      | null;
  } catch {
    // Not available (edge runtimes, restricted environments)
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
  /** When true, blocking is suspended (trusted infrastructure code) */
  trusted?: boolean;
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
  private static importHooksRegistered = false;

  private config: DefenseInDepthConfig;
  private refCount = 0;
  private patchFailures: string[] = [];
  private activeExecutionIds = new Set<string>();
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
   * @param config - Configuration for the defense box.
   * @throws Error if called with a config that conflicts with the existing instance's
   *         security-relevant settings (enabled, auditMode). This prevents a weaker
   *         first caller from silently downgrading protection for later callers.
   */
  static getInstance(
    config?: DefenseInDepthConfig | boolean,
  ): DefenseInDepthBox {
    const resolved = resolveConfig(config);
    if (!DefenseInDepthBox.instance) {
      DefenseInDepthBox.instance = new DefenseInDepthBox(resolved);
    } else {
      // Reject conflicting security-relevant config to prevent silent downgrades.
      // Two configs conflict if they differ on enabled or auditMode.
      const active = DefenseInDepthBox.instance.config;
      if (
        resolved.enabled !== active.enabled ||
        resolved.auditMode !== active.auditMode
      ) {
        throw new Error(
          `DefenseInDepthBox config conflict: requested {enabled: ${resolved.enabled}, auditMode: ${resolved.auditMode}} ` +
            `but singleton already has {enabled: ${active.enabled}, auditMode: ${active.auditMode}}. ` +
            `All Bash instances must use the same defense-in-depth security settings, ` +
            `or call DefenseInDepthBox.resetInstance() between incompatible configurations.`,
        );
      }
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
   * Check if a defense execution ID is still live (its handle is not deactivated).
   */
  private isExecutionIdActive(executionId: string): boolean {
    return this.activeExecutionIds.has(executionId);
  }

  /**
   * Return an active execution ID to bind callback context.
   * When multiple executions are active, this intentionally selects one
   * active ID so callback execution stays fail-closed.
   */
  private getPreferredActiveExecutionId(): string | undefined {
    if (this.activeExecutionIds.size === 0) return undefined;
    for (const executionId of this.activeExecutionIds) {
      return executionId;
    }
    return undefined;
  }

  /**
   * Bind a callback to the current defense AsyncLocalStorage context.
   *
   * Useful for infrastructure callbacks that may execute later via pre-captured
   * timer references, while still needing executionId/trace continuity.
   *
   * Note: this intentionally does NOT preserve `trusted` mode. Trusted execution
   * is meant to stay tightly scoped to the immediate infrastructure operation.
   */
  static bindCurrentContext<TArgs extends unknown[], TResult>(
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    if (!executionContext) return fn;
    const current = executionContext.getStore();
    const executionId =
      current?.sandboxActive === true
        ? current.executionId
        : DefenseInDepthBox.instance?.getPreferredActiveExecutionId();
    if (!executionId) return fn;

    const captured: DefenseContext = {
      sandboxActive: true,
      executionId,
    };
    return ((...args: TArgs) =>
      executionContext.run(captured, () => fn(...args))) as (
      ...args: TArgs
    ) => TResult;
  }

  /**
   * Check if defense-in-depth is enabled and functional.
   * Returns false if AsyncLocalStorage is unavailable or config.enabled is false.
   */
  isEnabled(): boolean {
    return (
      this.config.enabled === true && executionContext !== null && !IS_BROWSER
    );
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
    if (IS_BROWSER || !this.config.enabled || !executionContext) {
      // Return a no-op handle
      const executionId = generateUUID();
      let deactivated = false;
      return {
        run: <T>(fn: () => Promise<T>): Promise<T> => {
          if (deactivated) {
            return Promise.reject(
              new Error(
                "DefenseInDepthBox handle is deactivated and cannot run new work",
              ),
            );
          }
          return fn();
        },
        deactivate: () => {
          deactivated = true;
        },
        executionId,
      };
    }

    this.refCount++;
    if (this.refCount === 1) {
      this.applyPatches();
      this.activationTime = Date.now();
    }

    const executionId = generateUUID();
    let deactivated = false;

    return {
      run: <T>(fn: () => Promise<T>): Promise<T> => {
        if (deactivated) {
          return Promise.reject(
            new Error(
              "DefenseInDepthBox handle is deactivated and cannot run new work",
            ),
          );
        }
        this.activeExecutionIds.add(executionId);
        // executionContext is guaranteed to be non-null here (checked IS_BROWSER above)
        // biome-ignore lint/style/noNonNullAssertion: guarded by IS_BROWSER check
        return executionContext!.run({ sandboxActive: true, executionId }, fn);
      },
      deactivate: () => {
        if (deactivated) return;
        deactivated = true;
        this.activeExecutionIds.delete(executionId);

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
    this.activeExecutionIds.clear();
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
   * Get the list of patch paths that failed during the last activation.
   */
  getPatchFailures(): string[] {
    return [...this.patchFailures];
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
   * Run a function as trusted infrastructure code.
   * Blocking is suspended for the current async context only — other
   * concurrent exec() calls remain protected.
   *
   * Uses AsyncLocalStorage to scope the trust, so async operations
   * spawned inside the callback inherit the trusted state.
   */
  static runTrusted<T>(fn: () => T): T {
    if (!executionContext) return fn();
    const current = executionContext.getStore();
    if (!current) return fn();
    return executionContext.run({ ...current, trusted: true }, fn);
  }

  /**
   * Async version of runTrusted.
   */
  static async runTrustedAsync<T>(fn: () => Promise<T>): Promise<T> {
    if (!executionContext) return fn();
    const current = executionContext.getStore();
    if (!current) return fn();
    return executionContext.run({ ...current, trusted: true }, fn);
  }

  /**
   * Check if current context should be blocked.
   * Returns false in audit mode, browser environment, outside sandboxed context,
   * inside runTrusted(), or when the immediate caller is a Node.js bundled dep.
   */
  private shouldBlock(): boolean {
    if (IS_BROWSER || this.config.auditMode || !executionContext) {
      return false;
    }
    const store = executionContext?.getStore();
    if (store?.sandboxActive !== true) {
      return false;
    }
    // Trusted infrastructure code (runTrusted) bypasses blocking
    if (store.trusted) {
      return false;
    }
    return true;
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
    allowedKeys?: Set<string>,
  ): T {
    const box = this;

    // @banned-pattern-ignore: intentional Proxy usage for security blocking
    return new Proxy(original, {
      get(target, prop, receiver) {
        if (box.shouldBlock()) {
          // Allow specific keys through (e.g., Node.js internal env vars)
          if (
            allowedKeys &&
            typeof prop === "string" &&
            allowedKeys.has(prop)
          ) {
            return Reflect.get(target, prop, receiver);
          }
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
    this.patchFailures = [];
    const blockedGlobals = getBlockedGlobals();

    // IPC-related globals (process.send, process.channel, process.connected)
    // are only blocked in worker contexts (WorkerDefenseInDepth). In the main
    // thread, blocking them interferes with legitimate IPC usage by test
    // runners, process managers, and Node.js internals that share the process
    // object and may access these properties during async operations within
    // the AsyncLocalStorage context.
    const skipInMainThread = new Set<SecurityViolationType>([
      "process_send",
      "process_channel",
      // process.stdout/stderr are used by console.log/debug/error internally.
      // Blocking them in the main thread breaks Node.js console output and
      // the defense layer's own diagnostic logging. They ARE blocked in
      // WorkerDefenseInDepth where the entire worker is sandboxed.
      "process_stdout",
      "process_stderr",
    ]);

    for (const blocked of blockedGlobals) {
      if (skipInMainThread.has(blocked.violationType)) continue;
      this.applyPatch(blocked);
    }

    // Protect against .constructor.constructor escape vector
    // by patching Function.prototype.constructor (and similar)
    this.protectConstructorChain();

    // Protect Error.prepareStackTrace (only block setting, not reading)
    this.protectErrorPrepareStackTrace();

    // Wrap Promise.then callbacks created in sandbox context so deferred
    // callbacks cannot outlive handle deactivation.
    this.protectPromiseThen();

    // Block dynamic import() of data:/blob: URLs via ESM loader hooks.
    // Must run BEFORE protectModuleLoad() because it uses require('node:module')
    // which goes through Module._load internally.
    this.protectDynamicImport();

    // Protect Module._load and Module._resolveFilename BEFORE process.mainModule,
    // since these methods need to read process.mainModule to find the Module class.
    this.protectModuleLoad();
    this.protectModuleResolveFilename();

    // Protect process.mainModule (may be undefined in ESM but still blockable)
    this.protectProcessMainModule();

    // Protect process.execPath (string primitive, needs defineProperty)
    this.protectProcessExecPath();

    // Note: process.connected is NOT blocked in the main thread — it is a
    // boolean primitive used by Node.js IPC internals and blocking it
    // interferes with test runners and process managers. It IS blocked in
    // WorkerDefenseInDepth where the entire worker is sandboxed.

    // Fail closed: if any critical patch failed, throw.
    // Critical patches are those that block the most dangerous escape vectors.
    const criticalPaths = ["Function.prototype.constructor", "Module._load"];
    const criticalFailures = this.patchFailures.filter((p) =>
      criticalPaths.includes(p),
    );
    if (criticalFailures.length > 0) {
      // Restore any patches that did succeed before throwing
      this.restorePatches();
      throw new Error(
        `DefenseInDepthBox: critical patches failed: ${criticalFailures.join(", ")}`,
      );
    }
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
      this.patchFailures.push("AsyncFunction.prototype.constructor");
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
      this.patchFailures.push("GeneratorFunction.prototype.constructor");
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
      this.patchFailures.push("AsyncGeneratorFunction.prototype.constructor");
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
      this.patchFailures.push("Error.prepareStackTrace");
      console.debug(
        "[DefenseInDepthBox] Could not protect Error.prepareStackTrace:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Protect Promise.then callback lifetime across deactivate boundaries.
   *
   * Callbacks registered in sandbox context are wrapped with an execution-id
   * liveness check. If they run after the originating handle is deactivated,
   * they are blocked even if global patches have already been restored.
   */
  private protectPromiseThen(): void {
    const box = this;

    try {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        Promise.prototype,
        "then",
      );
      this.originalDescriptors.push({
        target: Promise.prototype,
        prop: "then",
        descriptor: originalDescriptor,
      });

      const originalThen = originalDescriptor?.value;
      if (typeof originalThen !== "function") return;

      // biome-ignore lint/suspicious/noThenProperty: intentional Promise.then hardening hook
      Object.defineProperty(Promise.prototype, "then", {
        value: function patchedThen(
          this: Promise<unknown>,
          onFulfilled?: unknown,
          onRejected?: unknown,
        ) {
          if (!executionContext) {
            return Reflect.apply(originalThen, this, [onFulfilled, onRejected]);
          }

          const store = executionContext.getStore();
          const executionId =
            store?.sandboxActive === true && store.trusted !== true
              ? store.executionId
              : undefined;

          if (!executionId) {
            return Reflect.apply(originalThen, this, [onFulfilled, onRejected]);
          }

          const capturedContext: DefenseContext = {
            sandboxActive: true,
            executionId,
          };

          const wrapCallback = (
            cb: unknown,
            kind: "fulfilled" | "rejected",
          ): unknown => {
            if (typeof cb !== "function") return cb;

            return (...args: unknown[]) =>
              executionContext.run(capturedContext, () => {
                if (!box.isExecutionIdActive(executionId)) {
                  const path = "Promise.then";
                  const message =
                    "Promise.then callback is blocked after defense deactivation";
                  box.recordViolation(
                    "promise_then_after_deactivate",
                    path,
                    message,
                  );
                  if (box.config.auditMode) {
                    return Reflect.apply(
                      cb as (...callbackArgs: unknown[]) => unknown,
                      undefined,
                      args,
                    );
                  }
                  // Preserve native Promise.then pass-through semantics when
                  // callbacks are effectively absent:
                  // - onFulfilled omitted: value flows through unchanged
                  // - onRejected omitted: rejection propagates unchanged
                  if (kind === "fulfilled") {
                    return args[0];
                  }
                  throw args[0];
                }

                return Reflect.apply(
                  cb as (...callbackArgs: unknown[]) => unknown,
                  undefined,
                  args,
                );
              });
          };

          return Reflect.apply(originalThen, this, [
            wrapCallback(onFulfilled, "fulfilled"),
            wrapCallback(onRejected, "rejected"),
          ]);
        },
        writable: true,
        configurable: true,
      });
    } catch (e) {
      this.patchFailures.push("Promise.prototype.then");
      console.debug(
        "[DefenseInDepthBox] Could not protect Promise.prototype.then:",
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
      this.patchFailures.push(path);
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
      this.patchFailures.push("process.mainModule");
      console.debug(
        "[DefenseInDepthBox] Could not protect process.mainModule:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Protect process.execPath from being read or set in sandbox context.
   *
   * process.execPath is a string primitive (not an object), so it cannot be
   * proxied via the normal blocked globals mechanism. We use Object.defineProperty
   * with getter/setter (same pattern as protectProcessMainModule).
   */
  private protectProcessExecPath(): void {
    if (typeof process === "undefined") return;

    const box = this;

    try {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        process,
        "execPath",
      );
      this.originalDescriptors.push({
        target: process,
        prop: "execPath",
        descriptor: originalDescriptor,
      });

      const currentValue = originalDescriptor?.value ?? process.execPath;

      Object.defineProperty(process, "execPath", {
        get() {
          if (box.shouldBlock()) {
            const message =
              "process.execPath access is blocked during script execution";
            const violation = box.recordViolation(
              "process_exec_path",
              "process.execPath",
              message,
            );
            throw new SecurityViolationError(message, violation);
          }
          if (
            box.config.auditMode &&
            executionContext?.getStore()?.sandboxActive === true
          ) {
            box.recordViolation(
              "process_exec_path",
              "process.execPath",
              "process.execPath accessed (audit mode)",
            );
          }
          return currentValue;
        },
        set(value) {
          if (box.shouldBlock()) {
            const message =
              "process.execPath modification is blocked during script execution";
            const violation = box.recordViolation(
              "process_exec_path",
              "process.execPath",
              message,
            );
            throw new SecurityViolationError(message, violation);
          }
          // Allow setting outside sandbox context
          Object.defineProperty(process, "execPath", {
            value,
            writable: true,
            configurable: true,
          });
        },
        configurable: true,
      });
    } catch (e) {
      this.patchFailures.push("process.execPath");
      console.debug(
        "[DefenseInDepthBox] Could not protect process.execPath:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Block dynamic import() of data: and blob: URLs via ESM loader hooks.
   *
   * Uses Node.js module.registerHooks() (23.5+, synchronous) or
   * module.register() (20.6+, async hooks in separate thread) to install
   * ESM loader hooks that reject data: and blob: URL specifiers.
   *
   * This is process-wide and permanent (hooks cannot be unregistered).
   * Only applied once per process regardless of how many DefenseInDepthBox
   * instances are created.
   *
   * Combined with Module._resolveFilename blocking (file-based specifiers),
   * this closes the import() escape vector except for specifiers that bypass
   * both the ESM loader and CJS resolution (none known).
   */
  private protectDynamicImport(): void {
    if (IS_BROWSER || DefenseInDepthBox.importHooksRegistered) return;

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("node:module") as {
        registerHooks?: (hooks: {
          resolve: (
            specifier: string,
            context: unknown,
            nextResolve: (
              specifier: string,
              context: unknown,
            ) => { url: string },
          ) => { url: string };
        }) => void;
        register?: (specifier: string) => void;
      };

      // Prefer registerHooks() (Node.js 23.5+) — synchronous, in-thread
      if (typeof mod.registerHooks === "function") {
        mod.registerHooks({
          resolve(specifier, context, nextResolve) {
            if (
              specifier.startsWith("data:") ||
              specifier.startsWith("blob:")
            ) {
              throw new Error(
                `dynamic import of ${specifier.startsWith("data:") ? "data:" : "blob:"} URLs is blocked by defense-in-depth`,
              );
            }
            return nextResolve(specifier, context);
          },
        });
        DefenseInDepthBox.importHooksRegistered = true;
        return;
      }

      // Fall back to register() (Node.js 20.6+) — async, separate thread
      if (typeof mod.register === "function") {
        // Inline the hooks as a data: URL module. This is loaded BEFORE
        // the hooks become active, so it doesn't block its own loading.
        const hookCode = [
          "export async function resolve(specifier, context, nextResolve) {",
          '  if (specifier.startsWith("data:") || specifier.startsWith("blob:")) {',
          '    throw new Error("dynamic import of " + (specifier.startsWith("data:") ? "data:" : "blob:") + " URLs is blocked by defense-in-depth");',
          "  }",
          "  return nextResolve(specifier, context);",
          "}",
        ].join("\n");
        mod.register(`data:text/javascript,${encodeURIComponent(hookCode)}`);
        DefenseInDepthBox.importHooksRegistered = true;
      }
    } catch (e) {
      // module.register()/registerHooks() not available (older Node.js, edge runtimes)
      console.debug(
        "[DefenseInDepthBox] Could not register import() hooks:",
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
      this.patchFailures.push("Module._load");
      console.debug(
        "[DefenseInDepthBox] Could not protect Module._load:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  /**
   * Protect Module._resolveFilename from being called in sandbox context.
   *
   * Module._resolveFilename is called for both require() and import() resolution.
   * Blocking it catches file-based import() specifiers:
   *   import('./malicious.js')  // _resolveFilename is called to resolve the path
   *
   * data: and blob: URLs are handled separately by protectDynamicImport()
   * via ESM loader hooks.
   */
  private protectModuleResolveFilename(): void {
    if (IS_BROWSER) return;

    try {
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

      if (!ModuleClass || typeof ModuleClass._resolveFilename !== "function") {
        return;
      }

      const original = ModuleClass._resolveFilename as (
        ...args: unknown[]
      ) => unknown;
      const descriptor = Object.getOwnPropertyDescriptor(
        ModuleClass,
        "_resolveFilename",
      );
      this.originalDescriptors.push({
        target: ModuleClass,
        prop: "_resolveFilename",
        descriptor,
      });

      const path = "Module._resolveFilename";
      const proxy = this.createBlockingProxy(
        original,
        path,
        "module_resolve_filename",
      );

      Object.defineProperty(ModuleClass, "_resolveFilename", {
        value: proxy,
        writable: true,
        configurable: true,
      });
    } catch (e) {
      this.patchFailures.push("Module._resolveFilename");
      console.debug(
        "[DefenseInDepthBox] Could not protect Module._resolveFilename:",
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
                blocked.allowedKeys,
              );

        Object.defineProperty(target, prop, {
          value: proxy,
          writable: true, // Keep writable so external code (vitest, etc.) can reassign if needed
          configurable: true, // Must be configurable for restoration
        });
      }
    } catch (e) {
      const path = this.getPathForTarget(target, prop);
      this.patchFailures.push(path);
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
