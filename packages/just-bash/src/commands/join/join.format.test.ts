import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("join output fields", () => {
  it("preserves field-zero spelling with case-insensitive matching", async () => {
    const bash = new Bash({
      files: { "/a": "Apple 1\n", "/b": "apple 2\nBanana 3\n" },
    });
    expect(
      await bash.exec("join -i -a 2 -e X -o '0,1.2,2.2' /a /b"),
    ).toMatchObject({
      stdout: "Apple 1 2\nBanana X 3\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([
    "0,1.2,2.2",
    "0 1.2 2.2",
    "0,1.2 2.2",
  ])("formats matched and unpaired rows with %s", async (format) => {
    const bash = new Bash({
      cwd: "/work",
      files: { "/work/a": "a 1\nb 2\n", "/work/b": "a X\nc Z\n" },
    });
    const result = await bash.exec(`join -a 1 -a 2 -e0 -o '${format}' a b`);
    expect(result).toMatchObject({
      stdout: "a 1 X\nb 2 0\nc 0 Z\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("uses the empty-field replacement for an empty join key", async () => {
    const bash = new Bash({ files: { "/a": ":left\n", "/b": ":right\n" } });
    expect(
      await bash.exec("join -t : -e X -o '0,1.2,2.2' /a /b"),
    ).toMatchObject({
      stdout: "X:left:right\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("uses the selected join key for field zero", async () => {
    const bash = new Bash({
      files: { "/a": "left key\n", "/b": "key right\n" },
    });
    const result = await bash.exec("join -1 2 -o '0,1.1,2.2' /a /b");
    expect(result).toMatchObject({
      stdout: "key left right\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it.each([
    "1.0",
    "2.0",
    "3.1",
    "0.1",
    "1.2,,2.2",
  ])("rejects invalid field specification %s", async (format) => {
    const result = await new Bash().exec(`join -o '${format}' /a /b`);
    expect(result).toMatchObject({
      stdout: "",
      stderr: `join: invalid field spec: '${format}'\n`,
      exitCode: 1,
    });
  });
});
