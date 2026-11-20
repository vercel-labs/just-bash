import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * These tests run the real defense modules under an actual Bun runtime,
 * rather than emulating Bun's accessor shape on Node.
 *
 * That distinction matters: Bun's `Module._load` / `Module._resolveFilename`
 * accessors are backed by a private native override slot that `require()`
 * consults directly - the JS-visible getter is not the only reader. A patch
 * that only swaps in its own get/set closures (never touching the real
 * setter) can report a fully successful, verified install while the native
 * loader keeps calling the unwrapped original - `require("child_process")`
 * from sandboxed code sails straight through. A synthetic accessor pair
 * built out of a plain closure variable (as `module-accessor-descriptors.
 * test.ts` uses to run on Node) cannot reproduce that private-slot behavior,
 * so it can't catch this regression either. Only real Bun can.
 */

let bunAvailable = false;
try {
  execFileSync("bun", ["--version"], { stdio: "ignore" });
  bunAvailable = true;
} catch {
  bunAvailable = false;
}

function runBun(script: string): string {
  return execFileSync("bun", ["-e", script], {
    encoding: "utf8",
    timeout: 30000,
    cwd: new URL("../../", import.meta.url).pathname,
  });
}

describe.skipIf(!bunAvailable)(
  "module accessor descriptors on real Bun",
  () => {
    it("blocks require() through the main-thread box and fully restores on teardown", () => {
      const source = new URL("./defense-in-depth-box.ts", import.meta.url).href;
      const script = `
      const assert = require("node:assert/strict");
      const api = await import(${JSON.stringify(source)});
      const box = api.DefenseInDepthBox.getInstance(true);
      assert.deepEqual(box.getPatchFailures(), []);
      const handle = box.activate();

      let violationType = null;
      await handle.run(async () => {
        // Exercise the native accessor dispatch independently of _load.
        assert.throws(() => require.resolve("node:path"),
          (error) => error.violation?.type === "module_resolve_filename");
        try {
          require("child_process");
          throw new Error("require('child_process') was not blocked");
        } catch (e) {
          violationType = e.violation?.type;
        }
      });
      assert.ok(
        violationType === "module_load" || violationType === "module_resolve_filename",
        "expected a module load/resolve violation, got: " + violationType,
      );

      handle.deactivate();

      // Teardown must fully lift protection - no leaked wrapper layers.
      const cp = require("child_process");
      assert.equal(typeof cp.exec, "function");
      process.stdout.write("ok");
    `;
      expect(runBun(script)).toBe("ok");
    });

    it("blocks require() through the worker box and fully restores on teardown", () => {
      const source = new URL("./worker-defense-in-depth.ts", import.meta.url)
        .href;
      const script = `
      const assert = require("node:assert/strict");
      const api = await import(${JSON.stringify(source)});
      const box = new api.WorkerDefenseInDepth({});
      assert.throws(() => require.resolve("node:path"),
        (error) => error.violation?.type === "module_resolve_filename");

      let violationType = null;
      try {
        require("child_process");
        throw new Error("require('child_process') was not blocked");
      } catch (e) {
        violationType = e.violation?.type;
      }
      assert.ok(
        violationType === "module_load" || violationType === "module_resolve_filename",
        "expected a module load/resolve violation, got: " + violationType,
      );

      box.deactivate();

      const cp = require("child_process");
      assert.equal(typeof cp.exec, "function");
      process.stdout.write("ok");
    `;
      expect(runBun(script)).toBe("ok");
    });

    it("forwards a reassignment through the real setter in audit mode, without leaking past teardown", () => {
      const source = new URL("./defense-in-depth-box.ts", import.meta.url).href;
      const script = `
      const assert = require("node:assert/strict");
      const api = await import(${JSON.stringify(source)});
      const box = api.DefenseInDepthBox.getInstance({ enabled: true, auditMode: true });
      const handle = box.activate();

      const Module = require("module").Module;
      const originalResolve = Module._resolveFilename;
      let calls = 0;
      const replacement = function (...args) {
        calls++;
        return originalResolve.apply(this, args);
      };

      await handle.run(async () => {
        Module._resolveFilename = replacement;
        require.resolve("node:path");
      });
      assert.ok(calls > 0, "reassignment during audit mode never reached require()'s dispatch");

      handle.deactivate();

      calls = 0;
      require.resolve("node:fs");
      assert.equal(calls, 0, "the deactivated replacement is still intercepting resolution");
      process.stdout.write("ok");
    `;
      expect(runBun(script)).toBe("ok");
    });
  },
);
