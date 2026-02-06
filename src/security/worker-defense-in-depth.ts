/**
 * Worker Defense-in-Depth
 *
 * A simplified version of DefenseInDepthBox designed for use in Worker threads.
 * Since workers have their own isolated V8 context, we don't need AsyncLocalStorage
 * to track execution context - the entire worker IS the sandboxed context.
 *
 * Key differences from DefenseInDepthBox:
 * - No AsyncLocalStorage (always blocks, no context tracking needed)
 * - Single activation model (apply patches once at worker startup)
 * - Violations reported via callback (typically postMessage to parent)
 *
 * Usage in a worker:
 * ```typescript
 * import { parentPort } from 'node:worker_threads';
 * import { WorkerDefenseInDepth } from '../security/worker-defense-in-depth.js';
 *
 * // Apply patches at worker startup
 * const defense = new WorkerDefenseInDepth({
 *   onViolation: (v) => parentPort?.postMessage({ type: 'security-violation', violation: v }),
 * });
 *
 * // All code in the worker is now protected
 * // Attempting Function, eval, etc. will throw SecurityViolationError
 * ```
 *
 * Constructor Protection:
 * Function.prototype.constructor returns a proxy that allows property reads
 * (e.g., `.constructor.name` for type introspection) but blocks invocation
 * (e.g., `.constructor("code")` for dynamic code execution).
 *
 * IMPORTANT: This is a SECONDARY defense layer. It should never be relied upon
 * as the primary security mechanism. The primary security comes from proper
 * sandboxing, input validation, and architectural constraints.
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
  SecurityViolation,
  SecurityViolationType,
} from "./types.js";

/**
 * Suffix added to all security violation messages.
 */
const DEFENSE_IN_DEPTH_NOTICE =
  "\n\nThis is a defense-in-depth measure and indicates a bug in just-bash. " +
  "Please report this at security@vercel.com";

/**
 * Error thrown when a security violation is detected.
 */
export class WorkerSecurityViolationError extends Error {
  constructor(
    message: string,
    public readonly violation: SecurityViolation,
  ) {
    super(message + DEFENSE_IN_DEPTH_NOTICE);
    this.name = "WorkerSecurityViolationError";
  }
}

/**
 * Statistics about the worker defense layer.
 */
export interface WorkerDefenseStats {
  /** Total number of violations detected */
  violationsBlocked: number;
  /** List of all violations detected (capped to prevent memory issues) */
  violations: SecurityViolation[];
  /** Whether patches are currently active */
  isActive: boolean;
}

// Maximum number of violations to store (prevent memory issues)
const MAX_STORED_VIOLATIONS = 1000;

/**
 * Generate a random execution ID for correlation.
 */
function generateExecutionId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Worker Defense-in-Depth
 *
 * Applies security patches to dangerous JavaScript globals in a worker context.
 * Unlike DefenseInDepthBox, this is designed for workers where the entire
 * execution context is sandboxed.
 */
export class WorkerDefenseInDepth {
  private config: DefenseInDepthConfig;
  private isActivated = false;
  private originalDescriptors: Array<{
    target: object;
    prop: string;
    descriptor: PropertyDescriptor | undefined;
  }> = [];
  private violations: SecurityViolation[] = [];
  private executionId: string;

  /**
   * Original Proxy constructor, captured before patching.
   * This is captured at instance creation time to ensure we get the unpatched version.
   */
  private originalProxy: ProxyConstructor;

  /**
   * Recursion guard to prevent infinite loops when proxy traps trigger
   * code that accesses the same proxied object (e.g., process.env).
   */
  private inTrap = false;

  /**
   * Create and activate the worker defense layer.
   *
   * @param config - Configuration for the defense layer
   */
  constructor(config: DefenseInDepthConfig) {
    // Capture original Proxy BEFORE any patching occurs
    // This ensures we can create blocking proxies even after patching
    this.originalProxy = Proxy;

    this.config = config;
    this.executionId = generateExecutionId();

    // Default to enabled if not explicitly set to false
    if (config.enabled !== false) {
      this.activate();
    }
  }

