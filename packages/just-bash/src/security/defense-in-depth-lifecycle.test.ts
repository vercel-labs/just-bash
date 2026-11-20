import { execFileSync } from "node:child_process";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "./defense-in-depth-box.js";

const tsxLoaderUrl = import.meta.resolve("tsx");
const nativeSetImmediate = globalThis.setImmediate;

const processListenerMethods = [
  "on",
  "once",
  "addListener",
  "prependListener",
  "prependOnceListener",
] as const;

describe.runIf(typeof nodeModule.registerHooks === "function")(
  "defense-in-depth lifecycle",
  () => {
    beforeEach(() => DefenseInDepthBox.resetInstance());
    afterEach(() => DefenseInDepthBox.resetInstance());

    it("blocks every process listener registration variant without leaks", async () => {
      const baseline = process.listenerCount("beforeExit");
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();
      const errors: unknown[] = [];

      await handle.run(async () => {
        for (const method of processListenerMethods) {
          try {
            process[method]("beforeExit", () => {});
          } catch (error) {
            errors.push(error);
          }
        }
      });
      handle.deactivate();

      expect(errors).toHaveLength(processListenerMethods.length);
      expect(
        errors.every((error) => error instanceof SecurityViolationError),
      ).toBe(true);
      expect(process.listenerCount("beforeExit")).toBe(baseline);
    });

    it("restores descriptors and intrinsic extensibility", () => {
      const targets = [
        [globalThis, "Reflect"],
        [globalThis, "JSON"],
        [globalThis, "Math"],
        [Error, "stackTraceLimit"],
      ] as const;
      const before = targets.map(([target, key]) => ({
        descriptor: Object.getOwnPropertyDescriptor(target, key),
        extensible: Object.isExtensible(target),
      }));

      const handle = DefenseInDepthBox.getInstance(true).activate();
      handle.deactivate();

      const after = targets.map(([target, key]) => ({
        descriptor: Object.getOwnPropertyDescriptor(target, key),
        extensible: Object.isExtensible(target),
      }));
      expect(after).toEqual(before);
      expect(Object.isFrozen(Reflect)).toBe(false);
      expect(Object.isFrozen(JSON)).toBe(false);
      expect(Object.isFrozen(Math)).toBe(false);
    });

    it("does not use an inherited originating execution ID", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();
      let inheritedReads = 0;
      try {
        await handle.run(async () => {
          Object.defineProperty(Object.prototype, "originatingExecutionId", {
            configurable: true,
            get() {
              inheritedReads++;
              return "forged";
            },
          });
          try {
            // @banned-pattern-ignore: verify attribution of a blocked operation
            new Function("return 1")();
          } catch {
            // The blocked operation records a violation.
          }
          await DefenseInDepthBox.runInOwnExecution(async () => {
            try {
              // @banned-pattern-ignore: verify attribution of a child violation
              new Function("return 1")();
            } catch {
              // The blocked operation records a violation.
            }
          });
        });
      } finally {
        Reflect.deleteProperty(Object.prototype, "originatingExecutionId");
        handle.deactivate();
      }

      expect(box.getStats().violations.map((v) => v.executionId)).toEqual([
        handle.executionId,
        handle.executionId,
      ]);
      expect(inheritedReads).toBe(0);
    });

    it("releases the child handle if its context cannot be created", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();
      let caught: unknown;
      const internals = box as unknown as {
        getCachedContext(id: string, origin?: string): unknown;
      };
      const original = internals.getCachedContext.bind(box);
      const spy = vi
        .spyOn(internals, "getCachedContext")
        .mockImplementation((id, origin) => {
          if (id !== handle.executionId)
            throw new Error("context setup failed");
          return original(id, origin);
        });
      try {
        await handle.run(async () => {
          try {
            await DefenseInDepthBox.runInOwnExecution(async () => {});
          } catch (error) {
            caught = error;
          }
        });
      } finally {
        spy.mockRestore();
        handle.deactivate();
      }

      expect(caught).toEqual(new Error("context setup failed"));
      expect(box.getStats().refCount).toBe(0);
      expect(box.isActive()).toBe(false);
    });

    it("attributes callbacks registered after a child ends to the originating execution", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();
      let childId: string | undefined;
      let parentId: string | undefined;
      let callbackRan = false;
      let finished!: () => void;
      const lateCallback = new Promise<void>((resolve) => {
        finished = resolve;
      });
      try {
        await handle.run(async () => {
          await DefenseInDepthBox.runInOwnExecution(async () => {
            parentId = DefenseInDepthBox.getCurrentExecutionId();
            await DefenseInDepthBox.runInOwnExecution(async () => {
              childId = DefenseInDepthBox.getCurrentExecutionId();
              nativeSetImmediate(() => {
                void Promise.resolve().then(() => {
                  callbackRan = true;
                });
                nativeSetImmediate(finished);
              });
            });
          });
        });
        await lateCallback;
      } finally {
        handle.deactivate();
      }

      expect(childId).toBeDefined();
      expect(parentId).toBeDefined();
      expect(parentId).not.toBe(handle.executionId);
      expect(childId).not.toBe(parentId);
      expect(childId).not.toBe(handle.executionId);
      expect(callbackRan).toBe(false);
      expect(box.getStats().violations).toContainEqual(
        expect.objectContaining({
          type: "promise_then_after_deactivate",
          executionId: handle.executionId,
        }),
      );
      const cache = (box as unknown as { contextCache: Map<string, unknown> })
        .contextCache;
      expect(cache.size).toBe(0);
    });

    it("attributes a bound child callback invoked after it ends", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();
      let callback!: () => void;
      let ran = false;
      try {
        await handle.run(async () => {
          await DefenseInDepthBox.runInOwnExecution(async () => {
            callback = DefenseInDepthBox.bindCurrentContext(() => {
              ran = true;
            });
          });
        });
        callback();
      } finally {
        handle.deactivate();
      }

      expect(ran).toBe(false);
      expect(box.getStats().violations).toContainEqual(
        expect.objectContaining({
          type: "bound_callback_after_deactivate",
          executionId: handle.executionId,
        }),
      );
    });
  },
);

