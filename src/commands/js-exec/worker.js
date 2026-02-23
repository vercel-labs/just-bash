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
    export const readFileBuffer = _fs.readFileBuffer;
    export const writeFile = _fs.writeFile;
    export const stat = _fs.stat;
    export const readdir = _fs.readdir;
    export const mkdir = _fs.mkdir;
    export const rm = _fs.rm;
    export const exists = _fs.exists;
    export const appendFile = _fs.appendFile;
    export default _fs;
  `,
  exec: `
    const _exec = globalThis.exec;
    export function exec(cmd, opts) { return _exec(cmd, opts); }
    export default _exec;
  `,
  fetch: `
    const _fetch = globalThis.fetch;
    export default _fetch;
    export { _fetch as fetch };
  `,
  process: `
    const _process = globalThis.process;
    export const argv = _process.argv;
    export const cwd = _process.cwd;
    export const exit = _process.exit;
    export default _process;
  `,
  env: `
    export default globalThis.env;
  `,
  console: `
    const _console = globalThis.console;
    export const log = _console.log;
    export const error = _console.error;
    export const warn = _console.warn;
    export default _console;
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
  context.setProp(context.global, "fetch", fetchFn);
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
  context.setProp(context.global, "exec", execFn);
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
        const errorMsg = typeof errorVal === "object" && errorVal !== null && "message" in errorVal ? errorVal.message : String(errorVal);
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
      const errorMsg = typeof errorVal === "object" && errorVal !== null && "message" in errorVal ? errorVal.message : String(errorVal);
      if (errorMsg === "__EXIT__") {
        return { success: true };
      }
      backend.writeStderr(`${errorMsg}
`);
      backend.exit(1);
      return { success: true };
    }
    if (input.isModule) {
      const pendingResult = runtime.executePendingJobs();
      if ("error" in pendingResult && pendingResult.error) {
        const errorVal = context.dump(pendingResult.error);
        pendingResult.error.dispose();
        const errorMsg = typeof errorVal === "object" && errorVal !== null && "message" in errorVal ? errorVal.message : String(errorVal);
        if (errorMsg !== "__EXIT__") {
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