  /**
   * Get statistics about the defense layer.
   */
  getStats(): WorkerDefenseStats {
    return {
      violationsBlocked: this.violations.length,
      violations: [...this.violations],
      isActive: this.isActivated,
    };
  }

  /**
   * Clear stored violations. Useful for testing.
   */
  clearViolations(): void {
    this.violations = [];
  }

  /**
   * Get the execution ID for this worker.
   */
  getExecutionId(): string {
    return this.executionId;
  }

  /**
   * Deactivate the defense layer and restore original globals.
   * Typically only needed for testing.
   */
  deactivate(): void {
    if (!this.isActivated) {
      return;
    }
    this.restorePatches();
    this.isActivated = false;
  }

  /**
   * Activate the defense layer by applying patches.
   */
  private activate(): void {
    if (this.isActivated) {
      return;
    }

    this.applyPatches();
    this.isActivated = true;
  }

  /**
   * Get a human-readable path for a target object and property.
   */
  private getPathForTarget(target: object, prop: string): string {
    if (target === globalThis) {
      return `globalThis.${prop}`;
    }
    if (typeof process !== "undefined" && target === process) {
      return `process.${prop}`;
    }
    if (target === Error) {
      return `Error.${prop}`;
    }
    if (target === Function.prototype) {
      return `Function.prototype.${prop}`;
    }
    if (target === Object.prototype) {
      return `Object.prototype.${prop}`;
    }
    return `<object>.${prop}`;
  }

