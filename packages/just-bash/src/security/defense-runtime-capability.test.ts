import { execFileSync } from "node:child_process";
import * as nodeModule from "node:module";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const sourceUrl = pathToFileURL(
  new URL("./defense-in-depth-box.ts", import.meta.url).pathname,
).href;
const bashSourceUrl = pathToFileURL(
  new URL("../Bash.ts", import.meta.url).pathname,
).href;
function run(node: string, inputType: "module" | "commonjs", body: string) {
  return execFileSync(
    node,
    ["--import", "tsx", `--input-type=${inputType}`, "--eval", body],
    { cwd: process.cwd(), encoding: "utf8" },
  ).trim();
}

describe("defense runtime capability resolution", () => {
  const supportsContextualHooks =
    typeof (nodeModule as { registerHooks?: unknown }).registerHooks ===
    "function";

  it.each([
    "module",
    "commonjs",
  ] as const)("resolves and enforces the loader boundary from a %s host", (inputType) => {
    const body = `(async () => {
          const { DefenseInDepthBox } = await import(${JSON.stringify(sourceUrl)});
          DefenseInDepthBox.resetInstance();
          const automatic = DefenseInDepthBox.getInstance({ enabled: "auto" });
          const status = automatic.getStatus();
          if (status.state !== ${JSON.stringify(supportsContextualHooks ? "enabled" : "unsupported")}) {
            throw new Error("unexpected auto status: " + JSON.stringify(status));
          }
          const autoHandle = automatic.activate();
          autoHandle.deactivate();
          const hostDataBefore = await import("data:text/javascript,export default 'host-before'");
          if (hostDataBefore.default !== "host-before") throw new Error("host data import was blocked");
          DefenseInDepthBox.resetInstance();

          if (!${supportsContextualHooks}) {
            let rejected = false;
            try { DefenseInDepthBox.getInstance(true).activate(); }
            catch (error) {
              rejected = String(error).includes("context-aware ESM loader hooks") &&
                String(error).includes("unsupported");
            }
            if (!rejected) throw new Error("explicit activation did not fail closed");
            for (const specifier of ["node:fs", "fs", "fs/promises", "node:child_process", "node:vm"]) {
              await import(specifier);
            }
            DefenseInDepthBox.resetInstance();
            const { Bash } = await import(${JSON.stringify(bashSourceUrl)});
            const result = await new Bash().exec("echo compatible");
            if (result.exitCode !== 0 || result.stdout !== "compatible\\n") throw new Error("auto-mode Bash failed");
            process.stdout.write("ok");
            return;
          }

          const handle = DefenseInDepthBox.getInstance(true).activate();
          await handle.run(async () => {
            for (const specifier of ["node:fs", "fs", "fs/promises", "node:child_process", "node:vm"]) {
              let blocked = false;
              try { await import(specifier); }
              catch (error) { blocked = String(error).includes("dynamic import of Node.js builtin"); }
              if (!blocked) throw new Error("unblocked builtin: " + specifier);
            }
            let dataBlocked = false;
            try { await import("data:text/javascript,export default 'sandbox'"); }
            catch (error) { dataBlocked = String(error).includes("data: URLs is blocked"); }
            if (!dataBlocked) throw new Error("unblocked sandbox data import");
          });
          handle.deactivate();
          await import("node:fs");
          const hostDataAfter = await import("data:text/javascript,export default 'host-after'");
          if (hostDataAfter.default !== "host-after") throw new Error("post-deactivation data import was blocked");
          process.stdout.write("ok");
        })().catch((error) => { console.error(error); process.exitCode = 1; });`;

    expect(run(process.execPath, inputType, body)).toBe("ok");
  });

  it.runIf(supportsContextualHooks)(
    "restores actual host descriptors and leaves intrinsics extensible by default",
    () => {
      const body = `(async () => {
        const { DefenseInDepthBox } = await import(${JSON.stringify(sourceUrl)});
        const targets = [[globalThis, "Reflect"], [globalThis, "JSON"], [globalThis, "Math"]];
        const symbols = [[Array.prototype, Symbol.iterator], [Promise, Symbol.species]];
        const descriptors = targets.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
        const symbolDescriptors = symbols.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key));
        const extensible = targets.map(([target, key]) => Object.isExtensible(target[key]));
        const handle = DefenseInDepthBox.getInstance(true).activate();
        await handle.run(async () => {
          for (const name of ["Reflect", "JSON", "Math"]) {
            let blocked = false;
            try { globalThis[name].temporaryMutation = true; } catch { blocked = true; }
            if (!blocked) throw new Error(name + " mutation was not blocked");
          }
        });
        handle.deactivate();
        if (JSON.stringify(targets.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key))) !== JSON.stringify(descriptors)) throw new Error("global descriptors changed");
        if (JSON.stringify(symbols.map(([target, key]) => Object.getOwnPropertyDescriptor(target, key))) !== JSON.stringify(symbolDescriptors)) throw new Error("symbol descriptors changed");
        if (JSON.stringify(targets.map(([target, key]) => Object.isExtensible(target[key]))) !== JSON.stringify(extensible)) throw new Error("intrinsic extensibility changed");
        process.stdout.write("ok");
      })().catch((error) => { console.error(error); process.exitCode = 1; });`;
      expect(run(process.execPath, "module", body)).toBe("ok");
    },
  );

  it.runIf(supportsContextualHooks)(
    "requires explicit opt-in for irreversible process-lifetime locks",
    () => {
      const body = `(async () => {
        const { DefenseInDepthBox } = await import(${JSON.stringify(sourceUrl)});
        const handle = DefenseInDepthBox.getInstance({ enabled: true, processLifetimeIntrinsicHardening: true }).activate();
        handle.deactivate();
        if (!Object.isFrozen(Reflect) || !Object.isFrozen(JSON) || !Object.isFrozen(Math)) throw new Error("intrinsics were not frozen");
        if (Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)?.configurable !== false) throw new Error("symbol was not locked");
        process.stdout.write("ok");
      })().catch((error) => { console.error(error); process.exitCode = 1; });`;
      expect(run(process.execPath, "module", body)).toBe("ok");
    },
  );
});
