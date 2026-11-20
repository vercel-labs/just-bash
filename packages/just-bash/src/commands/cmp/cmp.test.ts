import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("cmp", () => {
  it("compares bytes and reports the first differing byte and line", async () => {
    const bash = new Bash({ files: { "/a": "a\nx", "/b": "a\ny" } });
    expect(await bash.exec("cmp /a /a")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.exec("cmp /a /b")).toMatchObject({
      stdout: "/a /b differ: byte 3, line 2\n",
      stderr: "",
      exitCode: 1,
    });
  });

  it("charges only compared bytes and bounds retained input", async () => {
    const files = { "/a": "a".repeat(5000), "/b": "b".repeat(5000) };
    expect(
      await new Bash({ files, executionLimits: { maxWorkUnits: 100 } }).exec(
        "cmp -s /a /b",
      ),
    ).toMatchObject({ stdout: "", stderr: "", exitCode: 1 });
    expect(
      await new Bash({ files, executionLimits: { maxLiveBytes: 4096 } }).exec(
        "cmp /a /b",
      ),
    ).toMatchObject({
      stdout: "",
      stderr: "bash: cmp: live byte limit exceeded (4096 bytes)\n",
      exitCode: 126,
    });
  });

  it("lists byte positions and octal values with -l", async () => {
    const bash = new Bash({
      files: {
        "/a": new Uint8Array([0, 255, 10, 0, 0, 0, 0, 0, 0, 0]),
        "/b": new Uint8Array([1, 254, 10, 0, 0, 0, 0, 0, 0, 0]),
      },
    });
    expect(await bash.exec("cmp -l /a /b")).toMatchObject({
      stdout: " 1   0   1\n 2 377 376\n",
      stderr: "",
      exitCode: 1,
    });
  });

  it("supports stdin, silent differences, and status 2 for missing files", async () => {
    const bash = new Bash({ files: { "/a": "same\n", "/b": "different\n" } });
    expect(await bash.exec("echo same | cmp /a -")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.exec("printf 'same\\nmore' | cmp /a -")).toMatchObject({
      stdout: "",
      stderr: "cmp: EOF on /a after byte 5, in line 2\n",
      exitCode: 1,
    });
    expect(await bash.exec("cmp -s /a /b")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
    expect(await bash.exec("cmp -sl /a /b")).toMatchObject({
      stdout: "",
      stderr: "cmp: options -l and -s are incompatible\n",
      exitCode: 2,
    });
    expect(await bash.exec("cmp -s /missing /a")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 2,
    });
    expect(await bash.exec("cmp /missing /a")).toMatchObject({
      stdout: "",
      stderr: "cmp: /missing: No such file or directory\n",
      exitCode: 2,
    });
  });
});
