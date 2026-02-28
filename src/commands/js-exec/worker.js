var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});

// src/commands/js-exec/worker.ts
import { stripTypeScriptTypes } from "node:module";
import { parentPort } from "node:worker_threads";
import {
  getQuickJS
} from "quickjs-emscripten";

// src/security/blocked-globals.ts
function getBlockedGlobals() {
  const globals = [
    // Direct code execution vectors
    {
      prop: "Function",
      target: globalThis,
      violationType: "function_constructor",
      strategy: "throw",
      reason: "Function constructor allows arbitrary code execution"
    },
    {
      prop: "eval",
      target: globalThis,
      violationType: "eval",
      strategy: "throw",
      reason: "eval() allows arbitrary code execution"
    },
    // Timer functions with string argument allow code execution
    {
      prop: "setTimeout",
      target: globalThis,
      violationType: "setTimeout",
      strategy: "throw",
      reason: "setTimeout with string argument allows code execution"
    },
    {
      prop: "setInterval",
      target: globalThis,
      violationType: "setInterval",
      strategy: "throw",
      reason: "setInterval with string argument allows code execution"
    },
    {
      prop: "setImmediate",
      target: globalThis,
      violationType: "setImmediate",
      strategy: "throw",
      reason: "setImmediate could be used to escape sandbox context"
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
      reason: "process.env could leak sensitive environment variables"
    },
    {
      prop: "binding",
      target: process,
      violationType: "process_binding",
      strategy: "throw",
      reason: "process.binding provides access to native Node.js modules"
    },
    {
      prop: "_linkedBinding",
      target: process,
      violationType: "process_binding",
      strategy: "throw",
      reason: "process._linkedBinding provides access to native Node.js modules"
    },
    {
      prop: "dlopen",
      target: process,
      violationType: "process_dlopen",
      strategy: "throw",
      reason: "process.dlopen allows loading native addons"
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
      reason: "WeakRef could be used to leak references outside sandbox"
    },
    {
      prop: "FinalizationRegistry",
      target: globalThis,
      violationType: "finalization_registry",
      strategy: "throw",
      reason: "FinalizationRegistry could be used to leak references outside sandbox"
    },
    // Introspection/interception vectors (freeze instead of throw)
    {
      prop: "Reflect",
      target: globalThis,
      violationType: "reflect",
      strategy: "freeze",
      reason: "Reflect provides introspection capabilities"
    },
    {
      prop: "Proxy",
      target: globalThis,
      violationType: "proxy",
      strategy: "throw",
      reason: "Proxy allows intercepting and modifying object behavior"
    },
    // WebAssembly allows arbitrary code execution
    {
      prop: "WebAssembly",
      target: globalThis,
      violationType: "webassembly",
      strategy: "throw",
      reason: "WebAssembly allows executing arbitrary compiled code"
    },
    // SharedArrayBuffer and Atomics can enable side-channel attacks
    {
      prop: "SharedArrayBuffer",
      target: globalThis,
      violationType: "shared_array_buffer",
      strategy: "throw",
      reason: "SharedArrayBuffer could enable side-channel communication or timing attacks"
    },
    {
      prop: "Atomics",
      target: globalThis,
      violationType: "atomics",
      strategy: "throw",
      reason: "Atomics could enable side-channel communication or timing attacks"
    }
    // Note: Error.prepareStackTrace is handled specially in defense-in-depth-box.ts
    // because we only want to block SETTING it, not reading (V8 reads it internally)
  ];
  try {
    const AsyncFunction = Object.getPrototypeOf(async () => {
    }).constructor;
    if (AsyncFunction && AsyncFunction !== Function) {
      globals.push({
        prop: "constructor",
        target: Object.getPrototypeOf(async () => {
        }),
        violationType: "async_function_constructor",
        strategy: "throw",
        reason: "AsyncFunction constructor allows arbitrary async code execution"
      });
    }
  } catch {
  }
  try {
    const GeneratorFunction = Object.getPrototypeOf(
      function* () {
      }
    ).constructor;
    if (GeneratorFunction && GeneratorFunction !== Function) {
      globals.push({
        prop: "constructor",
        target: Object.getPrototypeOf(function* () {
        }),
        violationType: "generator_function_constructor",
        strategy: "throw",
        reason: "GeneratorFunction constructor allows arbitrary generator code execution"
      });
    }
  } catch {
  }
  try {
    const AsyncGeneratorFunction = Object.getPrototypeOf(
      async function* () {
      }
    ).constructor;
    if (AsyncGeneratorFunction && AsyncGeneratorFunction !== Function && AsyncGeneratorFunction !== Object.getPrototypeOf(async () => {
    }).constructor) {
      globals.push({
        prop: "constructor",
        target: Object.getPrototypeOf(async function* () {
        }),
        violationType: "async_generator_function_constructor",
        strategy: "throw",
        reason: "AsyncGeneratorFunction constructor allows arbitrary async generator code execution"
      });
    }
  } catch {
  }
  return globals.filter((g) => {
    try {
      return g.target[g.prop] !== void 0;
    } catch {
      return false;
    }
  });
}

// src/security/defense-in-depth-box.ts
var IS_BROWSER = typeof __BROWSER__ !== "undefined" && __BROWSER__;
var AsyncLocalStorageClass = null;
if (!IS_BROWSER) {
  try {
    const { createRequire } = await import("node:module");
    const require2 = createRequire(import.meta.url);
    const asyncHooks = require2("node:async_hooks");
    AsyncLocalStorageClass = asyncHooks.AsyncLocalStorage;
  } catch (e) {
    console.debug(
      "[DefenseInDepthBox] AsyncLocalStorage not available, defense-in-depth disabled:",
      e instanceof Error ? e.message : e
    );
  }
}
var executionContext = !IS_BROWSER && AsyncLocalStorageClass ? new AsyncLocalStorageClass() : null;

