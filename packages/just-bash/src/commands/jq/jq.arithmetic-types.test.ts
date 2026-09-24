import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq arithmetic operand types", () => {
  it.each([
    ["[1,2]", "-", "1", "array ([1,2]) and number (1) cannot be subtracted"],
    ['{"a":1}', "/", "2", 'object ({"a":1}) and number (2) cannot be divided'],
    [
      '"a"',
      "%",
      "3",
      'string ("a") and number (3) cannot be divided (remainder)',
    ],
    ["4", "+", '"x"', 'number (4) and string ("x") cannot be added'],
    ["[]", "*", "true", "array ([]) and boolean (true) cannot be multiplied"],
    ["null", "-", "1", "null (null) and number (1) cannot be subtracted"],
  ])("rejects %s %s %s in binary and assignment forms", async (left, op, right, error) => {
    for (const filter of [`.value ${op} ${right}`, `.value ${op}= ${right}`]) {
      const env = new Bash({ files: { "/input.json": `{"value":${left}}` } });
      const result = await env.exec(`jq -c '${filter}' /input.json`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`jq: parse error: ${error}\n`);
      expect(result.exitCode).toBe(5);
      const caught = await env.exec(
        `jq -c 'try (${filter}) catch .' /input.json`,
      );
      expect(caught.stdout).toBe(`${JSON.stringify(error)}\n`);
      expect(caught.stderr).toBe("");
      expect(caught.exitCode).toBe(0);
    }
  });

  it.each([
    ['"ab"', ". *= -1", "null"],
    ['"ab"', ". *= 0", '""'],
    ["2", '. *= "ab"', '"abab"'],
    ["-1", '. *= "ab"', "null"],
    ["null", ". += [1]", "[1]"],
    ["[1]", ". += null", "[1]"],
  ])("preserves valid %s | %s", async (input, filter, output) => {
    const env = new Bash({ files: { "/input.json": input } });
    const result = await env.exec(`jq -c '${filter}' /input.json`);
    expect(result.stdout).toBe(`${output}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
