// Automa modifications: N00b regressions migrated from just-bash-options.test.mjs.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const create = () =>
  new Bash({
    cwd: "/",
    files: {
      "/f": "%PDF-1.7\ntail\n",
      "/a": "ab",
      "/b": "cdef",
      "/-N5": "bytes",
      "/binary": new Uint8Array([0, 128, 255, 80, 68]),
    },
  });
describe("Automa od read byte limit", () => {
  it.each([
    "-N 5",
    "-N5",
    "--read-bytes 5",
    "--read-bytes=5",
    "-N0x5",
    "-N+5",
    "-N9 -N5",
  ])("parses %s", async (flag) => {
    expect(await create().exec(`od -An -t x1 ${flag} /f`)).toMatchObject({
      stdout: " 25 50 44 46 2d\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it.each([
    ["od -An -t x1 -N0 /f", ""],
    ["od -An -t x1 -- -N5", " 62 79 74 65 73\n"],
    ["od -An -t x1 -N010 /f", " 25 50 44 46 2d 31 2e 37\n"],
    ["od -An -t x1 -N4 /a /b", " 61 62 63 64\n"],
    ["od -An -t x1 -N5 /binary missing", " 00 80 ff 50 44\n"],
    ["printf abc | od -An -t x1 -N2 -", " 61 62\n"],
  ])("preserves byte and operand semantics: %s", async (command, stdout) => {
    expect(await create().exec(command)).toMatchObject({
      stdout,
      stderr: "",
      exitCode: 0,
    });
  });
  it.each([
    "-N",
    "-N-1 /f",
    "-N bad /f",
    "-N0 missing",
    "-N08 /f",
  ])("fails visibly for %s", async (flags) => {
    const result = await create().exec(`od -An -t x1 ${flags}`);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
    expect(result.exitCode).not.toBe(0);
  });
  it("charges the original file input before slicing", async () => {
    const shell = new Bash({
      files: { "/f": "123456789" },
      executionLimits: { maxInputBytes: 4 },
    });
    const result = await shell.exec("od -An -t x1 -N1 /f");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/limit|exceeded|too large/i);
  });
});
