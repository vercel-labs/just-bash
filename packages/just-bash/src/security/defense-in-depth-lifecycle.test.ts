import { execFileSync } from "node:child_process";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "./defense-in-depth-box.js";

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
        ["--import", "tsx", `--input-type=${inputType}`, "--eval", body],
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
