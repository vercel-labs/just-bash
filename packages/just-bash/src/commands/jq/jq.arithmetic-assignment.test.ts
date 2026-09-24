import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq arithmetic assignment", () => {
  it.each([
    ["{}", '.arr += ["a"]', '{"arr":["a"]}'],
    ['{"arr":["a","b","c"]}', '.arr -= ["b"]', '{"arr":["a","c"]}'],
    ['{"arr":["b","a","b","c"]}', '.arr -= ["b"]', '{"arr":["a","c"]}'],
    [
      '{"arr":[1,"1",null,[1],{"x":1}]}',
      '.arr -= [1,null,[1],{"x":1}]',
      '{"arr":["1"]}',
    ],
    [
      '{"arr":[1,2,3],"remove":[2]}',
      ".arr -= .remove",
      '{"arr":[1,3],"remove":[2]}',
    ],
    ['{"arr":[1,2]}', ".arr -= []", '{"arr":[1,2]}'],
    ['{"n":8}', ".n -= 3", '{"n":5}'],
    ['{"value":[1]}', ".value += null", '{"value":[1]}'],
    ['{"value":"ab"}', ".value *= 3", '{"value":"ababab"}'],
    [
      '{"value":{"a":{"b":1}}}',
      '.value *= {"a":{"c":2}}',
      '{"value":{"a":{"b":1,"c":2}}}',
    ],
    ['{"value":"a,b,c"}', '.value /= ","', '{"value":["a","b","c"]}'],
    ['{"value":8}', ".value %= 3", '{"value":2}'],
  ])("%s | %s", async (input, filter, output) => {
    const env = new Bash({ files: { "/input.json": input } });
    const result = await env.exec(`jq -c '${filter}' /input.json`);
    expect(result.stdout).toBe(`${output}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each(["/=", "%="])("%s preserves division-by-zero errors", async (op) => {
    const env = new Bash();
    const result = await env.exec(`echo 8 | jq '. ${op} 0'`);
    expect(result.stdout).toBe("");
    const operation = op === "%=" ? "divided (remainder)" : "divided";
    expect(result.stderr).toBe(
      `jq: parse error: number (8) and number (0) cannot be ${operation} because the divisor is zero\n`,
    );
    expect(result.exitCode).toBe(5);
  });
});
