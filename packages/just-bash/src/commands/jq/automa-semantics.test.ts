// Automa modifications: N00b source regression coverage, recorded native jq fixtures.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import fixtures from "./automa-native-fixtures.json";

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

describe("Automa jq semantic migrations", () => {
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
    ['{"z":2,"a":1}', "map(.+1)", "[3,2]\n"],
    ['{"z":2,"a":1}', "keys", '["a","z"]\n'],
    ["[1,2]", "keys", "[0,1]\n"],
    ['{"z":2,"a":1}', "keys_unsorted", '["z","a"]\n'],
    ['[{"a":1,"b":2}]', '. - [{"b":2,"a":1}]', "[]\n"],
    ['{"a":[1,2,3]}', "(.a[] | select(.>1)) |= .+10", '{"a":[1,12,13]}\n'],
    [
      '{"x":{"a":1},"y":{"a":2}}',
      "(.[] | .a) |= .+1",
      '{"x":{"a":2},"y":{"a":3}}\n',
    ],
    ['"{\\"x\\":1}"', "fromjson", '{"x":1}\n'],
  ])("%s | %s", async (input, filter, stdout) => {
    const actual = await new Bash().exec(`jq -c ${quote(filter)}`, {
      stdin: input,
    });
    expect(actual).toMatchObject({ exitCode: 0, stdout, stderr: "" });
  });
  it.each([
    "null",
    "false",
    "1",
    '"text"',
  ])("rejects scalar keys/to_entries: %s", async (input) => {
    for (const filter of ["keys", "keys_unsorted", "to_entries"]) {
      const result = await new Bash().exec(`jq ${filter}`, { stdin: input });
      expect(result.exitCode).toBe(5);
      expect(result.stdout).toBe("");
    }
  });
  it.each([
    "null",
    "false",
    "1",
    "[]",
    "{}",
  ])("rejects non-string fromjson: %s", async (input) => {
    const result = await new Bash().exec("jq fromjson", { stdin: input });
    expect(result.exitCode).toBe(5);
    expect(result.stderr).toContain("only strings can be parsed");
    const caught = await new Bash().exec(
      `jq -c 'try fromjson catch "caught"'`,
      { stdin: input },
    );
    expect(caught.stdout).toBe('"caught"\n');
  });
  it.each([
    ["[1,2] | walk(.)", { maxQueryElements: 2 }],
    ["def walk($n): walk($n+1); walk(0)", { maxQueryDepth: 16 }],
    ["def f($x): $x; [f(range(0;8))]", { maxQueryElements: 4 }],
    ['def f($x): $x; f("abcdefghijklmnopqrstuvwxyz")', { maxOutputSize: 12 }],
  ])("retains bounded evaluation: %s", async (filter, executionLimits) => {
    const result = await new Bash({ executionLimits }).exec(
      `jq -nc ${quote(filter)}; printf SHOULD_NOT_RUN`,
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/limit|exceed|too many/i);
    expect(result.stdout).not.toContain("SHOULD_NOT_RUN");
  });
});