describe.runIf(typeof nodeModule.registerHooks === "function")(
  "defense-in-depth Module discovery",
  () => {
    const sourceUrl = pathToFileURL(
      new URL("./defense-in-depth-box.ts", import.meta.url).pathname,
    ).href;

    function runSubprocess(inputType: "module" | "commonjs", body: string) {
      return execFileSync(
        process.execPath,
        ["--import", tsxLoaderUrl, `--input-type=${inputType}`, "--eval", body],
        { encoding: "utf8" },
      ).trim();
    }

    it.each([
      "module",
      "commonjs",
    ] as const)("patches and restores Module methods from a pure-%s entrypoint", (inputType) => {
      const loadModule =
        inputType === "module"
          ? 'const { Module } = await import("node:module");'
          : 'const { Module } = require("node:module");';
      const body = `(async () => {
        ${loadModule}
        const originalLoad = Module._load;
        const originalResolve = Module._resolveFilename;
        const { DefenseInDepthBox } = await import(${JSON.stringify(sourceUrl)});
        DefenseInDepthBox.resetInstance();
        const handle = DefenseInDepthBox.getInstance(true).activate();
        if (Module._load === originalLoad || Module._resolveFilename === originalResolve) throw new Error("not patched");
        let blocked = false;
        await handle.run(async () => { try { Module._load("node:fs"); } catch { blocked = true; } });
        handle.deactivate();
        if (!blocked || Module._load !== originalLoad || Module._resolveFilename !== originalResolve) throw new Error("lifecycle failure");
        process.stdout.write("ok");
      })().catch((error) => { console.error(error); process.exitCode = 1; });`;

      expect(runSubprocess(inputType, body)).toBe("ok");
    });

    it("fails closed when a critical Module method cannot be patched", () => {
      const body = `(async () => {
      const { Module } = await import("node:module");
      const current = Module._load;
      Object.defineProperty(Module, "_load", { value: current, writable: false, configurable: false });
      const { DefenseInDepthBox } = await import(${JSON.stringify(sourceUrl)});
      let failed = false;
      try { DefenseInDepthBox.getInstance(true).activate(); } catch (error) { failed = String(error).includes("Module._load"); }
      if (!failed) throw new Error("activation did not fail closed");
      process.stdout.write("ok");
    })().catch((error) => { console.error(error); process.exitCode = 1; });`;

      expect(runSubprocess("module", body)).toBe("ok");
    });

    it("rolls back worker patches when bootstrap activation fails", () => {
      const workerSourceUrl = pathToFileURL(
        new URL("./worker-defense-in-depth.ts", import.meta.url).pathname,
      ).href;
      const body = `(async () => {
      const { Module } = await import("node:module");
      const originalFunction = globalThis.Function;
      const originalEval = globalThis.eval;
      Object.defineProperty(Module, "_load", { value: Module._load, writable: false, configurable: false });
      const { WorkerDefenseInDepth } = await import(${JSON.stringify(workerSourceUrl)});
      let failed = false;
      try { new WorkerDefenseInDepth({}); } catch (error) { failed = String(error).includes("Module._load"); }
      if (!failed) throw new Error("activation did not fail closed");
      if (globalThis.Function !== originalFunction || globalThis.eval !== originalEval) throw new Error("partial patches leaked");
      if (Object.isFrozen(Math) || Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)?.configurable === false) throw new Error("irreversible locks applied before validation");
      process.stdout.write("ok");
    })().catch((error) => { console.error(error); process.exitCode = 1; });`;

      expect(runSubprocess("module", body)).toBe("ok");
    });
  },
);
