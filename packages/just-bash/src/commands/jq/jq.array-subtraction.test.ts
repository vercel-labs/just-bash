import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq structural array subtraction", () => {
  it.each([
    ['{"arr":[{"a":1,"b":2}]}', '.arr -= [{"b":2,"a":1}]', '{"arr":[]}'],
    [
      '[{"a":[{"x":1,"y":2}],"b":0}, {"b":0,"a":[{"y":2,"x":1}]}]',
      '. - [{"b":0,"a":[{"y":2,"x":1}]}]',
      "[]",
    ],
    ["[[1,2],[2,1],[1,2]]", ". - [[1,2]]", "[[2,1]]"],
    ['[1,"1",true,false,null,{},[]]', ". - [1,true,{},[]]", '["1",false,null]'],
    ['[{"a":1},{"b":1},{"a":2}]', '. - [{"b":1}]', '[{"a":1},{"a":2}]'],
    [
      '[{"toString":1,"valueOf":2,"hasOwnProperty":3}]',
      '. - [{"hasOwnProperty":3,"valueOf":2,"toString":1}]',
      "[]",
    ],
    ['[{"é":1},{"é":1}]', '. - [{"é":1}]', '[{"é":1}]'],
    ["null", "[nan] - [null]", "[null]"],
    ["null", "[nan] - [nan]", "[null]"],
  ])("%s | %s", async (input, filter, output) => {
    const env = new Bash({ files: { "/input.json": input } });
    const result = await env.exec(`jq -c '${filter}' /input.json`);
    expect(result.stdout).toBe(`${output}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