// src/security/worker-defense-in-depth.ts
var DEFENSE_IN_DEPTH_NOTICE = "\n\nThis is a defense-in-depth measure and indicates a bug in just-bash. Please report this at security@vercel.com";
var WorkerSecurityViolationError = class extends Error {
  constructor(message, violation) {
    super(message + DEFENSE_IN_DEPTH_NOTICE);
    this.violation = violation;
    this.name = "WorkerSecurityViolationError";
  }
};
var MAX_STORED_VIOLATIONS = 1e3;
function generateExecutionId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
var WorkerDefenseInDepth = class {
  config;
  isActivated = false;
  originalDescriptors = [];
  violations = [];
  executionId;
  /**
   * Original Proxy constructor, captured before patching.
   * This is captured at instance creation time to ensure we get the unpatched version.
   */
  originalProxy;
  /**
   * Recursion guard to prevent infinite loops when proxy traps trigger
   * code that accesses the same proxied object (e.g., process.env).
   */
  inTrap = false;
  /**
   * Create and activate the worker defense layer.
   *
   * @param config - Configuration for the defense layer
   */
  constructor(config) {
    this.originalProxy = Proxy;
    this.config = config;
    this.executionId = generateExecutionId();
    if (config.enabled !== false) {
      this.activate();
    }
  }
  /**
   * Get statistics about the defense layer.
   */
  getStats() {
    return {
      violationsBlocked: this.violations.length,
      violations: [...this.violations],
      isActive: this.isActivated
    };
  }
  /**
   * Clear stored violations. Useful for testing.
   */
  clearViolations() {
    this.violations = [];
  }
  /**
   * Get the execution ID for this worker.
   */
  getExecutionId() {
    return this.executionId;
  }
  /**
   * Deactivate the defense layer and restore original globals.
   * Typically only needed for testing.
   */
  deactivate() {
    if (!this.isActivated) {
      return;
    }
    this.restorePatches();
    this.isActivated = false;
  }
  /**
   * Activate the defense layer by applying patches.
   */
  activate() {
    if (this.isActivated) {
      return;
    }
    this.applyPatches();
    this.isActivated = true;
  }
  /**
   * Get a human-readable path for a target object and property.
   */
  getPathForTarget(target, prop) {
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
  recordViolation(type, path, message) {
    const violation = {
      timestamp: Date.now(),
      type,
      message,
      path,
      stack: new Error().stack,
      executionId: this.executionId
    };
    if (this.violations.length < MAX_STORED_VIOLATIONS) {
      this.violations.push(violation);
    }
    if (this.config.onViolation) {
      try {
        this.config.onViolation(violation);
      } catch (e) {
        console.debug(
          "[WorkerDefenseInDepth] onViolation callback threw:",
          e instanceof Error ? e.message : e
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
  createBlockingProxy(original, path, violationType) {
    const self = this;
    const auditMode = this.config.auditMode;
    return new this.originalProxy(original, {
      apply(target, thisArg, args) {
        const message = `${path} is blocked in worker context`;
        const violation = self.recordViolation(violationType, path, message);
        if (!auditMode) {
          throw new WorkerSecurityViolationError(message, violation);
        }
        return Reflect.apply(target, thisArg, args);
      },
      construct(target, args, newTarget) {
        const message = `${path} constructor is blocked in worker context`;
        const violation = self.recordViolation(violationType, path, message);
        if (!auditMode) {
          throw new WorkerSecurityViolationError(message, violation);
        }
        return Reflect.construct(target, args, newTarget);
      }
    });
  }
  /**
   * Create a blocking proxy for an object (blocks all property access).
   */
  createBlockingObjectProxy(original, path, violationType) {
    const self = this;
    const auditMode = this.config.auditMode;
    return new this.originalProxy(original, {
      get(target, prop, receiver) {
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
            message
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
            message
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
            message
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
            message
          );
          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          return Reflect.has(target, prop);
        } finally {
          self.inTrap = false;
        }
      }
    });
  }
  /**
   * Apply security patches to dangerous globals.
   */
  applyPatches() {
    const blockedGlobals = getBlockedGlobals();
    const excludeTypes = new Set(this.config.excludeViolationTypes ?? []);
    for (const blocked of blockedGlobals) {
      if (excludeTypes.has(blocked.violationType)) {
        continue;
      }
      this.applyPatch(blocked);
    }
    if (!excludeTypes.has("function_constructor")) {
      this.protectConstructorChain(excludeTypes);
    }
    if (!excludeTypes.has("error_prepare_stack_trace")) {
      this.protectErrorPrepareStackTrace();
    }
    if (!excludeTypes.has("module_load")) {
      this.protectModuleLoad();
    }
    if (!excludeTypes.has("process_main_module")) {
      this.protectProcessMainModule();
    }
  }
  /**
   * Protect against .constructor.constructor escape vector.
   * @param excludeTypes - Set of violation types to skip
   */
  protectConstructorChain(excludeTypes) {
    let AsyncFunction = null;
    let GeneratorFunction = null;
    let AsyncGeneratorFunction = null;
    try {
      AsyncFunction = Object.getPrototypeOf(async () => {
      }).constructor;
    } catch {
    }
    try {
      GeneratorFunction = Object.getPrototypeOf(function* () {
      }).constructor;
    } catch {
    }
    try {
      AsyncGeneratorFunction = Object.getPrototypeOf(
        async function* () {
        }
      ).constructor;
    } catch {
    }
    this.patchPrototypeConstructor(
      Function.prototype,
      "Function.prototype.constructor",
      "function_constructor"
    );
    if (!excludeTypes.has("async_function_constructor") && AsyncFunction && AsyncFunction !== Function) {
      this.patchPrototypeConstructor(
        AsyncFunction.prototype,
        "AsyncFunction.prototype.constructor",
        "async_function_constructor"
      );
    }
    if (!excludeTypes.has("generator_function_constructor") && GeneratorFunction && GeneratorFunction !== Function) {
      this.patchPrototypeConstructor(
        GeneratorFunction.prototype,
        "GeneratorFunction.prototype.constructor",
        "generator_function_constructor"
      );
    }
    if (!excludeTypes.has("async_generator_function_constructor") && AsyncGeneratorFunction && AsyncGeneratorFunction !== Function && AsyncGeneratorFunction !== AsyncFunction) {
      this.patchPrototypeConstructor(
        AsyncGeneratorFunction.prototype,
        "AsyncGeneratorFunction.prototype.constructor",
        "async_generator_function_constructor"
      );
    }
  }
  /**
   * Protect Error.prepareStackTrace from being set.
   */
  protectErrorPrepareStackTrace() {
    const self = this;
    const auditMode = this.config.auditMode;
    try {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        Error,
        "prepareStackTrace"
      );
      this.originalDescriptors.push({
        target: Error,
        prop: "prepareStackTrace",
        descriptor: originalDescriptor
      });
      let currentValue = originalDescriptor?.value;
      Object.defineProperty(Error, "prepareStackTrace", {
        get() {
          return currentValue;
        },
        set(value) {
          const message = "Error.prepareStackTrace modification is blocked in worker context";
          const violation = self.recordViolation(
            "error_prepare_stack_trace",
            "Error.prepareStackTrace",
            message
          );
          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          currentValue = value;
        },
        configurable: true
      });
    } catch {
    }
  }
  /**
   * Patch a prototype's constructor property.
   *
   * Returns a proxy that allows reading properties (like .name) but blocks
   * calling the constructor as a function (which would allow code execution).
   */
  patchPrototypeConstructor(prototype, path, violationType) {
    const self = this;
    const auditMode = this.config.auditMode;
    try {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        prototype,
        "constructor"
      );
      this.originalDescriptors.push({
        target: prototype,
        prop: "constructor",
        descriptor: originalDescriptor
      });
      const originalValue = originalDescriptor?.value;
      const constructorProxy = originalValue && typeof originalValue === "function" ? new this.originalProxy(originalValue, {
        apply(_target, _thisArg, _args) {
          const message = `${path} invocation is blocked in worker context`;
          const violation = self.recordViolation(
            violationType,
            path,
            message
          );
          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          return void 0;
        },
        construct(_target, _args, _newTarget) {
          const message = `${path} construction is blocked in worker context`;
          const violation = self.recordViolation(
            violationType,
            path,
            message
          );
          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
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
        }
      }) : originalValue;
      Object.defineProperty(prototype, "constructor", {
        get() {
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
            configurable: true
          });
        },
        configurable: true
      });
    } catch {
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
  protectProcessMainModule() {
    if (typeof process === "undefined") return;
    const self = this;
    const auditMode = this.config.auditMode;
    try {
      const originalDescriptor = Object.getOwnPropertyDescriptor(
        process,
        "mainModule"
      );
      this.originalDescriptors.push({
        target: process,
        prop: "mainModule",
        descriptor: originalDescriptor
      });
      const currentValue = originalDescriptor?.value;
      if (currentValue !== void 0) {
        Object.defineProperty(process, "mainModule", {
          get() {
            const message = "process.mainModule access is blocked in worker context";
            const violation = self.recordViolation(
              "process_main_module",
              "process.mainModule",
              message
            );
            if (!auditMode) {
              throw new WorkerSecurityViolationError(message, violation);
            }
            return currentValue;
          },
          set(value) {
            const message = "process.mainModule modification is blocked in worker context";
            const violation = self.recordViolation(
              "process_main_module",
              "process.mainModule",
              message
            );
            if (!auditMode) {
              throw new WorkerSecurityViolationError(message, violation);
            }
            Object.defineProperty(process, "mainModule", {
              value,
              writable: true,
              configurable: true
            });
          },
          configurable: true
        });
      }
    } catch {
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
  protectModuleLoad() {
    const self = this;
    const auditMode = this.config.auditMode;
    try {
      let ModuleClass = null;
      if (typeof process !== "undefined") {
        const mainModule = process.mainModule;
        if (mainModule && typeof mainModule === "object") {
          ModuleClass = mainModule.constructor;
        }
      }
      if (!ModuleClass && typeof __require !== "undefined" && typeof __require.main !== "undefined") {
        ModuleClass = __require.main.constructor;
      }
      if (!ModuleClass || typeof ModuleClass._load !== "function") {
        return;
      }
      const original = ModuleClass._load;
      const descriptor = Object.getOwnPropertyDescriptor(ModuleClass, "_load");
      this.originalDescriptors.push({
        target: ModuleClass,
        prop: "_load",
        descriptor
      });
      const path = "Module._load";
      const proxy = new this.originalProxy(original, {
        apply(_target, _thisArg, _args) {
          const message = `${path} is blocked in worker context`;
          const violation = self.recordViolation("module_load", path, message);
          if (!auditMode) {
            throw new WorkerSecurityViolationError(message, violation);
          }
          return Reflect.apply(_target, _thisArg, _args);
        }
      });
      Object.defineProperty(ModuleClass, "_load", {
        value: proxy,
        writable: true,
        configurable: true
      });
    } catch {
    }
  }
  /**
   * Apply a single patch to a blocked global.
   */
  applyPatch(blocked) {
    const { target, prop, violationType, strategy } = blocked;
    try {
      const original = target[prop];
      if (original === void 0) {
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
        const proxy = typeof original === "function" ? this.createBlockingProxy(
          original,
          path,
          violationType
        ) : this.createBlockingObjectProxy(
          original,
          path,
          violationType
        );
        Object.defineProperty(target, prop, {
          value: proxy,
          writable: true,
          configurable: true
        });
      }
    } catch {
    }
  }
  /**
   * Restore all original values.
   */
  restorePatches() {
    for (let i = this.originalDescriptors.length - 1; i >= 0; i--) {
      const { target, prop, descriptor } = this.originalDescriptors[i];
      try {
        if (descriptor) {
          Object.defineProperty(target, prop, descriptor);
        } else {
          delete target[prop];
        }
      } catch {
      }
    }
    this.originalDescriptors = [];
  }
};

// src/commands/worker-bridge/protocol.ts
var OpCode = {
  NOOP: 0,
  READ_FILE: 1,
  WRITE_FILE: 2,
  STAT: 3,
  READDIR: 4,
  MKDIR: 5,
  RM: 6,
  EXISTS: 7,
  APPEND_FILE: 8,
  SYMLINK: 9,
  READLINK: 10,
  LSTAT: 11,
  CHMOD: 12,
  REALPATH: 13,
  RENAME: 14,
  COPY_FILE: 15,
  // Special operations for I/O
  WRITE_STDOUT: 100,
  WRITE_STDERR: 101,
  EXIT: 102,
  // HTTP operations
  HTTP_REQUEST: 200,
  // Sub-shell execution
  EXEC_COMMAND: 300
};
var Status = {
  PENDING: 0,
  READY: 1,
  SUCCESS: 2,
  ERROR: 3
};
var ErrorCode = {
  NONE: 0,
  NOT_FOUND: 1,
  IS_DIRECTORY: 2,
  NOT_DIRECTORY: 3,
  EXISTS: 4,
  PERMISSION_DENIED: 5,
  INVALID_PATH: 6,
  IO_ERROR: 7,
  TIMEOUT: 8,
  NETWORK_ERROR: 9,
  NETWORK_NOT_CONFIGURED: 10
};
var Offset = {
  OP_CODE: 0,
  STATUS: 4,
  PATH_LENGTH: 8,
  DATA_LENGTH: 12,
  RESULT_LENGTH: 16,
  ERROR_CODE: 20,
  FLAGS: 24,
  MODE: 28,
  PATH_BUFFER: 32,
  DATA_BUFFER: 4128
  // 32 + 4096
};
var Size = {
  CONTROL_REGION: 32,
  PATH_BUFFER: 4096,
  DATA_BUFFER: 1048576,
  // 1MB (reduced from 16MB for faster tests)
  TOTAL: 1052704
  // 32 + 4096 + 1MB
};
var Flags = {
  NONE: 0,
  RECURSIVE: 1,
  FORCE: 2,
  MKDIR_RECURSIVE: 1
};
var StatLayout = {
  IS_FILE: 0,
  IS_DIRECTORY: 1,
  IS_SYMLINK: 2,
  MODE: 4,
  SIZE: 8,
  MTIME: 16,
  TOTAL: 24
};
var ProtocolBuffer = class {
  int32View;
  uint8View;
  dataView;
  constructor(buffer) {
    this.int32View = new Int32Array(buffer);
    this.uint8View = new Uint8Array(buffer);
    this.dataView = new DataView(buffer);
  }
  getOpCode() {
    return Atomics.load(this.int32View, Offset.OP_CODE / 4);
  }
  setOpCode(code) {
    Atomics.store(this.int32View, Offset.OP_CODE / 4, code);
  }
  getStatus() {
    return Atomics.load(this.int32View, Offset.STATUS / 4);
  }
  setStatus(status) {
    Atomics.store(this.int32View, Offset.STATUS / 4, status);
  }
  getPathLength() {
    return Atomics.load(this.int32View, Offset.PATH_LENGTH / 4);
  }
  setPathLength(length) {
    Atomics.store(this.int32View, Offset.PATH_LENGTH / 4, length);
  }
  getDataLength() {
    return Atomics.load(this.int32View, Offset.DATA_LENGTH / 4);
  }
  setDataLength(length) {
    Atomics.store(this.int32View, Offset.DATA_LENGTH / 4, length);
  }
  getResultLength() {
    return Atomics.load(this.int32View, Offset.RESULT_LENGTH / 4);
  }
  setResultLength(length) {
    Atomics.store(this.int32View, Offset.RESULT_LENGTH / 4, length);
  }
  getErrorCode() {
    return Atomics.load(this.int32View, Offset.ERROR_CODE / 4);
  }
  setErrorCode(code) {
    Atomics.store(this.int32View, Offset.ERROR_CODE / 4, code);
  }
  getFlags() {
    return Atomics.load(this.int32View, Offset.FLAGS / 4);
  }
  setFlags(flags) {
    Atomics.store(this.int32View, Offset.FLAGS / 4, flags);
  }
  getMode() {
    return Atomics.load(this.int32View, Offset.MODE / 4);
  }
  setMode(mode) {
    Atomics.store(this.int32View, Offset.MODE / 4, mode);
  }
  getPath() {
    const length = this.getPathLength();
    const bytes = this.uint8View.slice(
      Offset.PATH_BUFFER,
      Offset.PATH_BUFFER + length
    );
    return new TextDecoder().decode(bytes);
  }
  setPath(path) {
    const encoded = new TextEncoder().encode(path);
    if (encoded.length > Size.PATH_BUFFER) {
      throw new Error(`Path too long: ${encoded.length} > ${Size.PATH_BUFFER}`);
    }
    this.uint8View.set(encoded, Offset.PATH_BUFFER);
    this.setPathLength(encoded.length);
  }
  getData() {
    const length = this.getDataLength();
    return this.uint8View.slice(
      Offset.DATA_BUFFER,
      Offset.DATA_BUFFER + length
    );
  }
  setData(data) {
    if (data.length > Size.DATA_BUFFER) {
      throw new Error(`Data too large: ${data.length} > ${Size.DATA_BUFFER}`);
    }
    this.uint8View.set(data, Offset.DATA_BUFFER);
    this.setDataLength(data.length);
  }
  getDataAsString() {
    const data = this.getData();
    return new TextDecoder().decode(data);
  }
  setDataFromString(str) {
    const encoded = new TextEncoder().encode(str);
    this.setData(encoded);
  }
  getResult() {
    const length = this.getResultLength();
    return this.uint8View.slice(
      Offset.DATA_BUFFER,
      Offset.DATA_BUFFER + length
    );
  }
  setResult(data) {
    if (data.length > Size.DATA_BUFFER) {
      throw new Error(`Result too large: ${data.length} > ${Size.DATA_BUFFER}`);
    }
    this.uint8View.set(data, Offset.DATA_BUFFER);
    this.setResultLength(data.length);
  }
  getResultAsString() {
    const result = this.getResult();
    return new TextDecoder().decode(result);
  }
  setResultFromString(str) {
    const encoded = new TextEncoder().encode(str);
    this.setResult(encoded);
  }
  encodeStat(stat) {
    this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_FILE] = stat.isFile ? 1 : 0;
    this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_DIRECTORY] = stat.isDirectory ? 1 : 0;
    this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_SYMLINK] = stat.isSymbolicLink ? 1 : 0;
    this.dataView.setInt32(
      Offset.DATA_BUFFER + StatLayout.MODE,
      stat.mode,
      true
    );
    const size = Math.min(stat.size, Number.MAX_SAFE_INTEGER);
    this.dataView.setFloat64(Offset.DATA_BUFFER + StatLayout.SIZE, size, true);
    this.dataView.setFloat64(
      Offset.DATA_BUFFER + StatLayout.MTIME,
      stat.mtime.getTime(),
      true
    );
    this.setResultLength(StatLayout.TOTAL);
  }
  decodeStat() {
    return {
      isFile: this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_FILE] === 1,
      isDirectory: this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_DIRECTORY] === 1,
      isSymbolicLink: this.uint8View[Offset.DATA_BUFFER + StatLayout.IS_SYMLINK] === 1,
      mode: this.dataView.getInt32(Offset.DATA_BUFFER + StatLayout.MODE, true),
      size: this.dataView.getFloat64(
        Offset.DATA_BUFFER + StatLayout.SIZE,
        true
      ),
      mtime: new Date(
        this.dataView.getFloat64(Offset.DATA_BUFFER + StatLayout.MTIME, true)
      )
    };
  }
  waitForReady(timeout) {
    return Atomics.wait(
      this.int32View,
      Offset.STATUS / 4,
      Status.PENDING,
      timeout
    );
  }
  waitForReadyAsync(timeout) {
    return Atomics.waitAsync(
      this.int32View,
      Offset.STATUS / 4,
      Status.PENDING,
      timeout
    );
  }
  /**
   * Wait for status to become READY.
   * Returns immediately if status is already READY, or waits until it changes.
   */
  async waitUntilReady(timeout) {
    const startTime = Date.now();
    while (true) {
      const status = this.getStatus();
      if (status === Status.READY) {
        return true;
      }
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeout) {
        return false;
      }
      const remainingMs = timeout - elapsed;
      const result = Atomics.waitAsync(
        this.int32View,
        Offset.STATUS / 4,
        status,
        remainingMs
      );
      if (result.async) {
        const waitResult = await result.value;
        if (waitResult === "timed-out") {
          return false;
        }
      }
    }
  }
  waitForResult(timeout) {
    return Atomics.wait(
      this.int32View,
      Offset.STATUS / 4,
      Status.READY,
      timeout
    );
  }
  notify() {
    return Atomics.notify(this.int32View, Offset.STATUS / 4);
  }
  reset() {
    this.setOpCode(OpCode.NOOP);
    this.setStatus(Status.PENDING);
    this.setPathLength(0);
    this.setDataLength(0);
    this.setResultLength(0);
    this.setErrorCode(ErrorCode.NONE);
    this.setFlags(Flags.NONE);
    this.setMode(0);
  }
};

