import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Defense Dynamic Import Builtin Probes", () => {
  async function runProbe(script: string): Promise<void> {
    try {
      await execFileAsync(
        process.execPath,
        ["--input-type=commonjs", "-e", script],
        {
          cwd: process.cwd(),
          timeout: 10000,
        },
      );
    } catch (error) {
      const err = error as { stderr?: string; message?: string };
      const output = `${err.stderr ?? ""}\n${err.message ?? ""}`;
      if (
        output.includes("./dist/security/defense-in-depth-box.js") &&
        output.includes("Cannot find module")
      ) {
        // test:run does not build dist first; skip in that case.
        console.warn(
          "[WARN] dynamic import builtin probe skipped — dist not built",
        );
        return;
      }
      throw error;
    }
  }

  it("allows dynamic import of node builtins in trusted context", async () => {
    const script = `
      (async () => {
        const mod = require("node:module");
        if (typeof mod.registerHooks !== "function") return;

        const { DefenseInDepthBox } = require("./dist/security/defense-in-depth-box.js");
        DefenseInDepthBox.resetInstance();
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        try {
          await handle.run(async () => {
            await DefenseInDepthBox.runTrustedAsync(async () => {
              const fsModule = await import("node:fs");
              await import("fs/promises");
              if (typeof fsModule.writeFileSync !== "function") {
                throw new Error("trusted dynamic import returned unexpected fs module");
              }
            });
          });
        } finally {
          handle.deactivate();
          DefenseInDepthBox.resetInstance();
        }
      })().catch((error) => {
        console.error(error?.stack ?? error?.message ?? String(error));
        process.exit(1);
      });
    `;

    await expect(runProbe(script)).resolves.toBeUndefined();
  });

  it("blocks dynamic import of node:* and bare builtins in untrusted defense context", async () => {
    const script = `
      (async () => {
        const mod = require("node:module");
        if (typeof mod.registerHooks !== "function") return;

        const { DefenseInDepthBox } = require("./dist/security/defense-in-depth-box.js");
        DefenseInDepthBox.resetInstance();
        const box = DefenseInDepthBox.getInstance(true);
        const handle = box.activate();

        try {
          await handle.run(async () => {
            for (const specifier of ["node:fs", "fs", "fs/promises"]) {
              let blocked = false;
              try {
                await import(specifier);
              } catch (error) {
                const message = error?.message ?? String(error);
                blocked =
                  message.includes("dynamic import of Node.js builtin") &&
                  message.includes("blocked during script execution");
              }
              if (!blocked) {
                throw new Error("expected dynamic import block for " + specifier);
              }
            }
          });
        } finally {
          handle.deactivate();
          DefenseInDepthBox.resetInstance();
        }
      })().catch((error) => {
        console.error(error?.stack ?? error?.message ?? String(error));
        process.exit(1);
      });
    `;

    await expect(runProbe(script)).resolves.toBeUndefined();
  });
});
