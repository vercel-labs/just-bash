// Automa modifications: N00b fromjson, Unicode and strict-shell regression coverage.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import fixtures from "./automa-json-fixtures.json";

describe("JSON value and Unicode boundaries", () => {
  for (const fixture of fixtures.cases) {
    it(`${fixture.command} with ${fixture.input}`, async () => {
      const result = await new Bash().exec(fixture.command, {
        stdin: fixture.input,
      });
      expect({
        stdout: result.stdout,
        exitCode: result.exitCode,
        hasError: !!result.stderr,
      }).toEqual(fixture.expected);
    });
  }
  it.each([
    '"1"\nnull\n"2"\n',
    'null\n"2"\n',
    '"1"\n"not json"\n"2"\n',
  ])("publishes no buffered output on uncaught stream failure: %s", async (stdin) => {
    const result = await new Bash().exec("jq -c fromjson", { stdin });
    expect(result.exitCode).toBe(5);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
  });
  it("retains valid streams, caught errors and strict-shell writes", async () => {
    const shell = new Bash({ cwd: "/workspace" });
    const valid = await shell.exec("jq -c fromjson", { stdin: '"1"\n"2"\n' });
    expect(valid.stdout).toBe("1\n2\n");
    const caught = await shell.exec(`jq -c 'try fromjson catch "TYPE_ERROR"'`, {
      stdin: '"1"\nnull\n"2"\n',
    });
    expect(caught.stdout).toBe('1\n"TYPE_ERROR"\n2\n');
    const result = await shell.exec(
      `set -euo pipefail; printf 'before\\n' > before.txt; printf null | jq -c fromjson > parsed.json; printf UNREACHED > after.txt`,
    );
    expect(result.exitCode).toBe(5);
    expect(await shell.fs.readFile("/workspace/before.txt")).toBe("before\n");
    expect(await shell.fs.readFile("/workspace/parsed.json")).toBe("");
    expect(await shell.fs.exists("/workspace/after.txt")).toBe(false);
  });
  it.each([
    ["jq -c fromjson", JSON.stringify("[1,2,3]"), { maxQueryElements: 2 }],
    [
      "jq -c fromjson",
      JSON.stringify('{"long_key":"long_value"}'),
      { maxOutputSize: 4 },
    ],
    [String.raw`jq -nc '"\u0041"'`, "", { maxQueryTokens: 4 }],
    [String.raw`jq -nc '[[["\u0041"]]]'`, "", { maxQueryDepth: 1 }],
    [String.raw`jq -nc '"\u0041\u0042\u0043\u0044"'`, "", { maxOutputSize: 4 }],
  ])("retains parser/allocation/output limits: %s", async (command, stdin, executionLimits) => {
    const result = await new Bash({ executionLimits }).exec(command, { stdin });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/limit|exceed|too large/i);
  });
});