// src/commands/worker-bridge/sync-backend.ts
var SyncBackend = class {
  protocol;
  constructor(sharedBuffer) {
    this.protocol = new ProtocolBuffer(sharedBuffer);
  }
  execSync(opCode, path, data, flags = 0, mode = 0) {
    this.protocol.reset();
    this.protocol.setOpCode(opCode);
    this.protocol.setPath(path);
    this.protocol.setFlags(flags);
    this.protocol.setMode(mode);
    if (data) {
      this.protocol.setData(data);
    }
    this.protocol.setStatus(Status.READY);
    this.protocol.notify();
    const waitResult = this.protocol.waitForResult(5e3);
    if (waitResult === "timed-out") {
      return { success: false, error: "Operation timed out" };
    }
    const status = this.protocol.getStatus();
    if (status === Status.SUCCESS) {
      return { success: true, result: this.protocol.getResult() };
    }
    return {
      success: false,
      error: this.protocol.getResultAsString() || `Error code: ${this.protocol.getErrorCode()}`
    };
  }
  readFile(path) {
    const result = this.execSync(OpCode.READ_FILE, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to read file");
    }
    return result.result ?? new Uint8Array(0);
  }
  writeFile(path, data) {
    const result = this.execSync(OpCode.WRITE_FILE, path, data);
    if (!result.success) {
      throw new Error(result.error || "Failed to write file");
    }
  }
  stat(path) {
    const result = this.execSync(OpCode.STAT, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to stat");
    }
    return this.protocol.decodeStat();
  }
  lstat(path) {
    const result = this.execSync(OpCode.LSTAT, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to lstat");
    }
    return this.protocol.decodeStat();
  }
  readdir(path) {
    const result = this.execSync(OpCode.READDIR, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to readdir");
    }
    return JSON.parse(this.protocol.getResultAsString());
  }
  mkdir(path, recursive = false) {
    const flags = recursive ? Flags.MKDIR_RECURSIVE : 0;
    const result = this.execSync(OpCode.MKDIR, path, void 0, flags);
    if (!result.success) {
      throw new Error(result.error || "Failed to mkdir");
    }
  }
  rm(path, recursive = false, force = false) {
    let flags = 0;
    if (recursive) flags |= Flags.RECURSIVE;
    if (force) flags |= Flags.FORCE;
    const result = this.execSync(OpCode.RM, path, void 0, flags);
    if (!result.success) {
      throw new Error(result.error || "Failed to rm");
    }
  }
  exists(path) {
    const result = this.execSync(OpCode.EXISTS, path);
    if (!result.success) {
      return false;
    }
    return result.result?.[0] === 1;
  }
  appendFile(path, data) {
    const result = this.execSync(OpCode.APPEND_FILE, path, data);
    if (!result.success) {
      throw new Error(result.error || "Failed to append file");
    }
  }
  symlink(target, linkPath) {
    const targetData = new TextEncoder().encode(target);
    const result = this.execSync(OpCode.SYMLINK, linkPath, targetData);
    if (!result.success) {
      throw new Error(result.error || "Failed to symlink");
    }
  }
  readlink(path) {
    const result = this.execSync(OpCode.READLINK, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to readlink");
    }
    return this.protocol.getResultAsString();
  }
  chmod(path, mode) {
    const result = this.execSync(OpCode.CHMOD, path, void 0, 0, mode);
    if (!result.success) {
      throw new Error(result.error || "Failed to chmod");
    }
  }
  realpath(path) {
    const result = this.execSync(OpCode.REALPATH, path);
    if (!result.success) {
      throw new Error(result.error || "Failed to realpath");
    }
    return this.protocol.getResultAsString();
  }
  rename(oldPath, newPath) {
    const newPathData = new TextEncoder().encode(newPath);
    const result = this.execSync(OpCode.RENAME, oldPath, newPathData);
    if (!result.success) {
      throw new Error(result.error || "Failed to rename");
    }
  }
  copyFile(src, dest) {
    const destData = new TextEncoder().encode(dest);
    const result = this.execSync(OpCode.COPY_FILE, src, destData);
    if (!result.success) {
      throw new Error(result.error || "Failed to copyFile");
    }
  }
  writeStdout(data) {
    const encoded = new TextEncoder().encode(data);
    this.execSync(OpCode.WRITE_STDOUT, "", encoded);
  }
  writeStderr(data) {
    const encoded = new TextEncoder().encode(data);
    this.execSync(OpCode.WRITE_STDERR, "", encoded);
  }
  exit(code) {
    this.execSync(OpCode.EXIT, "", void 0, code);
  }
  /**
   * Make an HTTP request through the main thread's secureFetch.
   * Returns the response as a parsed object.
   */
  httpRequest(url, options) {
    const requestData = options ? new TextEncoder().encode(JSON.stringify(options)) : void 0;
    const result = this.execSync(OpCode.HTTP_REQUEST, url, requestData);
    if (!result.success) {
      throw new Error(result.error || "HTTP request failed");
    }
    const responseJson = new TextDecoder().decode(result.result);
    return JSON.parse(responseJson);
  }
  /**
   * Execute a shell command through the main thread's exec function.
   * Returns the result as { stdout, stderr, exitCode }.
   */
  execCommand(command, stdin) {
    const requestData = stdin ? new TextEncoder().encode(JSON.stringify({ stdin })) : void 0;
    const result = this.execSync(OpCode.EXEC_COMMAND, command, requestData);
    if (!result.success) {
      throw new Error(result.error || "Command execution failed");
    }
    const responseJson = new TextDecoder().decode(result.result);
    return JSON.parse(responseJson);
  }
};

