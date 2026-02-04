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
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { type BlockedGlobal, getBlockedGlobals } from "./blocked-globals.js";
import type {
  DefenseInDepthConfig,
  DefenseInDepthHandle,
  DefenseInDepthStats,
  SecurityViolation,
  SecurityViolationType,
} from "./types.js";

/**
 * Error thrown when a security violation is detected and blocking is enabled.
 */
export class SecurityViolationError extends Error {
  constructor(
    message: string,
    public readonly violation: SecurityViolation,
  ) {
    super(message);
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
const executionContext = new AsyncLocalStorage<DefenseContext>();

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
    return executionContext.getStore()?.sandboxActive === true;
  }

  /**
   * Get the current execution ID if in a sandboxed context.
   */
  static getCurrentExecutionId(): string | undefined {
    return executionContext.getStore()?.executionId;
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
    if (!this.config.enabled) {
      // Return a no-op handle when disabled
      const executionId = randomUUID();
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

    const executionId = randomUUID();

    return {
      run: <T>(fn: () => Promise<T>): Promise<T> => {
        return executionContext.run({ sandboxActive: true, executionId }, fn);
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
   * Returns false in audit mode or outside sandboxed context.
   */
  private shouldBlock(): boolean {
    if (this.config.auditMode) {
      return false;
    }
    return executionContext.getStore()?.sandboxActive === true;
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
      executionId: executionContext.getStore()?.executionId,
    };

    // Store violation (with cap to prevent memory issues)
    if (this.violations.length < MAX_STORED_VIOLATIONS) {
      this.violations.push(violation);
    }

    // Invoke callback if configured
    if (this.config.onViolation) {
      try {
        this.config.onViolation(violation);
      } catch {
        // Ignore callback errors
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
          executionContext.getStore()?.sandboxActive === true
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
          executionContext.getStore()?.sandboxActive === true
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
          executionContext.getStore()?.sandboxActive === true
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
    } catch {
      // AsyncFunction not available
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
    } catch {
      // GeneratorFunction not available
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
            executionContext.getStore()?.sandboxActive === true
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
    } catch {
      // May fail in some environments
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
    } catch {
      // Some properties may not be patchable (e.g., in strict mode)
      // Continue with other patches
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
      } catch {
        // Some properties may not be restorable
        // Continue with other restorations
      }
    }

    this.originalDescriptors = [];
  }
}
