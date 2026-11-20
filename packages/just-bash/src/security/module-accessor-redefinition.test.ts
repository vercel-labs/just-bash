import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const tsxLoaderUrl = import.meta.resolve("tsx");

describe("module accessor host setter side effects", () => {
  for (const worker of [false, true]) {
    for (const scenario of [
      "redefine",
      "throw-install",
      "throw-write",
      "ignore-install",
      "ignore-write",
    ]) {
      it(`preserves protection and rollback after ${scenario} (worker=${worker})`, () => {
        const source = new URL(
          worker ? "./worker-defense-in-depth.ts" : "./defense-in-depth-box.ts",
          import.meta.url,
        ).href;
        const script = `
          import assert from "node:assert/strict";
          import { Module } from "node:module";
          const api = await import(${JSON.stringify(source)});
          const scenario = ${JSON.stringify(scenario)};
          const originals = new Map();
          const slots = new Map();
          for (const prop of ["_load", "_resolveFilename"]) {
            const original = Module[prop];
            let calls = 0;
            slots.set(prop, original);
            Object.defineProperty(Module, prop, {
              configurable: true,
              enumerable: true,
              get() { return slots.get(prop); },
              set(next) {
                calls++;
                if (scenario === "ignore-install" ||
                    (scenario === "ignore-write" && calls === 2)) return;
                slots.set(prop, next);
                Object.defineProperty(Module, prop, {
                  configurable: true, enumerable: true, writable: true, value: next,
                });
                if ((scenario === "throw-install" && calls === 1) ||
                    (scenario === "throw-write" && calls === 2)) {
                  throw new Error("host setter failed after mutation");
                }
              },
            });
            originals.set(prop, { value: original, descriptor: Object.getOwnPropertyDescriptor(Module, prop) });
          }
          const activate = () => {
            const box = ${
              worker
                ? "new api.WorkerDefenseInDepth({ auditMode: true })"
                : "api.DefenseInDepthBox.getInstance(true)"
            };
            return ${worker ? "box" : "box.activate()"};
          };
          if (scenario === "throw-install" || scenario === "ignore-install") {
            assert.throws(activate, /critical patches failed/);
          } else {
            const handle = activate();
            try {
              for (const prop of ["_load", "_resolveFilename"]) {
                const guard = Object.getOwnPropertyDescriptor(Module, prop);
                const previous = slots.get(prop);
                const replacement = () => "replacement";
                if (scenario === "throw-write" || scenario === "ignore-write") {
                  assert.throws(() => { Module[prop] = replacement; },
                    /host setter failed|accessor verification/);
                  assert.equal(slots.get(prop), previous);
                } else {
                  Module[prop] = replacement;
                  assert.notEqual(slots.get(prop), replacement);
                }
                const installed = Object.getOwnPropertyDescriptor(Module, prop);
                assert.equal(installed.get, guard.get);
                assert.equal(installed.set, guard.set);
                // A second write must still pass through the guard.
                Module[prop] = replacement;
                assert.notEqual(slots.get(prop), replacement);
                ${
                  worker
                    ? "const before = handle.getStats().violations.length; Module[prop](); assert.equal(handle.getStats().violations.length, before + 1);"
                    : "await handle.run(async () => { assert.throws(() => Module[prop](), /blocked/); assert.throws(() => { Module[prop] = replacement; }, /blocked/); });"
                }
              }
            } finally {
              handle.deactivate();
            }
          }
          for (const [prop, original] of originals) {
            assert.equal(slots.get(prop), original.value);
            assert.deepEqual(Object.getOwnPropertyDescriptor(Module, prop), original.descriptor);
          }
          process.stdout.write("ok");
        `;
        expect(
          execFileSync(
            process.execPath,
            ["--import", tsxLoaderUrl, "--input-type=module", "--eval", script],
            { encoding: "utf8", timeout: 30000 },
          ),
        ).toBe("ok");
      });
    }
  }
});