// src/commands/js-exec/fetch-polyfill.ts
var FETCH_POLYFILL_SOURCE = `
(function() {
  // --- URLSearchParams ---
  function URLSearchParams(init) {
    this._entries = [];
    if (!init) return;
    if (typeof init === 'string') {
      var s = init;
      if (s.charAt(0) === '?') s = s.slice(1);
      var pairs = s.split('&');
      for (var i = 0; i < pairs.length; i++) {
        var pair = pairs[i];
        if (pair === '') continue;
        var eq = pair.indexOf('=');
        if (eq === -1) {
          this._entries.push([decodeURIComponent(pair), '']);
        } else {
          this._entries.push([
            decodeURIComponent(pair.slice(0, eq)),
            decodeURIComponent(pair.slice(eq + 1))
          ]);
        }
      }
    } else if (typeof init === 'object' && init !== null) {
      if (init instanceof URLSearchParams) {
        this._entries = init._entries.slice();
      } else {
        var keys = Object.keys(init);
        for (var i = 0; i < keys.length; i++) {
          this._entries.push([keys[i], String(init[keys[i]])]);
        }
      }
    }
  }

  URLSearchParams.prototype.append = function(name, value) {
    this._entries.push([String(name), String(value)]);
  };

  URLSearchParams.prototype.delete = function(name) {
    var n = String(name);
    this._entries = this._entries.filter(function(e) { return e[0] !== n; });
  };

  URLSearchParams.prototype.get = function(name) {
    var n = String(name);
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) return this._entries[i][1];
    }
    return null;
  };

  URLSearchParams.prototype.getAll = function(name) {
    var n = String(name);
    var result = [];
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) result.push(this._entries[i][1]);
    }
    return result;
  };

  URLSearchParams.prototype.has = function(name) {
    var n = String(name);
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) return true;
    }
    return false;
  };

  URLSearchParams.prototype.set = function(name, value) {
    var n = String(name);
    var v = String(value);
    var found = false;
    var newEntries = [];
    for (var i = 0; i < this._entries.length; i++) {
      if (this._entries[i][0] === n) {
        if (!found) {
          newEntries.push([n, v]);
          found = true;
        }
      } else {
        newEntries.push(this._entries[i]);
      }
    }
    if (!found) newEntries.push([n, v]);
    this._entries = newEntries;
  };

  URLSearchParams.prototype.sort = function() {
    this._entries.sort(function(a, b) {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });
  };

  URLSearchParams.prototype.toString = function() {
    return this._entries.map(function(e) {
      return encodeURIComponent(e[0]) + '=' + encodeURIComponent(e[1]);
    }).join('&');
  };

  URLSearchParams.prototype.forEach = function(callback, thisArg) {
    for (var i = 0; i < this._entries.length; i++) {
      callback.call(thisArg, this._entries[i][1], this._entries[i][0], this);
    }
  };

  URLSearchParams.prototype.entries = function() {
    var idx = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (idx >= entries.length) return { done: true, value: undefined };
        return { done: false, value: entries[idx++].slice() };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  URLSearchParams.prototype.keys = function() {
    var idx = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (idx >= entries.length) return { done: true, value: undefined };
        return { done: false, value: entries[idx++][0] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  URLSearchParams.prototype.values = function() {
    var idx = 0;
    var entries = this._entries;
    return {
      next: function() {
        if (idx >= entries.length) return { done: true, value: undefined };
        return { done: false, value: entries[idx++][1] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  URLSearchParams.prototype[Symbol.iterator] = URLSearchParams.prototype.entries;

  Object.defineProperty(URLSearchParams.prototype, 'size', {
    get: function() { return this._entries.length; }
  });

  // --- URL ---
  var urlRegex = /^([a-zA-Z][a-zA-Z0-9+.-]*):(?:\\/\\/(?:([^:@/?#]*)(?::([^@/?#]*))?@)?([^:/?#]*)(?::([0-9]+))?)?(\\/[^?#]*)?(?:\\?([^#]*))?(?:#(.*))?$/;

  function URL(url, base) {
    var input = String(url);

    if (base !== undefined) {
      var baseUrl = (base instanceof URL) ? base : new URL(String(base));
      // Resolve relative URL against base
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(input)) {
        // Absolute URL - parse as-is
      } else if (input.charAt(0) === '/' && input.charAt(1) === '/') {
        // Protocol-relative
        input = baseUrl.protocol + input;
      } else if (input.charAt(0) === '/') {
        // Absolute path
        input = baseUrl.origin + input;
      } else if (input.charAt(0) === '?' || input.charAt(0) === '#') {
        // Query or hash only
        var basePath = baseUrl.protocol + '//' + baseUrl.host + baseUrl.pathname;
        if (input.charAt(0) === '#') {
          input = basePath + baseUrl.search + input;
        } else {
          input = basePath + input;
        }
      } else {
        // Relative path
        var basePath = baseUrl.protocol + '//' + baseUrl.host;
        var dirPath = baseUrl.pathname;
        var lastSlash = dirPath.lastIndexOf('/');
        if (lastSlash >= 0) dirPath = dirPath.slice(0, lastSlash + 1);
        else dirPath = '/';
        input = basePath + dirPath + input;
      }
    }

    var m = urlRegex.exec(input);
    if (!m) throw new TypeError("Invalid URL: " + String(url));

    this.protocol = m[1].toLowerCase() + ':';
    this.username = m[2] ? decodeURIComponent(m[2]) : '';
    this.password = m[3] ? decodeURIComponent(m[3]) : '';
    this.hostname = m[4] || '';
    this.port = m[5] || '';
    this.pathname = m[6] || '/';
    this.hash = m[8] ? '#' + m[8] : '';

    // Normalize pathname (resolve . and ..)
    var parts = this.pathname.split('/');
    var resolved = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === '..') { if (resolved.length > 1) resolved.pop(); }
      else if (parts[i] !== '.') resolved.push(parts[i]);
    }
    this.pathname = resolved.join('/') || '/';

    // searchParams is live
    this._searchParamsStr = m[7] || '';
    this.searchParams = new URLSearchParams(this._searchParamsStr);
  }

  Object.defineProperty(URL.prototype, 'search', {
    get: function() {
      var s = this.searchParams.toString();
      return s ? '?' + s : '';
    },
    set: function(v) {
      this.searchParams = new URLSearchParams(String(v));
    }
  });

  Object.defineProperty(URL.prototype, 'host', {
    get: function() {
      return this.port ? this.hostname + ':' + this.port : this.hostname;
    }
  });

  Object.defineProperty(URL.prototype, 'origin', {
    get: function() {
      return this.protocol + '//' + this.host;
    }
  });

  Object.defineProperty(URL.prototype, 'href', {
    get: function() {
      var auth = '';
      if (this.username) {
        auth = this.username;
        if (this.password) auth += ':' + this.password;
        auth += '@';
      }
      return this.protocol + '//' + auth + this.host + this.pathname + this.search + this.hash;
    },
    set: function(v) {
      var parsed = new URL(String(v));
      this.protocol = parsed.protocol;
      this.username = parsed.username;
      this.password = parsed.password;
      this.hostname = parsed.hostname;
      this.port = parsed.port;
      this.pathname = parsed.pathname;
      this.searchParams = parsed.searchParams;
      this.hash = parsed.hash;
    }
  });

  URL.prototype.toString = function() { return this.href; };
  URL.prototype.toJSON = function() { return this.href; };

  // --- Headers ---
  function Headers(init) {
    this._map = {};
    if (!init) return;
    if (init instanceof Headers) {
      var keys = Object.keys(init._map);
      for (var i = 0; i < keys.length; i++) {
        this._map[keys[i]] = init._map[keys[i]].slice();
      }
    } else if (typeof init === 'object') {
      var keys = Object.keys(init);
      for (var i = 0; i < keys.length; i++) {
        this._map[keys[i].toLowerCase()] = [String(init[keys[i]])];
      }
    }
  }

  Headers.prototype.append = function(name, value) {
    var key = String(name).toLowerCase();
    if (!this._map[key]) this._map[key] = [];
    this._map[key].push(String(value));
  };

  Headers.prototype.delete = function(name) {
    delete this._map[String(name).toLowerCase()];
  };

  Headers.prototype.get = function(name) {
    var vals = this._map[String(name).toLowerCase()];
    return vals ? vals.join(', ') : null;
  };

  Headers.prototype.has = function(name) {
    return String(name).toLowerCase() in this._map;
  };

  Headers.prototype.set = function(name, value) {
    this._map[String(name).toLowerCase()] = [String(value)];
  };

  Headers.prototype.forEach = function(callback, thisArg) {
    var keys = Object.keys(this._map).sort();
    for (var i = 0; i < keys.length; i++) {
      callback.call(thisArg, this._map[keys[i]].join(', '), keys[i], this);
    }
  };

  Headers.prototype.entries = function() {
    var keys = Object.keys(this._map).sort();
    var map = this._map;
    var idx = 0;
    return {
      next: function() {
        if (idx >= keys.length) return { done: true, value: undefined };
        var k = keys[idx++];
        return { done: false, value: [k, map[k].join(', ')] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  Headers.prototype.keys = function() {
    var keys = Object.keys(this._map).sort();
    var idx = 0;
    return {
      next: function() {
        if (idx >= keys.length) return { done: true, value: undefined };
        return { done: false, value: keys[idx++] };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  Headers.prototype.values = function() {
    var keys = Object.keys(this._map).sort();
    var map = this._map;
    var idx = 0;
    return {
      next: function() {
        if (idx >= keys.length) return { done: true, value: undefined };
        return { done: false, value: map[keys[idx++]].join(', ') };
      },
      [Symbol.iterator]: function() { return this; }
    };
  };

  Headers.prototype[Symbol.iterator] = Headers.prototype.entries;

  // --- Response ---
  function Response(body, init) {
    if (init === undefined) init = {};
    this.status = init.status !== undefined ? init.status : 200;
    this.statusText = init.statusText !== undefined ? init.statusText : '';
    this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    this.body = body !== undefined && body !== null ? String(body) : '';
    this.ok = this.status >= 200 && this.status <= 299;
    this.url = '';
    this.redirected = false;
    this.type = 'basic';
    this.bodyUsed = false;
  }

  Response.prototype.text = function() {
    this.bodyUsed = true;
    return Promise.resolve(this.body);
  };

  Response.prototype.json = function() {
    this.bodyUsed = true;
    try {
      return Promise.resolve(JSON.parse(this.body));
    } catch (e) {
      return Promise.reject(e);
    }
  };

  Response.prototype.clone = function() {
    var r = new Response(this.body, {
      status: this.status,
      statusText: this.statusText,
      headers: new Headers(this.headers)
    });
    r.url = this.url;
    r.redirected = this.redirected;
    r.type = this.type;
    return r;
  };

  Response.json = function(data, init) {
    if (init === undefined) init = {};
    var headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    if (!headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    return new Response(JSON.stringify(data), {
      status: init.status !== undefined ? init.status : 200,
      statusText: init.statusText || '',
      headers: headers
    });
  };

  Response.error = function() {
    var r = new Response(null, { status: 0, statusText: '' });
    r.type = 'error';
    r.ok = false;
    return r;
  };

  Response.redirect = function(url, status) {
    if (status === undefined) status = 302;
    var r = new Response(null, {
      status: status,
      statusText: '',
      headers: new Headers({ location: String(url) })
    });
    r.redirected = true;
    return r;
  };

  // --- Request ---
  function Request(input, init) {
    if (init === undefined) init = {};
    if (input instanceof Request) {
      this.url = input.url;
      this.method = input.method;
      this.headers = new Headers(input.headers);
      this.body = input.body;
    } else {
      this.url = String(input);
      this.method = 'GET';
      this.headers = new Headers();
      this.body = null;
    }
    if (init.method !== undefined) this.method = String(init.method).toUpperCase();
    if (init.headers !== undefined) this.headers = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
    if (init.body !== undefined) this.body = init.body !== null ? String(init.body) : null;
  }

  Request.prototype.clone = function() {
    return new Request(this);
  };

  // --- Assign to globalThis ---
  globalThis.URLSearchParams = URLSearchParams;
  globalThis.URL = URL;
  globalThis.Headers = Headers;
  globalThis.Response = Response;
  globalThis.Request = Request;

  // --- Wrap native fetch ---
  var _nativeFetch = globalThis.__fetch;
  globalThis.fetch = function fetch(input, init) {
    try {
      var url, method, headers, body;

      if (input instanceof Request) {
        url = input.url;
        method = input.method;
        headers = {};
        input.headers.forEach(function(v, k) { headers[k] = v; });
        body = input.body;
      } else {
        url = String(input);
        method = undefined;
        headers = undefined;
        body = undefined;
      }

      if (init) {
        if (init.method !== undefined) method = String(init.method).toUpperCase();
        if (init.headers !== undefined) {
          var h = init.headers instanceof Headers ? init.headers : new Headers(init.headers);
          headers = {};
          h.forEach(function(v, k) { headers[k] = v; });
        }
        if (init.body !== undefined) body = init.body !== null ? String(init.body) : undefined;
      }

      var opts = {};
      if (method) opts.method = method;
      if (headers) opts.headers = headers;
      if (body) opts.body = body;

      var raw = _nativeFetch(url, opts);

      var respHeaders = new Headers(raw.headers || {});
      var response = new Response(raw.body, {
        status: raw.status,
        statusText: raw.statusText || '',
        headers: respHeaders
      });
      response.url = raw.url || url;

      return Promise.resolve(response);
    } catch (e) {
      return Promise.reject(new TypeError(e.message || 'fetch failed'));
    }
  };
})();
`;

