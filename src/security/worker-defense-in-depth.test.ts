import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DefenseInDepthBox } from "./defense-in-depth-box.js";
import type { SecurityViolation } from "./types.js";
import {
  WorkerDefenseInDepth,
  WorkerSecurityViolationError,
} from "./worker-defense-in-depth.js";

/**
 * IMPORTANT: WorkerDefenseInDepth tests require special handling.
 *
 * WorkerDefenseInDepth is designed for worker threads where:
 * 1. The entire worker context is sandboxed
 * 2. No other code (like test frameworks) runs in the same context
 *
 * In tests, vitest uses console/process.env internally, which conflicts
 * with our blocking. Tests must:
 * 1. Capture results in variables while defense is active
 * 2. Run expect() assertions AFTER defense.deactivate()
 */

describe("WorkerDefenseInDepth", () => {
  let defense: WorkerDefenseInDepth | null = null;

  // Reset the main DefenseInDepthBox singleton to ensure clean global state
  beforeAll(() => {
    DefenseInDepthBox.resetInstance();
  });

  beforeEach(() => {
    defense?.deactivate();
    defense = null;
  });

  afterEach(() => {
    defense?.deactivate();
    defense = null;
  });

  describe("activation", () => {
    it("should activate when enabled", () => {
      defense = new WorkerDefenseInDepth({});
      const isActive = defense.getStats().isActive;
      defense.deactivate();
      expect(isActive).toBe(true);
    });

    it("should generate an execution ID", () => {
      defense = new WorkerDefenseInDepth({});
      const executionId = defense.getExecutionId();
      defense.deactivate();
      expect(executionId).toBeDefined();
      expect(typeof executionId).toBe("string");
    });

    it("should deactivate and restore globals", () => {
      defense = new WorkerDefenseInDepth({});
      const wasActive = defense.getStats().isActive;
      defense.deactivate();

      expect(wasActive).toBe(true);
      expect(defense.getStats().isActive).toBe(false);

      // Function should work after deactivation
      const fn = new Function("return 42");
      expect(fn()).toBe(42);
    });
  });

  describe("blocking in worker context", () => {
    describe("Function constructor blocking", () => {
      it("should block new Function()", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          new Function("return 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block Function() call without new", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          Function("return 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block Function accessed via globalThis", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          const F = globalThis.Function;
          new F("return 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe("eval blocking", () => {
      it("should block direct eval", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          // biome-ignore lint/security/noGlobalEval: intentional test
          eval("1 + 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block indirect eval via globalThis", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          // biome-ignore lint/security/noGlobalEval: intentional test
          const e = globalThis.eval;
          e("1 + 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe("setTimeout/setInterval blocking", () => {
      it("should block setTimeout", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          setTimeout(() => {}, 0);
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block setInterval", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          setInterval(() => {}, 1000);
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block setImmediate", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          setImmediate(() => {});
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe("Proxy blocking", () => {
      it("should block new Proxy()", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          new Proxy({}, {});
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe(".constructor.constructor escape vector", () => {
      it("should block {}.constructor.constructor", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          const obj = {};
          const Fn = obj.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block [].constructor.constructor", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          const arr: unknown[] = [];
          const Fn = arr.constructor.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block (() => {}).constructor", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          const fn = () => {};
          const Fn = fn.constructor;
          Fn("return 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block (async () => {}).constructor", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          const asyncFn = async () => {};
          const AsyncFn = asyncFn.constructor;
          AsyncFn("return 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block (function*(){}).constructor", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          const genFn = function* () {};
          const GenFn = genFn.constructor;
          GenFn("yield 1");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe(".constructor property reads (allowed for type introspection)", () => {
      it("should allow reading .constructor.name", () => {
        defense = new WorkerDefenseInDepth({});

        let name: string | undefined;
        let error: Error | undefined;
        try {
          const fn = () => {};
          name = fn.constructor.name;
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeUndefined();
        expect(name).toBe("Function");
      });

      it("should allow reading Function.prototype.constructor.name", () => {
        defense = new WorkerDefenseInDepth({});

        let name: string | undefined;
        let error: Error | undefined;
        try {
          name = Function.prototype.constructor.name;
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeUndefined();
        expect(name).toBe("Function");
      });

      it("should allow reading .constructor.length", () => {
        defense = new WorkerDefenseInDepth({});

        let length: number | undefined;
        let error: Error | undefined;
        try {
          const fn = () => {};
          length = fn.constructor.length;
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeUndefined();
        expect(typeof length).toBe("number");
      });

      it("should allow reading .constructor.prototype", () => {
        defense = new WorkerDefenseInDepth({});

        let proto: unknown;
        let error: Error | undefined;
        try {
          const fn = () => {};
          proto = fn.constructor.prototype;
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeUndefined();
        expect(proto).toBeDefined();
      });

      it("should allow checking .constructor with typeof", () => {
        defense = new WorkerDefenseInDepth({});

        let typeofResult: string | undefined;
        let error: Error | undefined;
        try {
          const fn = () => {};
          typeofResult = typeof fn.constructor;
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeUndefined();
        expect(typeofResult).toBe("function");
      });

      it("should block .constructor() invocation while allowing property reads", () => {
        defense = new WorkerDefenseInDepth({});

        let name: string | undefined;
        let invokeError: Error | undefined;
        try {
          const fn = () => {};
          // Reading .name should work
          name = fn.constructor.name;
          // Invoking should fail
          fn.constructor("return 1");
        } catch (e) {
          invokeError = e as Error;
        }

        defense.deactivate();
        expect(name).toBe("Function");
        expect(invokeError).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe("process.env blocking", () => {
      it("should block process.env access", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          const _home = process.env.HOME;
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
        expect(error?.message).toContain("process.env");
      });

      it("should block process.env iteration", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          Object.keys(process.env);
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe("WebAssembly blocking", () => {
      it("should block WebAssembly.Module access", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          WebAssembly.Module;
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe("Error.prepareStackTrace blocking", () => {
      it("should allow Error.prepareStackTrace reading", () => {
        defense = new WorkerDefenseInDepth({});

        let didThrow = false;
        try {
          const _pst = Error.prepareStackTrace;
        } catch {
          didThrow = true;
        }

        defense.deactivate();
        expect(didThrow).toBe(false);
      });

      it("should block Error.prepareStackTrace assignment", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          Error.prepareStackTrace = () => "hacked";
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe("process.binding blocking", () => {
      it("should block process.binding calls", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          (
            process as unknown as { binding: (name: string) => unknown }
          ).binding("fs");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block process.mainModule access when it exists (CJS contexts)", () => {
        // In ESM/workers, process.mainModule is undefined and not blocked
        // (Node.js internals like createRequire read it during module loading).
        // We test by temporarily setting mainModule before activation.
        const origMainModule = (process as unknown as Record<string, unknown>)
          .mainModule;
        (process as unknown as Record<string, unknown>).mainModule = {
          require: () => {},
        };

        try {
          defense = new WorkerDefenseInDepth({});

          let error: Error | undefined;
          try {
            const _mod = (process as unknown as { mainModule: unknown })
              .mainModule;
          } catch (e) {
            error = e as Error;
          }

          defense.deactivate();
          defense = null;
          expect(error).toBeInstanceOf(WorkerSecurityViolationError);
          expect(error?.message).toContain("process.mainModule");
        } finally {
          if (origMainModule === undefined) {
            delete (process as unknown as Record<string, unknown>).mainModule;
          } else {
            (process as unknown as Record<string, unknown>).mainModule =
              origMainModule;
          }
        }
      });

      it("should block process.dlopen calls", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          process.dlopen({} as NodeJS.Module, "/nonexistent.node");
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });
    });

    describe("other blocked globals", () => {
      it("should block WeakRef", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          new WeakRef({});
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block FinalizationRegistry", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          new FinalizationRegistry(() => {});
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
      });

      it("should block SharedArrayBuffer", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          new SharedArrayBuffer(1024);
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
        expect(error?.message).toContain("SharedArrayBuffer");
      });

      it("should block Atomics access", () => {
        defense = new WorkerDefenseInDepth({});

        let error: Error | undefined;
        try {
          Atomics.wait;
        } catch (e) {
          error = e as Error;
        }

        defense.deactivate();
        expect(error).toBeInstanceOf(WorkerSecurityViolationError);
        expect(error?.message).toContain("Atomics");
      });

      it("should freeze Reflect (not block it)", () => {
        defense = new WorkerDefenseInDepth({});

        const result = Reflect.get({ test: 42 }, "test");
        const isFrozen = Object.isFrozen(Reflect);

        defense.deactivate();
        expect(result).toBe(42);
        expect(isFrozen).toBe(true);
      });
    });
  });

  describe("audit mode", () => {
    it("should log but not block in audit mode", () => {
      const violations: SecurityViolation[] = [];
      defense = new WorkerDefenseInDepth({
        auditMode: true,
        onViolation: (v) => violations.push(v),
      });

      // Should NOT throw in audit mode
      const fn = new Function("return 42");
      const result = fn();

      defense.deactivate();

      expect(result).toBe(42);
      expect(violations.length).toBeGreaterThan(0);
      // Find the Function constructor violation
      const funcViolation = violations.find(
        (v) => v.type === "function_constructor",
      );
      expect(funcViolation).toBeDefined();
    });

    it("should record violations in audit mode", () => {
      const violations: SecurityViolation[] = [];
      defense = new WorkerDefenseInDepth({
        auditMode: true,
        onViolation: (v) => violations.push(v),
      });

      // biome-ignore lint/security/noGlobalEval: intentional test
      eval("1");
      setTimeout(() => {}, 0);

      defense.deactivate();
      // At least 2 violations (eval and setTimeout)
      expect(violations.length).toBeGreaterThanOrEqual(2);
      expect(violations.some((v) => v.type === "eval")).toBe(true);
      expect(violations.some((v) => v.type === "setTimeout")).toBe(true);
    });
  });

  describe("violation recording", () => {
    it("should record violations with correct information", () => {
      const violations: SecurityViolation[] = [];
      defense = new WorkerDefenseInDepth({
        onViolation: (v) => violations.push(v),
      });

      const executionId = defense.getExecutionId();

      try {
        new Function("return 1");
      } catch {
        // Expected
      }

      defense.deactivate();

      // Find the Function constructor violation
      const funcViolation = violations.find(
        (v) => v.type === "function_constructor",
      );
      expect(funcViolation).toBeDefined();
      expect(funcViolation?.path).toBe("globalThis.Function");
      expect(funcViolation?.timestamp).toBeGreaterThan(0);
      expect(funcViolation?.stack).toBeDefined();
      expect(funcViolation?.executionId).toBe(executionId);
    });

    it("should include violations in stats", () => {
      defense = new WorkerDefenseInDepth({});

      try {
        new Function("return 1");
      } catch {
        // Expected
      }

      const stats = defense.getStats();
      defense.deactivate();

      // At least one violation from Function
      expect(stats.violationsBlocked).toBeGreaterThanOrEqual(1);
      expect(
        stats.violations.some((v) => v.type === "function_constructor"),
      ).toBe(true);
    });

    it("should clear violations when requested", () => {
      defense = new WorkerDefenseInDepth({});

      try {
        new Function("return 1");
      } catch {
        // Expected
      }

      const countBefore = defense.getStats().violations.length;
      defense.clearViolations();
      const countAfter = defense.getStats().violations.length;

      defense.deactivate();

      expect(countBefore).toBeGreaterThanOrEqual(1);
      expect(countAfter).toBe(0);
    });

    it("should invoke onViolation callback", () => {
      const violations: SecurityViolation[] = [];
      defense = new WorkerDefenseInDepth({
        onViolation: (v) => violations.push(v),
      });

      try {
        new Function("return 1");
      } catch {
        // Expected
      }

      defense.deactivate();

      // Find the Function violation
      const funcViolation = violations.find(
        (v) => v.type === "function_constructor",
      );
      expect(funcViolation).toBeDefined();
      expect(funcViolation?.message).toContain("worker context");
    });
  });

  describe("restoration", () => {
    it("should restore Function constructor after deactivation", () => {
      defense = new WorkerDefenseInDepth({});

      // Should throw while active
      let threwWhileActive = false;
      try {
        new Function("return 1");
      } catch (e) {
        threwWhileActive = e instanceof WorkerSecurityViolationError;
      }

      defense.deactivate();

      // Should work after deactivation
      const fn = new Function("return 42");

      expect(threwWhileActive).toBe(true);
      expect(fn()).toBe(42);
    });

    it("should restore all globals after deactivation", () => {
      defense = new WorkerDefenseInDepth({});

      // All blocked while active
      let functionBlocked = false;
      let timeoutBlocked = false;
      let envBlocked = false;

      try {
        new Function("return 1");
      } catch (e) {
        functionBlocked = e instanceof WorkerSecurityViolationError;
      }

      try {
        setTimeout(() => {}, 0);
      } catch (e) {
        timeoutBlocked = e instanceof WorkerSecurityViolationError;
      }

      try {
        process.env.HOME;
      } catch (e) {
        envBlocked = e instanceof WorkerSecurityViolationError;
      }

      defense.deactivate();

      // All should work after deactivation
      expect(functionBlocked).toBe(true);
      expect(timeoutBlocked).toBe(true);
      expect(envBlocked).toBe(true);

      expect(new Function("return 42")()).toBe(42);
      const timer = setTimeout(() => {}, 0);
      clearTimeout(timer);
      expect(typeof process.env.PATH).toBe("string");
    });
  });

  describe("worker-specific behavior", () => {
    it("should always block (no context tracking needed)", () => {
      defense = new WorkerDefenseInDepth({});

      // Unlike DefenseInDepthBox, WorkerDefenseInDepth always blocks
      let threw = false;
      try {
        new Function("return 1");
      } catch (e) {
        threw = e instanceof WorkerSecurityViolationError;
      }

      defense.deactivate();
      expect(threw).toBe(true);
    });

    it("should include 'worker context' in error messages", () => {
      defense = new WorkerDefenseInDepth({});

      let errorMessage = "";
      try {
        new Function("return 1");
      } catch (e) {
        errorMessage = (e as Error).message;
      }

      defense.deactivate();
      expect(errorMessage).toContain("worker context");
    });
  });

  describe("excludeViolationTypes", () => {
    it("should allow excluded violation types to work normally", () => {
      defense = new WorkerDefenseInDepth({
        excludeViolationTypes: ["proxy"],
      });

      // Proxy should work when excluded
      let proxyWorked = false;
      let error: Error | undefined;
      try {
        const proxy = new Proxy({}, {});
        proxyWorked = proxy !== null;
      } catch (e) {
        error = e as Error;
      }

      defense.deactivate();
      expect(error).toBeUndefined();
      expect(proxyWorked).toBe(true);
    });

    it("should still block non-excluded violation types", () => {
      defense = new WorkerDefenseInDepth({
        excludeViolationTypes: ["proxy"],
      });

      // Function should still be blocked
      let error: Error | undefined;
      try {
        new Function("return 1");
      } catch (e) {
        error = e as Error;
      }

      defense.deactivate();
      expect(error).toBeInstanceOf(WorkerSecurityViolationError);
    });

    it("should allow setImmediate when excluded (as used by Python worker)", () => {
      defense = new WorkerDefenseInDepth({
        excludeViolationTypes: ["setImmediate"],
      });

      let callbackScheduled = false;
      let error: Error | undefined;
      try {
        const handle = setImmediate(() => {
          callbackScheduled = true;
        });
        clearImmediate(handle);
        callbackScheduled = true; // If we got here, it worked
      } catch (e) {
        error = e as Error;
      }

      defense.deactivate();
      expect(error).toBeUndefined();
      expect(callbackScheduled).toBe(true);
    });

    it("should allow multiple exclusions (as used by Python worker)", () => {
      defense = new WorkerDefenseInDepth({
        excludeViolationTypes: ["proxy", "setImmediate"],
      });

      let proxyWorked = false;
      let setImmediateWorked = false;
      let functionBlocked = false;

      try {
        const proxy = new Proxy({}, {});
        proxyWorked = proxy !== null;
      } catch {
        // Should not throw
      }

      try {
        const handle = setImmediate(() => {});
        clearImmediate(handle);
        setImmediateWorked = true;
      } catch {
        // Should not throw
      }

      try {
        new Function("return 1");
      } catch (e) {
        functionBlocked = e instanceof WorkerSecurityViolationError;
      }

      defense.deactivate();
      expect(proxyWorked).toBe(true);
      expect(setImmediateWorked).toBe(true);
      expect(functionBlocked).toBe(true);
    });

    it("should not record violations for excluded types", () => {
      const violations: SecurityViolation[] = [];
      defense = new WorkerDefenseInDepth({
        excludeViolationTypes: ["proxy"],
        onViolation: (v) => violations.push(v),
      });

      // Use Proxy (excluded - should not record violation)
      try {
        new Proxy({}, {});
      } catch {
        // Should not throw
      }

      // Use Function (not excluded - should record violation)
      try {
        new Function("return 1");
      } catch {
        // Expected to throw
      }

      defense.deactivate();

      // Should only have Function violation, not Proxy
      expect(violations.some((v) => v.type === "proxy")).toBe(false);
      expect(violations.some((v) => v.type === "function_constructor")).toBe(
        true,
      );
    });

    it("should exclude function_constructor when specified", () => {
      defense = new WorkerDefenseInDepth({
        excludeViolationTypes: ["function_constructor"],
      });

      let result: unknown;
      let error: Error | undefined;
      try {
        const fn = new Function("return 42");
        result = fn();
      } catch (e) {
        error = e as Error;
      }

      defense.deactivate();
      expect(error).toBeUndefined();
      expect(result).toBe(42);
    });

    it("should exclude WebAssembly when specified", () => {
      defense = new WorkerDefenseInDepth({
        excludeViolationTypes: ["webassembly"],
      });

      let wasmAccessible = false;
      let error: Error | undefined;
      try {
        // Just check that we can access WebAssembly without throwing
        wasmAccessible = typeof WebAssembly.Module === "function";
      } catch (e) {
        error = e as Error;
      }

      defense.deactivate();
      expect(error).toBeUndefined();
      expect(wasmAccessible).toBe(true);
    });
  });
});
