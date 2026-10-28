import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq deletion paths", () => {
  it.each([
    ['{"a":1,"b":2,"c":3}', "del(.a,.b)", '{"c":3}\n'],
    ["[0,1,2,3]", "del(.[0],.[2],.[0])", "[1,3]\n"],
    ["[0,1,2,3]", "del(.[0],.[-2])", "[1,3]\n"],
    ["[0,1]", "del(.[-4],.[8])", "[0,1]\n"],
    ["[1,2,3]", "del(.[nan],.[1],.[1.5])", "[1,3]\n"],
    ['[{"a":1},[1,2]]', "del(.[][0]?)", '[{"a":1},[2]]\n'],
    ['[[1],{"a":1}]', "del(.[].a?)", "[[1],{}]\n"],
    ["[1,2,3]", "del(.[1.5] | select(. == 2))", "[1,3]\n"],
    ['[[1,2],{"a":1}]', "del(.[][0]?)", '[[2],{"a":1}]\n'],
    ['{"0":1}', "del(.[0]?)", '{"0":1}\n'],
    ['{"a":{"b":1,"c":2},"d":3}', "del(.a,.a.b)", '{"d":3}\n'],
    [
      '{"a":null,"b":[null,1,null],"c":{"d":null,"e":2}}',
      "del(..|nulls)",
      '{"b":[1],"c":{"e":2}}\n',
    ],
    ['[{"a":1,"b":2},{"a":3,"b":4}]', "del(.[].a)", '[{"b":2},{"b":4}]\n'],
    ['{"items":[1,2,3,4]}', "del(.items[]|select(.>1))", '{"items":[1]}\n'],
    ['{"a":1}', "del((.a,.a))", "{}\n"],
  ])("deletes %s using %s", async (input, filter, stdout) => {
    const bash = new Bash({ files: { "/input.json": input } });
    expect(await bash.exec(`jq -c '${filter}' /input.json`)).toMatchObject({
      stdout,
      stderr: "",
      exitCode: 0,
    });
  });

  it("rejects numeric object keys instead of deleting their string form", async () => {
    const bash = new Bash({ files: { "/input.json": '{"0":1}' } });
    const result = await bash.exec("jq 'del(.[0])' /input.json");
    expect(result.stdout).toBe("");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Cannot index object with number");
  });

  it("rejects value-producing expressions instead of deleting the root", async () => {
    const bash = new Bash({ files: { "/input.json": '{"a":1}' } });
    const result = await bash.exec("jq 'del(.a + 1)' /input.json");
    expect(result.stdout).toBe("");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unsupported path expression");
  });
});
