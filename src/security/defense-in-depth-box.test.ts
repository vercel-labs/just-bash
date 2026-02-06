import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "./defense-in-depth-box.js";
import type { SecurityViolation } from "./types.js";

describe("DefenseInDepthBox", () => {
  beforeEach(() => {
    // Reset the singleton instance before each test
    DefenseInDepthBox.resetInstance();
  });

  afterEach(() => {
    // Ensure cleanup after each test
    DefenseInDepthBox.resetInstance();
  });

  describe("singleton pattern", () => {
    it("should return the same instance on multiple calls", () => {
      const instance1 = DefenseInDepthBox.getInstance(true);
      const instance2 = DefenseInDepthBox.getInstance(true);
      expect(instance1).toBe(instance2);
    });

    it("should reset instance correctly", () => {
      const instance1 = DefenseInDepthBox.getInstance(true);
      DefenseInDepthBox.resetInstance();
      const instance2 = DefenseInDepthBox.getInstance(true);
      expect(instance1).not.toBe(instance2);
    });
  });

  describe("activation", () => {
    it("should return a handle with run and deactivate methods", () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      expect(handle).toHaveProperty("run");
      expect(handle).toHaveProperty("deactivate");
      expect(handle).toHaveProperty("executionId");
      expect(typeof handle.run).toBe("function");
      expect(typeof handle.deactivate).toBe("function");
      expect(typeof handle.executionId).toBe("string");

      handle.deactivate();
    });

    it("should track reference count for nested activations", () => {
      const box = DefenseInDepthBox.getInstance(true);

      const handle1 = box.activate();
      expect(box.isActive()).toBe(true);
      expect(box.getStats().refCount).toBe(1);

      const handle2 = box.activate();
      expect(box.isActive()).toBe(true);
      expect(box.getStats().refCount).toBe(2);

      handle2.deactivate();
      expect(box.isActive()).toBe(true);
      expect(box.getStats().refCount).toBe(1);

      handle1.deactivate();
      expect(box.isActive()).toBe(false);
      expect(box.getStats().refCount).toBe(0);
    });

    it("should handle unbalanced deactivations gracefully", () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      handle.deactivate();
      handle.deactivate(); // Extra deactivation
      handle.deactivate(); // Another extra

      expect(box.getStats().refCount).toBe(0);
      expect(box.isActive()).toBe(false);
    });

    it("should return no-op handle when disabled", async () => {
      const box = DefenseInDepthBox.getInstance({ enabled: false });
      const handle = box.activate();

      // Should not be active
      expect(box.isActive()).toBe(false);

      // run() should just execute the function directly
      const result = await handle.run(async () => "test");
      expect(result).toBe("test");

      // deactivate() should be a no-op
      handle.deactivate();
      expect(box.isActive()).toBe(false);
    });
  });

  describe("blocking in sandboxed context", () => {
    describe("Function constructor blocking", () => {
      it("should block new Function() inside sandbox context", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            new Function("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("Function");
      });

      it("should block Function() call without new", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Function can be called without new
            Function("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("Function");
      });

      it("should block Function with multiple arguments", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Function('arg1', 'arg2', 'return arg1 + arg2')
            new Function("a", "b", "return a + b");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block Function accessed via globalThis", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const F = globalThis.Function;
            new F("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block Function stored in variable AFTER sandbox activation", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Store reference AFTER activation - gets the proxy
        const StoredFunction = Function;

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // The stored reference is the proxy, so it will throw
            new StoredFunction("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should NOT block Function stored BEFORE sandbox activation (known limitation)", async () => {
        // This documents a known limitation: if code captures Function reference
        // BEFORE the sandbox is activated, that reference bypasses the proxy.
        // This is why defense-in-depth is a SECONDARY layer, not primary.
        const StoredFunction = Function;

        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let result: number | undefined;
        await handle.run(async () => {
          // The pre-stored reference bypasses the proxy
          const fn = new StoredFunction("return 42");
          result = fn();
        });

        handle.deactivate();

        // This succeeds because the reference was captured before patching
        expect(result).toBe(42);
      });
    });

    describe("eval blocking", () => {
      it("should block direct eval inside sandbox context", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // biome-ignore lint/security/noGlobalEval: intentional test of eval blocking
            eval("1 + 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("eval");
      });

      it("should block indirect eval via globalThis", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // biome-ignore lint/security/noGlobalEval: intentional test of eval blocking
            const e = globalThis.eval;
            e("1 + 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block eval with complex code", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // biome-ignore lint/security/noGlobalEval: intentional test
            eval("(function() { return process.env; })()");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block eval stored in variable AFTER sandbox activation", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Store reference AFTER activation - gets the proxy
        // biome-ignore lint/security/noGlobalEval: intentional test of eval blocking
        const storedEval = eval;

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            storedEval("1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should NOT block eval stored BEFORE sandbox activation (known limitation)", async () => {
        // Known limitation: pre-stored references bypass the proxy
        // biome-ignore lint/security/noGlobalEval: intentional test of eval blocking
        const storedEval = eval;

        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let result: number | undefined;
        await handle.run(async () => {
          result = storedEval("1 + 1");
        });

        handle.deactivate();

        expect(result).toBe(2);
      });
    });

    describe("setTimeout blocking", () => {
      it("should block setTimeout with function callback", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            setTimeout(() => {}, 0);
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("setTimeout");
      });

      it("should block setTimeout with string argument (code execution)", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // String argument to setTimeout evaluates as code
            setTimeout("console.log('executed')", 0);
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block setTimeout with delay and extra arguments", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            setTimeout((a: number, b: number) => a + b, 100, 1, 2);
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block setInterval", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            setInterval(() => {}, 1000);
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("setInterval");
      });

      it("should block setImmediate", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            setImmediate(() => {});
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("setImmediate");
      });
    });

    describe("Proxy blocking", () => {
      it("should block new Proxy() construction", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            new Proxy({}, {});
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("Proxy");
      });

      it("should block Proxy with handler traps", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            new Proxy(
              {},
              {
                get: () => "intercepted",
                set: () => true,
              },
            );
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should NOT block Proxy.revocable (known limitation)", async () => {
        // Known limitation: Proxy.revocable is a static method that internally
        // uses the original Proxy constructor, bypassing our proxy. This is
        // acceptable because:
        // 1. Defense-in-depth is a secondary layer
        // 2. Primary sandboxing should prevent access to Proxy entirely
        // 3. Direct `new Proxy()` calls ARE blocked
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let result: { proxy: object; revoke: () => void } | undefined;
        await handle.run(async () => {
          // This bypasses our proxy because revocable uses internal Proxy
          result = Proxy.revocable({}, {});
        });

        handle.deactivate();

        // This succeeds - it's a known limitation
        expect(result).toBeDefined();
        expect(result?.proxy).toBeDefined();
        expect(typeof result?.revoke).toBe("function");
      });

      it("should block Proxy with function target", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            new Proxy(() => {}, {
              apply: () => "intercepted",
            });
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });
    });

    describe(".constructor.constructor escape vector", () => {
      it("should block {}.constructor.constructor (Object → Function)", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const obj = {};
            const Fn = obj.constructor.constructor;
            Fn("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block [].constructor.constructor (Array → Function)", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const arr: unknown[] = [];
            const Fn = arr.constructor.constructor;
            Fn("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block ''.constructor.constructor (String → Function)", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const str = "";
            const Fn = str.constructor.constructor;
            Fn("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block (0).constructor.constructor (Number → Function)", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const num = 0;
            const Fn = num.constructor.constructor;
            Fn("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block (() => {}).constructor (direct Function access)", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const fn = () => {};
            const Fn = fn.constructor;
            Fn("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block (async () => {}).constructor (AsyncFunction access)", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const asyncFn = async () => {};
            const AsyncFn = asyncFn.constructor;
            AsyncFn("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block (function*(){}).constructor (GeneratorFunction access)", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const genFn = function* () {};
            const GenFn = genFn.constructor;
            GenFn("yield 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block (async function*(){}).constructor (AsyncGeneratorFunction access)", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            const asyncGenFn = async function* () {};
            const AsyncGenFn = asyncGenFn.constructor;
            AsyncGenFn("yield 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block AsyncGeneratorFunction via .constructor.constructor", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Access AsyncGeneratorFunction via prototype chain
            const asyncGenFn = async function* () {};
            const proto = Object.getPrototypeOf(asyncGenFn);
            const AsyncGenFn = proto.constructor;
            AsyncGenFn("yield await Promise.resolve(1)");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block chained constructor access through prototype", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Access via Object.prototype
            const proto = Object.prototype;
            const Fn = proto.constructor.constructor;
            Fn("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block Function access even when discovered via Reflect (which is frozen, not blocked)", async () => {
        // Reflect uses "freeze" strategy, so it still works but is frozen.
        // However, accessing Function via Reflect still goes through our
        // constructor protection.
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Reflect.getPrototypeOf works (Reflect is frozen, not blocked)
            const fn = () => {};
            const proto = Reflect.getPrototypeOf(fn);
            // But accessing the constructor on Function.prototype is blocked
            if (proto) {
              const Fn = (proto as { constructor: typeof Function })
                .constructor;
              Fn("return 1");
            }
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });
    });

    describe("process.env blocking", () => {
      it("should block process.env access", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Accessing any property on process.env should throw
            const _home = process.env.HOME;
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.env");
      });

      it("should block process.env iteration", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Trying to iterate over env should throw
            Object.keys(process.env);
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block process.env modification", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            process.env.MALICIOUS_VAR = "bad";
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should allow process.env outside sandbox context", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Outside run() context - should work
        const path = process.env.PATH;
        expect(typeof path).toBe("string");

        handle.deactivate();
      });
    });

    describe("WebAssembly blocking", () => {
      it("should block WebAssembly.Module", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Accessing WebAssembly should throw
            WebAssembly.Module;
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("WebAssembly");
      });

      it("should block WebAssembly.compile", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            WebAssembly.compile;
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block new WebAssembly.Module()", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Even trying to construct should fail when accessing WebAssembly
            const WA = WebAssembly;
            new WA.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should allow WebAssembly outside sandbox context", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Outside run() context - should work
        expect(typeof WebAssembly).toBe("object");
        expect(typeof WebAssembly.Module).toBe("function");

        handle.deactivate();
      });
    });

    describe("Error.prepareStackTrace blocking", () => {
      it("should allow Error.prepareStackTrace reading (V8 needs this)", async () => {
        // Reading is allowed because V8 uses this internally for stack traces
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let didThrow = false;
        await handle.run(async () => {
          try {
            // Reading prepareStackTrace should work (not throw)
            const _pst = Error.prepareStackTrace;
          } catch {
            didThrow = true;
          }
        });

        handle.deactivate();

        // Should not throw - reading is allowed
        expect(didThrow).toBe(false);
      });

      it("should block Error.prepareStackTrace assignment", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Assigning to prepareStackTrace should throw
            Error.prepareStackTrace = () => "hacked";
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("Error.prepareStackTrace");
      });

      it("should block the actual attack vector", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // This is the actual attack - set prepareStackTrace to leak Function
            Error.prepareStackTrace = (_err, stack) => {
              return stack[0]?.getFunction?.()?.constructor;
            };
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should allow Error.prepareStackTrace assignment outside sandbox context", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Outside run() context - should work
        const original = Error.prepareStackTrace;
        Error.prepareStackTrace = (_err, _stack) => "test";
        Error.prepareStackTrace = original;

        handle.deactivate();
      });
    });

    describe("process.binding blocking", () => {
      it("should block process.binding calls", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Calling process.binding should throw
            // Use type assertion since binding is deprecated and not in types
            (
              process as unknown as { binding: (name: string) => unknown }
            ).binding("fs");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.binding");
      });

      it("should block process._linkedBinding calls", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Calling process._linkedBinding should throw
            (
              process as NodeJS.Process & {
                _linkedBinding: (name: string) => unknown;
              }
            )._linkedBinding("fs");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process._linkedBinding");
      });

      it("should block process.dlopen calls", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Calling process.dlopen should throw
            // We pass invalid args since we just want to test the blocking
            process.dlopen({} as NodeJS.Module, "/nonexistent.node");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("process.dlopen");
      });

      it("should block process.mainModule access when it exists (CJS contexts)", async () => {
        // In ESM, process.mainModule is undefined and not blocked
        // (Node.js internals like createRequire read it during module loading).
        // In CJS contexts where mainModule exists, it would be blocked.
        // We test by temporarily setting mainModule before activation.
        const origMainModule = (process as unknown as Record<string, unknown>)
          .mainModule;
        (process as unknown as Record<string, unknown>).mainModule = {
          require: () => {},
        };

        try {
          const box = DefenseInDepthBox.getInstance(true);
          const handle = box.activate();

          let error: Error | undefined;
          await handle.run(async () => {
            try {
              const _mod = (process as unknown as { mainModule: unknown })
                .mainModule;
            } catch (e) {
              error = e as Error;
            }
          });

          handle.deactivate();

          expect(error).toBeInstanceOf(SecurityViolationError);
          expect(error?.message).toContain("process.mainModule");
        } finally {
          // Restore original value
          if (origMainModule === undefined) {
            delete (process as unknown as Record<string, unknown>).mainModule;
          } else {
            (process as unknown as Record<string, unknown>).mainModule =
              origMainModule;
          }
        }
      });

      it("should allow process.binding outside sandbox context", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Outside run() context - should work (binding exists)
        expect(
          typeof (process as unknown as { binding: unknown }).binding,
        ).toBe("function");

        handle.deactivate();
      });
    });

    describe("other blocked globals", () => {
      it("should block WeakRef", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            new WeakRef({});
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("WeakRef");
      });

      it("should block FinalizationRegistry", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            new FinalizationRegistry(() => {});
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("FinalizationRegistry");
      });

      it("should freeze Reflect (not block it)", async () => {
        // Reflect uses "freeze" strategy - it's frozen to prevent modification,
        // but its methods still work. This is intentional because:
        // 1. Reflect is needed by some legitimate code
        // 2. Freezing prevents adding malicious methods
        // 3. Primary sandboxing should prevent misuse
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let result: unknown;
        await handle.run(async () => {
          // Reflect still works - it's frozen, not blocked
          result = Reflect.get({ test: 42 }, "test");
        });

        handle.deactivate();

        expect(result).toBe(42);
        // Verify Reflect is frozen
        expect(Object.isFrozen(Reflect)).toBe(true);
      });
    });

    describe("SharedArrayBuffer blocking", () => {
      it("should block new SharedArrayBuffer()", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            new SharedArrayBuffer(1024);
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("SharedArrayBuffer");
      });

      it("should block Atomics access", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            Atomics.wait;
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
        expect(error?.message).toContain("Atomics");
      });

      it("should allow SharedArrayBuffer outside sandbox context", () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        // Outside run() context - should work
        const sab = new SharedArrayBuffer(16);
        expect(sab.byteLength).toBe(16);

        handle.deactivate();
      });
    });

    // Note: We don't block process because Node.js internals need it
    // (process.nextTick is used in Promise resolution)

    it("should allow operations outside sandbox context even when active", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      // Outside run() context - should NOT throw
      const fn = new Function("return 42");
      expect(fn()).toBe(42);

      // Inside run() context - should throw
      let error: Error | undefined;
      await handle.run(async () => {
        try {
          new Function("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      handle.deactivate();

      expect(error).toBeInstanceOf(SecurityViolationError);
    });
  });

  describe("audit mode", () => {
    it("should log but not block in audit mode", async () => {
      const violations: SecurityViolation[] = [];
      const box = DefenseInDepthBox.getInstance({
        enabled: true,
        auditMode: true,
        onViolation: (v) => violations.push(v),
      });
      const handle = box.activate();

      // Should NOT throw in audit mode
      let result: number | undefined;
      await handle.run(async () => {
        const fn = new Function("return 42");
        result = fn();
      });

      handle.deactivate();

      expect(result).toBe(42);
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].type).toBe("function_constructor");
      expect(violations[0].message).toContain("audit mode");
    });
  });

  describe("violation recording", () => {
    it("should record violations with correct information", async () => {
      const violations: SecurityViolation[] = [];
      const box = DefenseInDepthBox.getInstance({
        enabled: true,
        onViolation: (v) => violations.push(v),
      });
      const handle = box.activate();

      await handle.run(async () => {
        try {
          new Function("return 1");
        } catch {
          // Expected
        }
      });

      handle.deactivate();

      expect(violations.length).toBe(1);
      expect(violations[0].type).toBe("function_constructor");
      expect(violations[0].path).toBe("globalThis.Function");
      expect(violations[0].timestamp).toBeGreaterThan(0);
      expect(violations[0].stack).toBeDefined();
      expect(violations[0].executionId).toBe(handle.executionId);
    });

    it("should include violations in stats", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      await handle.run(async () => {
        try {
          new Function("return 1");
        } catch {
          // Expected
        }
      });

      const stats = box.getStats();
      expect(stats.violationsBlocked).toBe(1);
      expect(stats.violations.length).toBe(1);

      handle.deactivate();
    });

    it("should clear violations when requested", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      await handle.run(async () => {
        try {
          new Function("return 1");
        } catch {
          // Expected
        }
      });

      expect(box.getStats().violations.length).toBe(1);
      box.clearViolations();
      expect(box.getStats().violations.length).toBe(0);

      handle.deactivate();
    });
  });

  describe("restoration", () => {
    it("should restore Function constructor after deactivation", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      // Should throw inside context
      let error: Error | undefined;
      await handle.run(async () => {
        try {
          new Function("return 1");
        } catch (e) {
          error = e as Error;
        }
      });

      expect(error).toBeInstanceOf(SecurityViolationError);

      handle.deactivate();

      // Should work after deactivation
      const fn = new Function("return 42");
      expect(fn()).toBe(42);
    });

    it("should restore all globals after forceDeactivate", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      box.activate();
      box.activate(); // Multiple activations

      expect(box.isActive()).toBe(true);
      expect(box.getStats().refCount).toBe(2);

      box.forceDeactivate();

      expect(box.isActive()).toBe(false);
      expect(box.getStats().refCount).toBe(0);

      // Should work after force deactivation
      const fn = new Function("return 42");
      expect(fn()).toBe(42);
    });
  });

  describe("static helpers", () => {
    it("should report correct context status via isInSandboxedContext", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      // Outside run() - not in sandboxed context
      expect(DefenseInDepthBox.isInSandboxedContext()).toBe(false);

      // Inside run() - capture values, check outside
      let insideContext: boolean | undefined;
      let insideExecutionId: string | undefined;
      await handle.run(async () => {
        insideContext = DefenseInDepthBox.isInSandboxedContext();
        insideExecutionId = DefenseInDepthBox.getCurrentExecutionId();
      });

      handle.deactivate();

      // Check values outside sandbox context (where expect() works)
      expect(insideContext).toBe(true);
      expect(insideExecutionId).toBe(handle.executionId);

      // After deactivation - not in sandboxed context
      expect(DefenseInDepthBox.isInSandboxedContext()).toBe(false);
    });
  });

  describe("stats tracking", () => {
    it("should track active time", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      // Small delay to ensure time passes
      await new Promise<void>((resolve) => {
        // We're outside sandbox context here, so setImmediate works
        setImmediate(resolve);
      });

      const stats = box.getStats();
      expect(stats.activeTimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.refCount).toBe(1);

      handle.deactivate();

      const finalStats = box.getStats();
      expect(finalStats.refCount).toBe(0);
    });
  });

  describe("nested handle.run() with different execution IDs", () => {
    it("should maintain separate execution IDs for nested run() calls", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle1 = box.activate();
      const handle2 = box.activate();

      // Execution IDs should be different
      expect(handle1.executionId).not.toBe(handle2.executionId);

      // Track execution IDs seen during nested runs
      const seenIds: (string | undefined)[] = [];

      await handle1.run(async () => {
        seenIds.push(DefenseInDepthBox.getCurrentExecutionId());

        // Nested run with different handle
        await handle2.run(async () => {
          seenIds.push(DefenseInDepthBox.getCurrentExecutionId());
        });

        // After nested run, should be back to handle1's context
        seenIds.push(DefenseInDepthBox.getCurrentExecutionId());
      });

      handle2.deactivate();
      handle1.deactivate();

      expect(seenIds[0]).toBe(handle1.executionId);
      expect(seenIds[1]).toBe(handle2.executionId);
      expect(seenIds[2]).toBe(handle1.executionId);
    });

    it("should block in all nested contexts", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle1 = box.activate();
      const handle2 = box.activate();

      const errors: Error[] = [];

      await handle1.run(async () => {
        try {
          new Function("return 1");
        } catch (e) {
          errors.push(e as Error);
        }

        await handle2.run(async () => {
          try {
            new Function("return 2");
          } catch (e) {
            errors.push(e as Error);
          }
        });
      });

      handle2.deactivate();
      handle1.deactivate();

      expect(errors.length).toBe(2);
      expect(errors[0]).toBeInstanceOf(SecurityViolationError);
      expect(errors[1]).toBeInstanceOf(SecurityViolationError);
    });

    it("should correlate violations to correct execution ID", async () => {
      const violations: SecurityViolation[] = [];
      const box = DefenseInDepthBox.getInstance({
        enabled: true,
        onViolation: (v) => violations.push(v),
      });
      const handle1 = box.activate();
      const handle2 = box.activate();

      await handle1.run(async () => {
        try {
          new Function("return 1");
        } catch {
          // Expected
        }

        await handle2.run(async () => {
          try {
            // biome-ignore lint/security/noGlobalEval: intentional test
            eval("1");
          } catch {
            // Expected
          }
        });
      });

      handle2.deactivate();
      handle1.deactivate();

      expect(violations.length).toBe(2);
      expect(violations[0].executionId).toBe(handle1.executionId);
      expect(violations[1].executionId).toBe(handle2.executionId);
    });
  });

  describe("bypass attempt vectors", () => {
    describe("Proxy.revocable attack vector", () => {
      it("should allow Proxy.revocable to create proxies (known limitation)", async () => {
        // This demonstrates that Proxy.revocable bypasses our protection.
        // It's a known limitation documented in the code.
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let interceptedValue: string | undefined;
        await handle.run(async () => {
          // Attacker can create a proxy using Proxy.revocable
          const { proxy } = Proxy.revocable(
            { secret: "original" },
            {
              get: (_target, prop) => {
                if (prop === "secret") return "intercepted!";
                return undefined;
              },
            },
          );
          interceptedValue = (proxy as { secret: string }).secret;
        });

        handle.deactivate();

        // This succeeds - Proxy.revocable bypasses our blocking
        expect(interceptedValue).toBe("intercepted!");
      });

      it("should demonstrate Proxy.revocable could be used for malicious interception", async () => {
        // This shows a more realistic attack: intercepting function calls
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let wasIntercepted = false;
        let result: number | undefined;
        await handle.run(async () => {
          const originalFn = (x: number) => x * 2;

          // Create intercepting proxy via revocable
          const { proxy: interceptedFn } = Proxy.revocable(originalFn, {
            apply: (_target, _thisArg, args) => {
              wasIntercepted = true;
              return (args[0] as number) * 100; // Malicious modification
            },
          });

          result = (interceptedFn as (x: number) => number)(5);
        });

        handle.deactivate();

        // Attacker successfully intercepted and modified the result
        expect(wasIntercepted).toBe(true);
        expect(result).toBe(500);
      });
    });

    describe("Object.getOwnPropertyDescriptor bypass attempts", () => {
      it("should still block Function access via getOwnPropertyDescriptor", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Attempt to get the original Function via descriptor
            const descriptor = Object.getOwnPropertyDescriptor(
              globalThis,
              "Function",
            );
            if (descriptor?.value) {
              // The descriptor.value is our proxy, so using it should throw
              const Fn = descriptor.value as typeof Function;
              new Fn("return 1");
            }
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        // Should throw because descriptor.value contains our blocking proxy
        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block process.env access even via getOwnPropertyDescriptor", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Attempt to get process.env via descriptor
            const descriptor = Object.getOwnPropertyDescriptor(process, "env");
            if (descriptor?.value) {
              // The descriptor.value is our blocking proxy for env
              const _path = (descriptor.value as NodeJS.ProcessEnv).PATH;
            }
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        // Should throw because process.env descriptor returns our blocking proxy
        expect(error).toBeInstanceOf(SecurityViolationError);
      });
    });

    describe("globalThis modification attempts", () => {
      it("should allow globalThis.Function reassignment (known limitation)", async () => {
        // KNOWN LIMITATION: Since globalThis.Function is writable, attackers can
        // reassign it to bypass our proxy. This is why defense-in-depth is a
        // SECONDARY layer - primary sandboxing should prevent this.
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let result: string | undefined;
        await handle.run(async () => {
          // Attacker overwrites with their own function (factory pattern)
          globalThis.Function = (() => () =>
            "hacked") as unknown as FunctionConstructor;

          // Now use it as a factory - bypasses our protection
          // Note: can't use `new` since arrow functions aren't constructors
          const fn = Function();
          result = (fn as () => string)();
        });

        handle.deactivate();

        // This succeeds - it's a known bypass via reassignment
        expect(result).toBe("hacked");
      });

      it("should lose protection if Function is deleted (known limitation)", async () => {
        // KNOWN LIMITATION: If Function is deleted from globalThis, the bare
        // identifier `Function` will throw ReferenceError. This is actually a
        // security win (code can't execute), but documents the behavior.
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Delete the patched property
            delete (globalThis as Record<string, unknown>).Function;

            // Now accessing Function throws ReferenceError (not SecurityViolationError)
            new Function("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        // Throws ReferenceError because Function is now undefined
        expect(error).toBeInstanceOf(ReferenceError);
        expect(error?.message).toContain("not defined");
      });

      it("should allow Object.defineProperty to shadow blocked globals (known limitation)", async () => {
        // KNOWN LIMITATION: Object.defineProperty can replace our proxy with
        // a custom function. Primary sandboxing should prevent this.
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let result: string | undefined;
        await handle.run(async () => {
          // Replace Function with attacker's version (factory pattern)
          Object.defineProperty(globalThis, "Function", {
            value: () => () => "shadowed",
            writable: true,
            configurable: true,
          });

          // Use the shadowed version as a factory
          // Note: can't use `new` since arrow functions aren't constructors
          const fn = Function();
          result = (fn as () => string)();
        });

        handle.deactivate();

        // This succeeds - defineProperty bypasses our protection
        expect(result).toBe("shadowed");
      });
    });

    describe("prototype chain manipulation", () => {
      it("should block attempts to access Function via Object.getPrototypeOf chain", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Navigate prototype chain to find Function
            const fn = () => {};
            const fnProto = Object.getPrototypeOf(fn);
            const Fn = fnProto.constructor;
            Fn("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });

      it("should block attempts to access Function via __proto__", async () => {
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        let error: Error | undefined;
        await handle.run(async () => {
          try {
            // Use __proto__ to access Function
            const fn = () => {};
            const Fn = (
              fn as unknown as { __proto__: { constructor: typeof Function } }
            ).__proto__.constructor;
            Fn("return 1");
          } catch (e) {
            error = e as Error;
          }
        });

        handle.deactivate();

        expect(error).toBeInstanceOf(SecurityViolationError);
      });
    });
  });
});