  /**
   * Record a violation and invoke the callback.
   * In worker context, blocking always happens (no audit mode context check).
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
      executionId: this.executionId,
    };

    // Store violation (with cap to prevent memory issues)
    if (this.violations.length < MAX_STORED_VIOLATIONS) {
      this.violations.push(violation);
    }

    // Invoke callback if configured (typically sends to parent thread)
    if (this.config.onViolation) {
      try {
        this.config.onViolation(violation);
      } catch (e) {
        // Ignore callback errors
        console.debug(
          "[WorkerDefenseInDepth] onViolation callback threw:",
          e instanceof Error ? e.message : e,
        );
      }
    }

    return violation;
  }

  /**
   * Create a blocking proxy for a function.
   * In worker context, always blocks (no context check needed).
   */
  // @banned-pattern-ignore: intentional use of Function type for security proxy
  private createBlockingProxy<T extends (...args: unknown[]) => unknown>(
    original: T,
    path: string,
    violationType: SecurityViolationType,
  ): T {
    const self = this;
    const auditMode = this.config.auditMode;

    // @banned-pattern-ignore: intentional Proxy usage for security blocking
    // Use this.originalProxy to avoid being blocked by our own patches
    return new this.originalProxy(original, {
      apply(target, thisArg, args) {
        const message = `${path} is blocked in worker context`;
        const violation = self.recordViolation(violationType, path, message);

        if (!auditMode) {
          throw new WorkerSecurityViolationError(message, violation);
        }
        // Audit mode: log but allow
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args, newTarget) {
        const message = `${path} constructor is blocked in worker context`;
        const violation = self.recordViolation(violationType, path, message);

        if (!auditMode) {
          throw new WorkerSecurityViolationError(message, violation);
        }
        // Audit mode: log but allow
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
    const self = this;
    const auditMode = this.config.auditMode;

    // @banned-pattern-ignore: intentional Proxy usage for security blocking
    // Use this.originalProxy to avoid being blocked by our own patches
    return new this.originalProxy(original, {
      get(target, prop, receiver) {
        // Recursion guard: if we're already in a trap (e.g., recordViolation
        // triggers process.env access), just return the value to avoid infinite loop
        if (self.inTrap) {
          return Reflect.get(target, prop, receiver);
        }
        self.inTrap = true;
        try {
          const fullPath = `${path}.${String(prop)}`;
          const message = `${fullPath} is blocked in worker context`;
          const violation = self.recordViolation(
            violationType,
            fullPath,
            message,
          );

          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          return Reflect.get(target, prop, receiver);
        } finally {
          self.inTrap = false;
        }
      },
      set(target, prop, value, receiver) {
        if (self.inTrap) {
          return Reflect.set(target, prop, value, receiver);
        }
        self.inTrap = true;
        try {
          const fullPath = `${path}.${String(prop)}`;
          const message = `${fullPath} modification is blocked in worker context`;
          const violation = self.recordViolation(
            violationType,
            fullPath,
            message,
          );

          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          return Reflect.set(target, prop, value, receiver);
        } finally {
          self.inTrap = false;
        }
      },
      ownKeys(target) {
        if (self.inTrap) {
          return Reflect.ownKeys(target);
        }
        self.inTrap = true;
        try {
          const message = `${path} enumeration is blocked in worker context`;
          const violation = self.recordViolation(violationType, path, message);

          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          return Reflect.ownKeys(target);
        } finally {
          self.inTrap = false;
        }
      },
      getOwnPropertyDescriptor(target, prop) {
        if (self.inTrap) {
          return Reflect.getOwnPropertyDescriptor(target, prop);
        }
        self.inTrap = true;
        try {
          const fullPath = `${path}.${String(prop)}`;
          const message = `${fullPath} descriptor access is blocked in worker context`;
          const violation = self.recordViolation(
            violationType,
            fullPath,
            message,
          );

          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        } finally {
          self.inTrap = false;
        }
      },
      has(target, prop) {
        if (self.inTrap) {
          return Reflect.has(target, prop);
        }
        self.inTrap = true;
        try {
          const fullPath = `${path}.${String(prop)}`;
          const message = `${fullPath} existence check is blocked in worker context`;
          const violation = self.recordViolation(
            violationType,
            fullPath,
            message,
          );

          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          return Reflect.has(target, prop);
        } finally {
          self.inTrap = false;
        }
      },
    }) as T;
  }

  /**
   * Apply security patches to dangerous globals.
   */
  private applyPatches(): void {
    const blockedGlobals = getBlockedGlobals();
    const excludeTypes = new Set(this.config.excludeViolationTypes ?? []);

    for (const blocked of blockedGlobals) {
      // Skip globals that are explicitly excluded
      if (excludeTypes.has(blocked.violationType)) {
        continue;
      }
      this.applyPatch(blocked);
    }

    // Protect against .constructor.constructor escape vector
    // (only if function constructors are not excluded)
    if (!excludeTypes.has("function_constructor")) {
      this.protectConstructorChain(excludeTypes);
    }

    // Protect Error.prepareStackTrace
    // (only if not excluded)
    if (!excludeTypes.has("error_prepare_stack_trace")) {
      this.protectErrorPrepareStackTrace();
    }

    // Protect Module._load BEFORE process.mainModule, since protectModuleLoad()
    // needs to read process.mainModule to find the Module class.
    if (!excludeTypes.has("module_load")) {
      this.protectModuleLoad();
    }

    // Protect process.mainModule (may be undefined in ESM but still blockable)
    if (!excludeTypes.has("process_main_module")) {
      this.protectProcessMainModule();
    }
  }

  /**
   * Protect against .constructor.constructor escape vector.
   * @param excludeTypes - Set of violation types to skip
   */
  private protectConstructorChain(
    excludeTypes: Set<SecurityViolationType>,
  ): void {
    // Capture all constructors BEFORE patching to avoid triggering our own patches
    let AsyncFunction: (new (...args: unknown[]) => unknown) | null = null;
    let GeneratorFunction: (new (...args: unknown[]) => unknown) | null = null;
    let AsyncGeneratorFunction: (new (...args: unknown[]) => unknown) | null =
      null;

    try {
      AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    } catch {
      // Not available
    }

    try {
      GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor;
    } catch {
      // Not available
    }

    try {
      AsyncGeneratorFunction = Object.getPrototypeOf(
        async function* () {},
      ).constructor;
    } catch {
      // Not available
    }

    // Now apply patches (order doesn't matter since we already captured constructors)
    // Always patch Function.prototype.constructor (base case)
    this.patchPrototypeConstructor(
      Function.prototype,
      "Function.prototype.constructor",
      "function_constructor",
    );

    // AsyncFunction (skip if async_function_constructor is excluded)
    if (
      !excludeTypes.has("async_function_constructor") &&
      AsyncFunction &&
      AsyncFunction !== Function
    ) {
      this.patchPrototypeConstructor(
        (AsyncFunction as { prototype: object }).prototype,
        "AsyncFunction.prototype.constructor",
        "async_function_constructor",
      );
    }

    // GeneratorFunction (skip if generator_function_constructor is excluded)
    if (
      !excludeTypes.has("generator_function_constructor") &&
      GeneratorFunction &&
      GeneratorFunction !== Function
    ) {
      this.patchPrototypeConstructor(
        (GeneratorFunction as { prototype: object }).prototype,
        "GeneratorFunction.prototype.constructor",
        "generator_function_constructor",
      );
    }

    // AsyncGeneratorFunction (skip if async_generator_function_constructor is excluded)
    if (
      !excludeTypes.has("async_generator_function_constructor") &&
      AsyncGeneratorFunction &&
      AsyncGeneratorFunction !== Function &&
      AsyncGeneratorFunction !== AsyncFunction
    ) {
      this.patchPrototypeConstructor(
        (AsyncGeneratorFunction as { prototype: object }).prototype,
        "AsyncGeneratorFunction.prototype.constructor",
        "async_generator_function_constructor",
      );
    }
  }

  /**
   * Protect Error.prepareStackTrace from being set.
   */
  private protectErrorPrepareStackTrace(): void {
    const self = this;
    const auditMode = this.config.auditMode;

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
          return currentValue;
        },
        set(value) {
          const message =
            "Error.prepareStackTrace modification is blocked in worker context";
          const violation = self.recordViolation(
            "error_prepare_stack_trace",
            "Error.prepareStackTrace",
            message,
          );

          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          currentValue = value;
        },
        configurable: true,
      });
    } catch {
      // Could not protect Error.prepareStackTrace
    }
  }

  /**
   * Patch a prototype's constructor property.
   *
   * Returns a proxy that allows reading properties (like .name) but blocks
   * calling the constructor as a function (which would allow code execution).
   */
  private patchPrototypeConstructor(
    prototype: object,
    path: string,
    violationType: SecurityViolationType,
  ): void {
    const self = this;
    const auditMode = this.config.auditMode;

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

      // Create a proxy that allows property reads but blocks invocation
      // This allows obj.constructor.name (needed by Pyodide) but blocks
      // obj.constructor("malicious code") which would create new functions
      // @banned-pattern-ignore: intentional Proxy usage for security blocking
      const constructorProxy =
        originalValue && typeof originalValue === "function"
          ? new this.originalProxy(originalValue, {
              apply(_target, _thisArg, _args) {
                const message = `${path} invocation is blocked in worker context`;
                const violation = self.recordViolation(
                  violationType,
                  path,
                  message,
                );

                if (!auditMode) {
                  throw new WorkerSecurityViolationError(message, violation);
                }
                // In audit mode, still block execution but log
                return undefined;
              },
              construct(_target, _args, _newTarget) {
                const message = `${path} construction is blocked in worker context`;
                const violation = self.recordViolation(
                  violationType,
                  path,
                  message,
                );

                if (!auditMode) {
                  throw new WorkerSecurityViolationError(message, violation);
                }
                // In audit mode, still block but log
                return {};
              },
              // Allow all property access (like .name, .prototype, etc.)
              get(target, prop, receiver) {
                return Reflect.get(target, prop, receiver);
              },
              getPrototypeOf(target) {
                return Reflect.getPrototypeOf(target);
              },
              has(target, prop) {
                return Reflect.has(target, prop);
              },
              ownKeys(target) {
                return Reflect.ownKeys(target);
              },
              getOwnPropertyDescriptor(target, prop) {
                return Reflect.getOwnPropertyDescriptor(target, prop);
              },
            })
          : originalValue;

      Object.defineProperty(prototype, "constructor", {
        get() {
          // Return the proxy that allows reads but blocks invocation
          return constructorProxy;
        },
        set(value) {
          const message = `${path} modification is blocked in worker context`;
          const violation = self.recordViolation(violationType, path, message);

          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          Object.defineProperty(this, "constructor", {
            value,
            writable: true,
            configurable: true,
          });
        },
        configurable: true,
      });
    } catch {
      // Could not patch constructor
    }
  }

  /**
   * Protect process.mainModule from being accessed or set.
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

    const self = this;
    const auditMode = this.config.auditMode;

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

      // Only protect if mainModule exists (CJS contexts).
      // In ESM/workers, mainModule is undefined and Node.js internals
      // (createRequire) access this property during module loading -
      // blocking it would crash the worker silently.
      const currentValue = originalDescriptor?.value;
      if (currentValue !== undefined) {
        Object.defineProperty(process, "mainModule", {
          get() {
            const message =
              "process.mainModule access is blocked in worker context";
            const violation = self.recordViolation(
              "process_main_module",
              "process.mainModule",
              message,
            );

            if (!auditMode) {
              throw new WorkerSecurityViolationError(message, violation);
            }
            return currentValue;
          },
          set(value) {
            const message =
              "process.mainModule modification is blocked in worker context";
            const violation = self.recordViolation(
              "process_main_module",
              "process.mainModule",
              message,
            );

            if (!auditMode) {
              throw new WorkerSecurityViolationError(message, violation);
            }
            Object.defineProperty(process, "mainModule", {
              value,
              writable: true,
              configurable: true,
            });
          },
          configurable: true,
        });
      }
    } catch {
      // Could not protect process.mainModule
    }
  }

  /**
   * Protect Module._load from being called.
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
    const self = this;
    const auditMode = this.config.auditMode;

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
      // @banned-pattern-ignore: intentional Proxy usage for security blocking
      const proxy = new this.originalProxy(original, {
        apply(_target, _thisArg, _args) {
          const message = `${path} is blocked in worker context`;
          const violation = self.recordViolation("module_load", path, message);

          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          return Reflect.apply(_target, _thisArg, _args);
        },
      }) as typeof original;

      Object.defineProperty(ModuleClass, "_load", {
        value: proxy,
        writable: true,
        configurable: true,
      });
    } catch {
      // Could not protect Module._load (expected in ESM contexts)
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

      const descriptor = Object.getOwnPropertyDescriptor(target, prop);
      this.originalDescriptors.push({ target, prop, descriptor });

      if (strategy === "freeze") {
        if (typeof original === "object" && original !== null) {
          Object.freeze(original);
        }
      } else {
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
          writable: true,
          configurable: true,
        });
      }
    } catch {
      // Could not patch
    }
  }

  /**
   * Restore all original values.
   */
  private restorePatches(): void {
    for (let i = this.originalDescriptors.length - 1; i >= 0; i--) {
      const { target, prop, descriptor } = this.originalDescriptors[i];

      try {
        if (descriptor) {
          Object.defineProperty(target, prop, descriptor);
        } else {
          delete (target as Record<string, unknown>)[prop];
        }
      } catch {
        // Could not restore
      }
    }

    this.originalDescriptors = [];
  }
}
