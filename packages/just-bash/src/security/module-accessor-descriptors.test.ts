import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const tsxLoaderUrl = import.meta.resolve("tsx");

function run(body: string): string {
  return execFileSync(
    process.execPath,
    ["--import", tsxLoaderUrl, "--input-type=module", "--eval", body],
    { encoding: "utf8", timeout: 30000 },
  );
}

function setupAccessors(setter: boolean): string {
  return `
    const originals = new Map();
    const setterCalls = new Map();
    for (const prop of ["_load", "_resolveFilename"]) {
      let value = Module[prop];
      setterCalls.set(prop, 0);
      Object.defineProperty(Module, prop, {
        configurable: true,
        enumerable: true,
        get: () => value,
        set: ${
          setter
            ? "(next) => { setterCalls.set(prop, setterCalls.get(prop) + 1); value = next; }"
            : "undefined"
        },
      });
      originals.set(prop, Object.getOwnPropertyDescriptor(Module, prop));
    }
  `;
}

// Use a subprocess: worker protection deliberately freezes process intrinsics.
// Emulate Bun's descriptors on Node so this regression runs in ordinary CI.
// NOTE: this emulation is necessarily a *plain* get/set closure pair, so it
// cannot reproduce Bun's private native override slot (see
// module-accessor-descriptors.bun.test.ts, which runs the same code against
// a real Bun runtime and is what actually caught the "installs successfully
// but require() bypasses it" regression this file's own assertions once
// missed).
describe("module accessor descriptors", () => {
  for (const worker of [false, true]) {
    it(`fails closed when the accessor has no setter to install protection through (worker=${worker})`, () => {
      const source = new URL(
        worker ? "./worker-defense-in-depth.ts" : "./defense-in-depth-box.ts",
        import.meta.url,
      ).href;
      const body = `
        import assert from "node:assert/strict";
        import { Module } from "node:module";
        const api = await import(${JSON.stringify(source)});
        ${setupAccessors(false)}
        assert.throws(
          () => ${worker ? "new api.WorkerDefenseInDepth({})" : "api.DefenseInDepthBox.getInstance(true).activate()"},
          /critical patches failed/,
        );
        // A patch we can't enforce must never be reported as installed: the
        // property must be left exactly as it was found.
        for (const [prop, original] of originals) {
          const current = Object.getOwnPropertyDescriptor(Module, prop);
          assert.equal(current.get, original.get);
          assert.equal(current.set, original.set);
        }
        process.stdout.write("ok");
      `;
      expect(run(body)).toBe("ok");
    });

    it(`blocks calls, rejects mutation, and restores the accessor on teardown (worker=${worker})`, () => {
      const source = new URL(
        worker ? "./worker-defense-in-depth.ts" : "./defense-in-depth-box.ts",
        import.meta.url,
      ).href;
      const body = `
          import assert from "node:assert/strict";
          import { Module } from "node:module";
          const api = await import(${JSON.stringify(source)});
          ${setupAccessors(true)}
          const box = ${worker ? "new api.WorkerDefenseInDepth({})" : "api.DefenseInDepthBox.getInstance(true)"};
          const handle = ${worker ? "null" : "box.activate()"};
          const errors = [];
          const descriptors = [];
          const replacement = function replacement() {};
          const probe = async () => {
            for (const prop of ["_load", "_resolveFilename"]) {
              descriptors.push(Object.getOwnPropertyDescriptor(Module, prop));
              try { Module[prop]("node:child_process"); }
              catch (error) { errors.push(error.violation?.type); }
              // Mutating the protected slot must fail exactly like it would
              // without protection (never silently accepted, and never
              // routed to the host's setter while blocked).
              assert.throws(() => { Module[prop] = replacement; });
            }
          };
          try {
            ${worker ? "await probe();" : "await handle.run(probe);"}
          } finally {
            ${worker ? "box.deactivate();" : "handle.deactivate();"}
          }
          assert.deepEqual(errors, ["module_load", "module_resolve_filename"]);
          for (const descriptor of descriptors) {
            assert.equal("get" in descriptor, true);
            assert.equal(typeof descriptor.get(), "function");
            assert.equal(descriptor.configurable, true);
            assert.equal(descriptor.enumerable, true);
            assert.equal("value" in descriptor, false);
          }
          for (const [prop, original] of originals) {
            const restored = Object.getOwnPropertyDescriptor(Module, prop);
            assert.equal(restored.get, original.get);
            assert.equal(restored.set, original.set);
            assert.equal(restored.configurable, original.configurable);
            assert.equal(restored.enumerable, original.enumerable);
            // The real setter is called exactly twice across the whole
            // lifecycle: once to install the guarded proxy, and once during
            // teardown to reset the runtime's own override slot back to the
            // original. The blocked mutation attempts in between must never
            // reach it - that's the property under test here.
            assert.equal(setterCalls.get(prop), 2);
          }
          process.stdout.write("ok");
        `;
      expect(run(body)).toBe("ok");
    });

    it(`forwards a reassignment through the real setter in audit mode, discarding it on teardown like other reversible patches (worker=${worker})`, () => {
      const source = new URL(
        worker ? "./worker-defense-in-depth.ts" : "./defense-in-depth-box.ts",
        import.meta.url,
      ).href;
      const body = `
            import assert from "node:assert/strict";
            import { Module } from "node:module";
            const api = await import(${JSON.stringify(source)});
            ${setupAccessors(true)}
            const originalValues = new Map(
              [...originals].map(([prop, d]) => [prop, d.get()]),
            );
            const box = ${
              worker
                ? "new api.WorkerDefenseInDepth({ auditMode: true })"
                : "api.DefenseInDepthBox.getInstance({ enabled: true, auditMode: true })"
            };
            const handle = ${worker ? "null" : "box.activate()"};
            const replacements = new Map([
              ["_load", function replacementLoad() {}],
              ["_resolveFilename", function replacementResolveFilename() {}],
            ]);
            const probe = async () => {
              for (const prop of ["_load", "_resolveFilename"]) {
                const replacement = replacements.get(prop);
                // Reassigning through the accessor while active must reach
                // the host's real setter (its side effects are preserved),
                // not be silently swallowed by a collapsed data slot.
                Module[prop] = replacement;
                // 1 call from install, 1 from this reassignment.
                assert.equal(setterCalls.get(prop), 2);
                // The new value must still be protected while active, and
                // must be readable as itself immediately (read-your-own-write
                // within the activation window).
                assert.notEqual(Module[prop], replacement);
                assert.equal(typeof Module[prop], "function");
              }
            };
            try {
              ${worker ? "await probe();" : "await handle.run(probe);"}
            } finally {
              ${worker ? "box.deactivate();" : "handle.deactivate();"}
            }
            for (const [prop, original] of originals) {
              const restored = Object.getOwnPropertyDescriptor(Module, prop);
              assert.equal(restored.get, original.get);
              assert.equal(restored.set, original.set);
              // Like every other reversible patch in this box (e.g.
              // protectProcessExecPath), a write that happens *during* the
              // activation window is scoped to that window: teardown
              // restores the pre-activation value exactly, discarding it -
              // it must not leak the replacement (or a wrapper around it)
              // past deactivation.
              assert.equal(Module[prop], originalValues.get(prop));
            }
            process.stdout.write("ok");
          `;
      expect(run(body)).toBe("ok");
    });
  }
});