// src/commands/js-exec/path-polyfill.ts
var PATH_MODULE_SOURCE = `
(function() {
  var sep = '/';
  var delimiter = ':';

  function normalize(p) {
    if (p === '') return '.';
    var isAbs = p.charCodeAt(0) === 47;
    var trailingSlash = p.charCodeAt(p.length - 1) === 47;
    var parts = p.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
        else if (!isAbs) out.push('..');
      } else {
        out.push(seg);
      }
    }
    var result = out.join('/');
    if (isAbs) result = '/' + result;
    if (trailingSlash && result[result.length - 1] !== '/') result += '/';
    return result || (isAbs ? '/' : '.');
  }

  function join() {
    var joined = '';
    for (var i = 0; i < arguments.length; i++) {
      var arg = arguments[i];
      if (typeof arg !== 'string') throw new TypeError('Path must be a string');
      if (arg.length > 0) {
        if (joined.length > 0) joined += '/' + arg;
        else joined = arg;
      }
    }
    if (joined.length === 0) return '.';
    return normalize(joined);
  }

  function resolve() {
    var resolved = '';
    var resolvedAbsolute = false;
    for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
      var path = i >= 0 ? arguments[i] : globalThis.process.cwd();
      if (typeof path !== 'string') throw new TypeError('Path must be a string');
      if (path.length === 0) continue;
      if (resolved.length > 0) resolved = path + '/' + resolved;
      else resolved = path;
      resolvedAbsolute = path.charCodeAt(0) === 47;
    }
    resolved = normalize(resolved);
    if (resolvedAbsolute) return '/' + resolved.replace(/^\\/+/, '');
    return resolved.length > 0 ? resolved : '.';
  }

  function isAbsolute(p) {
    return typeof p === 'string' && p.length > 0 && p.charCodeAt(0) === 47;
  }

  function dirname(p) {
    if (p.length === 0) return '.';
    var hasRoot = p.charCodeAt(0) === 47;
    var end = -1;
    for (var i = p.length - 1; i >= 1; i--) {
      if (p.charCodeAt(i) === 47) { end = i; break; }
    }
    if (end === -1) return hasRoot ? '/' : '.';
    if (hasRoot && end === 0) return '/';
    return p.slice(0, end);
  }

  function basename(p, ext) {
    var start = 0;
    for (var i = p.length - 1; i >= 0; i--) {
      if (p.charCodeAt(i) === 47) { start = i + 1; break; }
    }
    var base = p.slice(start);
    if (ext && base.endsWith(ext)) {
      base = base.slice(0, base.length - ext.length);
    }
    return base;
  }

  function extname(p) {
    var startDot = -1;
    var startPart = 0;
    for (var i = p.length - 1; i >= 0; i--) {
      var code = p.charCodeAt(i);
      if (code === 47) { startPart = i + 1; break; }
      if (code === 46 && startDot === -1) startDot = i;
    }
    if (startDot === -1 || startDot === startPart ||
        (startDot === startPart + 1 && p.charCodeAt(startPart) === 46)) {
      return '';
    }
    return p.slice(startDot);
  }

  function relative(from, to) {
    if (from === to) return '';
    from = resolve(from);
    to = resolve(to);
    if (from === to) return '';
    var fromParts = from.split('/').filter(Boolean);
    var toParts = to.split('/').filter(Boolean);
    var common = 0;
    var length = Math.min(fromParts.length, toParts.length);
    for (var i = 0; i < length; i++) {
      if (fromParts[i] !== toParts[i]) break;
      common++;
    }
    var ups = [];
    for (var i = common; i < fromParts.length; i++) ups.push('..');
    return ups.concat(toParts.slice(common)).join('/') || '.';
  }

  function parse(p) {
    var root = p.charCodeAt(0) === 47 ? '/' : '';
    var dir = dirname(p);
    var base = basename(p);
    var ext = extname(p);
    var name = ext ? base.slice(0, base.length - ext.length) : base;
    return { root: root, dir: dir, base: base, ext: ext, name: name };
  }

  function format(obj) {
    var dir = obj.dir || obj.root || '';
    var base = obj.base || ((obj.name || '') + (obj.ext || ''));
    if (!dir) return base;
    if (dir === obj.root) return dir + base;
    return dir + '/' + base;
  }

  var posix = { sep: sep, delimiter: delimiter, join: join, resolve: resolve, normalize: normalize, isAbsolute: isAbsolute, dirname: dirname, basename: basename, extname: extname, relative: relative, parse: parse, format: format };
  posix.posix = posix;

  globalThis.__path = posix;
})();
`;

