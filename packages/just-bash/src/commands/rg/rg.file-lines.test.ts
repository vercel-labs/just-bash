import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg incremental file matching", () => {
  it("does not match the rest of a file after head closes", async () => {
    const bash = new Bash({
      files: { "/in": "match\n".repeat(10000) },
      executionLimits: { maxLoopIterations: 1000 },
    });
    expect(await bash.exec("rg -n match /in | head -n 1")).toMatchObject({
      stdout: "1:match\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it.each([
    "-n",
    "-nv",
    "-n -i",
    "-n -e '^$' -e match",
  ])("preserves complete output for %s", async (flags) => {
    const files = { "/a": "match\n\nMATCH é\r\nlast", "/b": "\nmatch\n" };
    const expected = await new Bash({ files }).exec(`rg ${flags} match /a /b`);
    const actual = await new Bash({ files }).exec(
      `set -o pipefail; rg ${flags} match /a /b | cat`,
    );
    expect(actual).toMatchObject({
      stdout: expected.stdout,
      stderr: expected.stderr,
      exitCode: expected.exitCode,
    });
  });

  it("fully consumes a file past the periodic yield with defense enabled", async () => {
    const bash = new Bash({ files: { "/in": "match\n".repeat(80) } });
    expect(
      await bash.exec("rg --no-line-number match /in | cat"),
    ).toMatchObject({
      stdout: "match\n".repeat(80),
      stderr: "",
      exitCode: 0,
    });
  });
});
