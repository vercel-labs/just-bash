import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { defineCommand } from "../../custom-commands.js";
import type { ExecutionLimitProfile } from "../../limits.js";

const MiB = 1024 * 1024;
const allocate = (mib: number) =>
  `js-exec -c "try { console.log('x'.repeat(${mib} * 1024 * 1024).length) } catch (error) { console.error(error.message); process.exit(1) }"`;
const outOfMemory = { exitCode: 1, stderr: "out of memory\n", stdout: "" };

describe("js-exec maxJsMemoryBytes", () => {
  it.each<ExecutionLimitProfile>([
    "normal",
    "hardened",
  ])("keeps the 64 MiB heap by default (%s profile)", async (profile) => {
    const heapLimit = defineCommand("heap-limit", async (_args, ctx) => ({
      exitCode: 0,
      stderr: "",
      stdout: `${ctx.limits.maxJsMemoryBytes}\n`,
    }));
    const bash = new Bash({
      customCommands: [heapLimit],
      executionLimitProfile: profile,
      javascript: true,
    });

    expect(await bash.exec("heap-limit")).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: `${64 * MiB}\n`,
    });
    expect(await bash.exec(allocate(40))).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "41943040\n",
    });
    expect(await bash.exec(allocate(100))).toMatchObject(outOfMemory);
  });

  it("raises the heap", async () => {
    const bash = new Bash({
      executionLimits: { maxJsMemoryBytes: 256 * MiB },
      javascript: true,
    });

    expect(await bash.exec(allocate(100))).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "104857600\n",
    });
  });

  it("lowers the heap", async () => {
    const bash = new Bash({
      executionLimits: { maxJsMemoryBytes: 16 * MiB },
      javascript: true,
    });

    expect(await bash.exec(allocate(40))).toMatchObject(outOfMemory);
  });

  it.each([
    2_147_483_648,
    Number.POSITIVE_INFINITY,
  ])("lets a 100 MiB allocation succeed with %s", async (maxJsMemoryBytes) => {
    const bash = new Bash({
      executionLimits: { maxJsMemoryBytes },
      javascript: true,
    });

    expect(await bash.exec(allocate(100))).toMatchObject({
      exitCode: 0,
      stderr: "",
      stdout: "104857600\n",
    });
  });

  it.each([
    0,
    4 * MiB,
  ])("names the option when %s is smaller than the host bridge buffer", async (maxJsMemoryBytes) => {
    const bash = new Bash({
      executionLimits: { maxJsMemoryBytes },
      javascript: true,
    });

    expect(await bash.exec(`js-exec -c "console.log(1)"`)).toMatchObject({
      exitCode: 1,
      stderr: `js-exec: executionLimits.maxJsMemoryBytes (${maxJsMemoryBytes}) is smaller than the 8389664 byte host bridge buffer\n`,
      stdout: "",
    });
  });

  it("rejects values that are not a non-negative safe integer or Infinity", () => {
    for (const maxJsMemoryBytes of [-1, 1.5, Number.NaN]) {
      expect(() => new Bash({ executionLimits: { maxJsMemoryBytes } })).toThrow(
        new RangeError(
          "maxJsMemoryBytes must be a non-negative safe integer or positive Infinity",
        ),
      );
    }
  });
});