// src/commands/js-exec/worker.ts
var quickjsModule = null;
var quickjsLoading = null;
async function getQuickJSModule() {
  if (quickjsModule) {
    return quickjsModule;
  }
  if (quickjsLoading) {
    return quickjsLoading;
  }
  quickjsLoading = getQuickJS();
  quickjsModule = await quickjsLoading;
  return quickjsModule;
}
var MEMORY_LIMIT = 64 * 1024 * 1024;
var INTERRUPT_CYCLES = 1e5;
function formatError(errorVal) {
  if (typeof errorVal === "object" && errorVal !== null && "message" in errorVal) {
    const err = errorVal;
    const msg = err.message;
    if (err.stack) {
      const lines = err.stack.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("at ")) {
          return `${trimmed}: ${msg}`;
        }
      }
    }
    return msg;
  }
  return String(errorVal);
}
function throwError(context, message) {
  return { error: context.newError(message) };
}
function jsToHandle(context, value) {
  if (value === null || value === void 0) {
    return context.undefined;
  }
  if (typeof value === "string") {
    return context.newString(value);
  }
  if (typeof value === "number") {
    return context.newNumber(value);
  }
  if (typeof value === "boolean") {
    return value ? context.true : context.false;
  }
  if (Array.isArray(value)) {
    const arr = context.newArray();
    for (let i = 0; i < value.length; i++) {
      const elemHandle = jsToHandle(context, value[i]);
      context.setProp(arr, i, elemHandle);
      elemHandle.dispose();
    }
    return arr;
  }
  if (typeof value === "object") {
    const obj = context.newObject();
    for (const [k, v] of Object.entries(value)) {
      const valHandle = jsToHandle(context, v);
      context.setProp(obj, k, valHandle);
      valHandle.dispose();
    }
    return obj;
  }
  return context.undefined;
}
function resolveModulePath(name, fromFile, cwd) {
  if (name.startsWith("/")) return name;
  const base = fromFile ? fromFile.substring(0, fromFile.lastIndexOf("/")) || "/" : cwd;
  const parts = `${base}/${name}`.split("/").filter(Boolean);
  const resolved = [];
  for (const p of parts) {
    if (p === "..") resolved.pop();
    else if (p !== ".") resolved.push(p);
  }
  return `/${resolved.join("/")}`;
}
var VIRTUAL_MODULES = {
  fs: `
    const _fs = globalThis.fs;
    export const readFile = _fs.readFile;
    export const readFileSync = _fs.readFileSync;
    export const readFileBuffer = _fs.readFileBuffer;
    export const writeFile = _fs.writeFile;
    export const writeFileSync = _fs.writeFileSync;
    export const stat = _fs.stat;
    export const statSync = _fs.statSync;
    export const lstat = _fs.lstat;
    export const lstatSync = _fs.lstatSync;
    export const readdir = _fs.readdir;
    export const readdirSync = _fs.readdirSync;
    export const mkdir = _fs.mkdir;
    export const mkdirSync = _fs.mkdirSync;
    export const rm = _fs.rm;
    export const rmSync = _fs.rmSync;
    export const exists = _fs.exists;
    export const existsSync = _fs.existsSync;
    export const appendFile = _fs.appendFile;
    export const appendFileSync = _fs.appendFileSync;
    export const symlink = _fs.symlink;
    export const symlinkSync = _fs.symlinkSync;
    export const readlink = _fs.readlink;
    export const readlinkSync = _fs.readlinkSync;
    export const chmod = _fs.chmod;
    export const chmodSync = _fs.chmodSync;
    export const realpath = _fs.realpath;
    export const realpathSync = _fs.realpathSync;
    export const rename = _fs.rename;
    export const renameSync = _fs.renameSync;
    export const copyFile = _fs.copyFile;
    export const copyFileSync = _fs.copyFileSync;
    export const unlinkSync = _fs.unlinkSync;
    export const unlink = _fs.unlink;
    export const rmdirSync = _fs.rmdirSync;
    export const rmdir = _fs.rmdir;
    export const promises = _fs.promises;
    export default _fs;
  `,
  path: `${PATH_MODULE_SOURCE}
    const _path = globalThis.__path;
    export const join = _path.join;
    export const resolve = _path.resolve;
    export const normalize = _path.normalize;
    export const isAbsolute = _path.isAbsolute;
    export const dirname = _path.dirname;
    export const basename = _path.basename;
    export const extname = _path.extname;
    export const relative = _path.relative;
    export const parse = _path.parse;
    export const format = _path.format;
    export const sep = _path.sep;
    export const delimiter = _path.delimiter;
    export const posix = _path.posix;
    export default _path;
  `,
  process: `
    const _process = globalThis.process;
    export const argv = _process.argv;
    export const cwd = _process.cwd;
    export const exit = _process.exit;
    export const env = _process.env;
    export const platform = _process.platform;
    export const arch = _process.arch;
    export const versions = _process.versions;
    export const version = _process.version;
    export default _process;
  `,
  child_process: `
    const _exec = globalThis.__exec;
    export function execSync(cmd, opts) {
      var r = _exec(cmd, opts);
      if (r.exitCode !== 0) {
        var e = new Error('Command failed: ' + cmd);
        e.status = r.exitCode;
        e.stderr = r.stderr;
        e.stdout = r.stdout;
        throw e;
      }
      return r.stdout;
    }
    export function exec(cmd, opts) { return _exec(cmd, opts); }
    export function spawnSync(cmd, args, opts) {
      var command = cmd;
      if (args && args.length) command += ' ' + args.join(' ');
      var r = _exec(command, opts);
      return { stdout: r.stdout, stderr: r.stderr, status: r.exitCode };
    }
    export default { exec: exec, execSync: execSync, spawnSync: spawnSync };
  `
};
function setupContext(context, backend, input) {
  const consoleObj = context.newObject();
  const logFn = context.newFunction("log", (...args) => {
    const parts = args.map((a) => {
      const val = context.dump(a);
      return typeof val === "string" ? val : JSON.stringify(val);
    });
    backend.writeStdout(`${parts.join(" ")}
`);
    return context.undefined;
  });
  context.setProp(consoleObj, "log", logFn);
  logFn.dispose();
  const errorFn = context.newFunction("error", (...args) => {
    const parts = args.map((a) => {
      const val = context.dump(a);
      return typeof val === "string" ? val : JSON.stringify(val);
    });
    backend.writeStderr(`${parts.join(" ")}
`);
    return context.undefined;
  });
  context.setProp(consoleObj, "error", errorFn);
  errorFn.dispose();
  const warnFn = context.newFunction("warn", (...args) => {
    const parts = args.map((a) => {
      const val = context.dump(a);
      return typeof val === "string" ? val : JSON.stringify(val);
    });
    backend.writeStderr(`${parts.join(" ")}
`);
    return context.undefined;
  });
  context.setProp(consoleObj, "warn", warnFn);
  warnFn.dispose();
  context.setProp(context.global, "console", consoleObj);
  consoleObj.dispose();
  const fsObj = context.newObject();
  const readFileFn = context.newFunction(
    "readFile",
    (pathHandle) => {
      const path = context.getString(pathHandle);
      try {
        const data = backend.readFile(path);
        return context.newString(new TextDecoder().decode(data));
      } catch (e) {
        return throwError(context, e.message || "readFile failed");
      }
    }
  );
  context.setProp(fsObj, "readFile", readFileFn);
  readFileFn.dispose();
  const readFileBufferFn = context.newFunction(
    "readFileBuffer",
    (pathHandle) => {
      const path = context.getString(pathHandle);
      try {
        const data = backend.readFile(path);
        const arr = context.newArray();
        for (let i = 0; i < data.length; i++) {
          const numHandle = context.newNumber(data[i]);
          context.setProp(arr, i, numHandle);
          numHandle.dispose();
        }
        return arr;
      } catch (e) {
        return throwError(
          context,
          e.message || "readFileBuffer failed"
        );
      }
    }
  );
  context.setProp(fsObj, "readFileBuffer", readFileBufferFn);
  readFileBufferFn.dispose();
  const writeFileFn = context.newFunction(
    "writeFile",
    (pathHandle, dataHandle) => {
      const path = context.getString(pathHandle);
      const data = context.getString(dataHandle);
      try {
        backend.writeFile(path, new TextEncoder().encode(data));
        return context.undefined;
      } catch (e) {
        return throwError(context, e.message || "writeFile failed");
      }
    }
  );
  context.setProp(fsObj, "writeFile", writeFileFn);
  writeFileFn.dispose();
  const statFn = context.newFunction("stat", (pathHandle) => {
    const path = context.getString(pathHandle);
    try {
      const stat = backend.stat(path);
      return jsToHandle(context, {
        isFile: stat.isFile,
        isDirectory: stat.isDirectory,
        isSymbolicLink: stat.isSymbolicLink,
        mode: stat.mode,
        size: stat.size,
        mtime: stat.mtime.toISOString()
      });
    } catch (e) {
      return throwError(context, e.message || "stat failed");
    }
  });
  context.setProp(fsObj, "stat", statFn);
  statFn.dispose();
  const readdirFn = context.newFunction(
    "readdir",
    (pathHandle) => {
      const path = context.getString(pathHandle);
      try {
        const entries = backend.readdir(path);
        return jsToHandle(context, entries);
      } catch (e) {
        return throwError(context, e.message || "readdir failed");
      }
    }
  );
  context.setProp(fsObj, "readdir", readdirFn);
  readdirFn.dispose();
  const mkdirFn = context.newFunction(
    "mkdir",
    (pathHandle, optsHandle) => {
      const path = context.getString(pathHandle);
      let recursive = false;
      if (optsHandle) {
        const opts = context.dump(optsHandle);
        if (opts && typeof opts === "object" && "recursive" in opts) {
          recursive = Boolean(opts.recursive);
        }
      }
      try {
        backend.mkdir(path, recursive);
        return context.undefined;
      } catch (e) {
        return throwError(context, e.message || "mkdir failed");
      }
    }
  );
  context.setProp(fsObj, "mkdir", mkdirFn);
  mkdirFn.dispose();
  const rmFn = context.newFunction(
    "rm",
    (pathHandle, optsHandle) => {
      const path = context.getString(pathHandle);
      let recursive = false;
      let force = false;
      if (optsHandle) {
        const opts = context.dump(optsHandle);
        if (opts && typeof opts === "object") {
          if ("recursive" in opts) recursive = Boolean(opts.recursive);
          if ("force" in opts) force = Boolean(opts.force);
        }
      }
      try {
        backend.rm(path, recursive, force);
        return context.undefined;
      } catch (e) {
        return throwError(context, e.message || "rm failed");
      }
    }
  );
  context.setProp(fsObj, "rm", rmFn);
  rmFn.dispose();
  const existsFn = context.newFunction(
    "exists",
    (pathHandle) => {
      const path = context.getString(pathHandle);
      return backend.exists(path) ? context.true : context.false;
    }
  );
  context.setProp(fsObj, "exists", existsFn);
  existsFn.dispose();
  const appendFileFn = context.newFunction(
    "appendFile",
    (pathHandle, dataHandle) => {
      const path = context.getString(pathHandle);
      const data = context.getString(dataHandle);
      try {
        backend.appendFile(path, new TextEncoder().encode(data));
        return context.undefined;
      } catch (e) {
        return throwError(context, e.message || "appendFile failed");
      }
    }
  );
  context.setProp(fsObj, "appendFile", appendFileFn);
  appendFileFn.dispose();
  const lstatFn = context.newFunction("lstat", (pathHandle) => {
    const path = context.getString(pathHandle);
    try {
      const s = backend.lstat(path);
      return jsToHandle(context, {
        isFile: s.isFile,
        isDirectory: s.isDirectory,
        isSymbolicLink: s.isSymbolicLink,
        mode: s.mode,
        size: s.size,
        mtime: s.mtime.toISOString()
      });
    } catch (e) {
      return throwError(context, e.message || "lstat failed");
    }
  });
  context.setProp(fsObj, "lstat", lstatFn);
  lstatFn.dispose();
  const symlinkFn = context.newFunction(
    "symlink",
    (targetHandle, pathHandle) => {
      const target = context.getString(targetHandle);
      const linkPath = context.getString(pathHandle);
      try {
        backend.symlink(target, linkPath);
        return context.undefined;
      } catch (e) {
        return throwError(context, e.message || "symlink failed");
      }
    }
  );
  context.setProp(fsObj, "symlink", symlinkFn);
  symlinkFn.dispose();
  const readlinkFn = context.newFunction(
    "readlink",
    (pathHandle) => {
      const path = context.getString(pathHandle);
      try {
        const target = backend.readlink(path);
        return context.newString(target);
      } catch (e) {
        return throwError(context, e.message || "readlink failed");
      }
    }
  );
  context.setProp(fsObj, "readlink", readlinkFn);
  readlinkFn.dispose();
  const chmodFn = context.newFunction(
    "chmod",
    (pathHandle, modeHandle) => {
      const path = context.getString(pathHandle);
      const mode = context.dump(modeHandle);
      try {
        backend.chmod(path, typeof mode === "number" ? mode : 0);
        return context.undefined;
      } catch (e) {
        return throwError(context, e.message || "chmod failed");
      }
    }
  );
  context.setProp(fsObj, "chmod", chmodFn);
  chmodFn.dispose();
  const realpathFn = context.newFunction(
    "realpath",
    (pathHandle) => {
      const path = context.getString(pathHandle);
      try {
        const resolved = backend.realpath(path);
        return context.newString(resolved);
      } catch (e) {
        return throwError(context, e.message || "realpath failed");
      }
    }
  );
  context.setProp(fsObj, "realpath", realpathFn);
  realpathFn.dispose();
  const renameFn = context.newFunction(
    "rename",
    (oldHandle, newHandle) => {
      const oldPath = context.getString(oldHandle);
      const newPath = context.getString(newHandle);
      try {
        backend.rename(oldPath, newPath);
        return context.undefined;
      } catch (e) {
        return throwError(context, e.message || "rename failed");
      }
    }
  );
  context.setProp(fsObj, "rename", renameFn);
  renameFn.dispose();
  const copyFileFn = context.newFunction(
    "copyFile",
    (srcHandle, destHandle) => {
      const src = context.getString(srcHandle);
      const dest = context.getString(destHandle);
      try {
        backend.copyFile(src, dest);
        return context.undefined;
      } catch (e) {
        return throwError(context, e.message || "copyFile failed");
      }
    }
  );
  context.setProp(fsObj, "copyFile", copyFileFn);
  copyFileFn.dispose();
  context.setProp(context.global, "fs", fsObj);
  fsObj.dispose();
  const fetchFn = context.newFunction(
    "fetch",
    (urlHandle, optsHandle) => {
      const url = context.getString(urlHandle);
      let options;
      if (optsHandle) {
        options = context.dump(optsHandle);
      }
      try {
        const result = backend.httpRequest(url, {
          method: options?.method,
          headers: options?.headers,
          body: options?.body
        });
        return jsToHandle(context, result);
      } catch (e) {
        return throwError(context, e.message || "fetch failed");
      }
    }
  );
  context.setProp(context.global, "__fetch", fetchFn);
  fetchFn.dispose();
  const execFn = context.newFunction(
    "exec",
    (cmdHandle, optsHandle) => {
      const command = context.getString(cmdHandle);
      let stdin;
      if (optsHandle) {
        const opts = context.dump(optsHandle);
        if (opts?.stdin) {
          stdin = String(opts.stdin);
        }
      }
      try {
        const result = backend.execCommand(command, stdin);
        return jsToHandle(context, result);
      } catch (e) {
        return throwError(context, e.message || "exec failed");
      }
    }
  );
  context.setProp(context.global, "__exec", execFn);
  execFn.dispose();
  const envObj = jsToHandle(context, input.env);
  context.setProp(context.global, "env", envObj);
  envObj.dispose();
  const processObj = context.newObject();
  const argv = [input.scriptPath || "js-exec", ...input.args];
  const argvHandle = jsToHandle(context, argv);
  context.setProp(processObj, "argv", argvHandle);
  argvHandle.dispose();
  const cwdFn = context.newFunction("cwd", () => {
    return context.newString(input.cwd);
  });
  context.setProp(processObj, "cwd", cwdFn);
  cwdFn.dispose();
  const exitFn = context.newFunction("exit", (codeHandle) => {
    let code = 0;
    if (codeHandle) {
      const val = context.dump(codeHandle);
      code = typeof val === "number" ? val : 0;
    }
    backend.exit(code);
    return throwError(context, "__EXIT__");
  });
  context.setProp(processObj, "exit", exitFn);
  exitFn.dispose();
  context.setProp(context.global, "process", processObj);
  processObj.dispose();
  const compatResult = context.evalCode(
    `(function() {
  var _fs = globalThis.fs;
  // Save original native functions
  var orig = {};
  var allNames = [
    'readFile', 'readFileBuffer', 'writeFile', 'stat', 'lstat', 'readdir',
    'mkdir', 'rm', 'exists', 'appendFile', 'symlink', 'readlink',
    'chmod', 'realpath', 'rename', 'copyFile'
  ];
  for (var i = 0; i < allNames.length; i++) {
    orig[allNames[i]] = _fs[allNames[i]];
  }

  // Wrap async-style methods to always throw (matching Node.js which requires a callback).
  // In Node.js, calling fs.readFile() without a callback throws TypeError.
  // We don't support callbacks, so the async form always errors.
  function wrapCb(fn, name) {
    return function() {
      throw new Error(
        "fs." + name + "() with callbacks is not supported. " +
        "Use fs." + name + "Sync() or fs.promises." + name + "() instead."
      );
    };
  }
  var cbNames = [
    'readFile', 'writeFile', 'stat', 'lstat', 'readdir', 'mkdir',
    'rm', 'appendFile', 'symlink', 'readlink', 'chmod', 'realpath',
    'rename', 'copyFile'
  ];
  for (var i = 0; i < cbNames.length; i++) {
    if (orig[cbNames[i]]) _fs[cbNames[i]] = wrapCb(orig[cbNames[i]], cbNames[i]);
  }
  // exists: callback is especially common in legacy Node.js
  _fs.exists = wrapCb(orig.exists, 'exists');

  // Sync aliases point to original unwrapped native functions
  _fs.readFileSync = orig.readFile;
  _fs.writeFileSync = orig.writeFile;
  _fs.statSync = orig.stat;
  _fs.lstatSync = orig.lstat;
  _fs.readdirSync = orig.readdir;
  _fs.mkdirSync = orig.mkdir;
  _fs.rmSync = orig.rm;
  _fs.existsSync = orig.exists;
  _fs.appendFileSync = orig.appendFile;
  _fs.symlinkSync = orig.symlink;
  _fs.readlinkSync = orig.readlink;
  _fs.chmodSync = orig.chmod;
  _fs.realpathSync = orig.realpath;
  _fs.renameSync = orig.rename;
  _fs.copyFileSync = orig.copyFile;
  _fs.unlinkSync = orig.rm;
  _fs.rmdirSync = orig.rm;
  _fs.unlink = wrapCb(orig.rm, 'unlink');
  _fs.rmdir = wrapCb(orig.rm, 'rmdir');

  // promises namespace
  _fs.promises = {};
  for (var i = 0; i < allNames.length; i++) {
    var m = allNames[i];
    (function(fn) {
      _fs.promises[m] = function() {
        try { return Promise.resolve(fn.apply(null, arguments)); }
        catch(e) { return Promise.reject(e); }
      };
    })(orig[m]);
  }
  _fs.promises.unlink = _fs.promises.rm;
  _fs.promises.rmdir = _fs.promises.rm;
  _fs.promises.access = function(p) {
    return orig.exists(p) ? Promise.resolve() : Promise.reject(new Error('ENOENT: no such file or directory: ' + p));
  };

  // process enhancements
  var _p = globalThis.process;
  _p.env = globalThis.env;
  _p.platform = 'linux';
  _p.arch = 'x64';
  _p.versions = { node: '22.0.0', quickjs: '2024' };
  _p.version = 'v22.0.0';

  // Initialize path module on globalThis so require('path') works
  ${PATH_MODULE_SOURCE}

  // Initialize fetch polyfill (URL, Headers, Request, Response, fetch)
  ${FETCH_POLYFILL_SOURCE}

  // require() shim for CommonJS compatibility
  var _execFn = globalThis.__exec;
  var _childProcess = {
    exec: function(cmd, opts) { return _execFn(cmd, opts); },
    execSync: function(cmd, opts) {
      var r = _execFn(cmd, opts);
      if (r.exitCode !== 0) {
        var e = new Error('Command failed: ' + cmd);
        e.status = r.exitCode;
        e.stderr = r.stderr;
        e.stdout = r.stdout;
        throw e;
      }
      return r.stdout;
    },
    spawnSync: function(cmd, args, opts) {
      var command = cmd;
      if (args && args.length) command += ' ' + args.join(' ');
      var r = _execFn(command, opts);
      return { stdout: r.stdout, stderr: r.stderr, status: r.exitCode };
    }
  };

  var _modules = {
    fs: _fs,
    path: globalThis.__path,
    child_process: _childProcess,
    process: _p,
    console: globalThis.console
  };

  globalThis.require = function(name) {
    if (name.startsWith('node:')) name = name.slice(5);
    var mod = _modules[name];
    if (mod) return mod;
    throw new Error("Cannot find module '" + name + "'");
  };
  globalThis.require.resolve = function(name) { return name; };
})();`,
    "<compat>"
  );
  if (compatResult.error) {
    compatResult.error.dispose();
  } else {
    compatResult.value.dispose();
  }
}
var defense = null;
async function initializeWithDefense() {
  await getQuickJSModule();
  try {
    stripTypeScriptTypes("const x = 1;");
  } catch {
  }
  await new Promise((r) => setTimeout(r, 0));
  defense = new WorkerDefenseInDepth({
    excludeViolationTypes: ["shared_array_buffer", "atomics"]
  });
}
async function executeCode(input) {
  const qjs = await getQuickJSModule();
  const backend = new SyncBackend(input.sharedBuffer);
  let runtime;
  let context;
  try {
    runtime = qjs.newRuntime();
    runtime.setMemoryLimit(MEMORY_LIMIT);
    let interruptCount = 0;
    runtime.setInterruptHandler(() => {
      interruptCount++;
      return interruptCount > INTERRUPT_CYCLES;
    });
    context = runtime.newContext();
    setupContext(context, backend, input);
    if (input.isModule) {
      runtime.setModuleLoader(
        (moduleName) => {
          const virtualSource = VIRTUAL_MODULES[moduleName];
          if (virtualSource) return virtualSource;
          try {
            const data = backend.readFile(moduleName);
            let source = new TextDecoder().decode(data);
            if (moduleName.endsWith(".ts") || moduleName.endsWith(".mts")) {
              source = stripTypeScriptTypes(source);
            }
            return source;
          } catch (e) {
            return {
              error: new Error(
                `Cannot find module '${moduleName}': ${e.message}`
              )
            };
          }
        },
        (baseModuleName, requestedName) => {
          if (requestedName.startsWith("node:")) {
            requestedName = requestedName.slice(5);
          }
          if (!requestedName.startsWith("./") && !requestedName.startsWith("../") && !requestedName.startsWith("/")) {
            return requestedName;
          }
          const baseDir = baseModuleName === "<eval>" ? input.cwd : baseModuleName.substring(0, baseModuleName.lastIndexOf("/")) || "/";
          return resolveModulePath(requestedName, baseModuleName, baseDir);
        }
      );
    }
    if (input.bootstrapCode) {
      const bootstrapResult = context.evalCode(
        input.bootstrapCode,
        "bootstrap.js"
      );
      if (bootstrapResult.error) {
        const errorVal = context.dump(bootstrapResult.error);
        bootstrapResult.error.dispose();
        const errorMsg = formatError(errorVal);
        backend.writeStderr(`js-exec: bootstrap error: ${errorMsg}
`);
        backend.exit(1);
        return { success: true };
      }
      bootstrapResult.value.dispose();
    }
    const filename = input.scriptPath || "<eval>";
    let jsCode = input.jsCode;
    if (input.stripTypes) {
      jsCode = stripTypeScriptTypes(jsCode);
    }
    const evalOptions = {};
    if (input.isModule) evalOptions.type = "module";
    const result = context.evalCode(jsCode, filename, evalOptions);
    if (result.error) {
      const errorVal = context.dump(result.error);
      result.error.dispose();
      const rawMsg = typeof errorVal === "object" && errorVal !== null && "message" in errorVal ? errorVal.message : String(errorVal);
      if (rawMsg === "__EXIT__") {
        return { success: true };
      }
      const errorMsg = formatError(errorVal);
      backend.writeStderr(`${errorMsg}
`);
      backend.exit(1);
      return { success: true };
    }
    {
      const pendingResult = runtime.executePendingJobs();
      if ("error" in pendingResult && pendingResult.error) {
        const errorVal = context.dump(pendingResult.error);
        pendingResult.error.dispose();
        const rawPendingMsg = typeof errorVal === "object" && errorVal !== null && "message" in errorVal ? errorVal.message : String(errorVal);
        if (rawPendingMsg !== "__EXIT__") {
          const errorMsg = formatError(errorVal);
          backend.writeStderr(`${errorMsg}
`);
          backend.exit(1);
          return { success: true };
        }
        return { success: true };
      }
    }
    result.value.dispose();
    backend.exit(0);
    return {
      success: true,
      defenseStats: defense?.getStats()
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    try {
      backend.writeStderr(`js-exec: ${message}
`);
      backend.exit(1);
    } catch {
      return { success: false, error: message };
    }
    return { success: true };
  } finally {
    context?.dispose();
    runtime?.dispose();
  }
}
initializeWithDefense().then(async () => {
}).catch((e) => {
  parentPort?.postMessage({
    success: false,
    error: e.message,
    defenseStats: defense?.getStats()
  });
});
parentPort?.on("message", async (input) => {
  try {
    if (!defense) {
      await initializeWithDefense();
    }
    const result = await executeCode(input);
    result.defenseStats = defense?.getStats();
    parentPort?.postMessage(result);
  } catch (e) {
    parentPort?.postMessage({
      success: false,
      error: e.message,
      defenseStats: defense?.getStats()
    });
  }
});
