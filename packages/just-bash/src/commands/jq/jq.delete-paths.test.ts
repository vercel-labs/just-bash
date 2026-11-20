import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { getSkipReason } from "../../spec-tests/jq/skips.js";

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

  it.each([
    ["{}", "[path(.missing | select(. == null))]", '[["missing"]]\n'],
    ["[]", "[path(.[3] | nulls)]", "[[3]]\n"],
    [
      '{"zero":0,"flag":false,"empty":""}',
      "[path(.[] | select(. != null))]",
      '[["zero"],["flag"],["empty"]]\n',
    ],
  ])("passes jq values through piped paths on %s", async (input, filter, stdout) => {
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

  it("keeps negative fractional reads distinct from deletion paths", async () => {
    const bash = new Bash({ files: { "/input.json": "[1,2,3]" } });
    expect(
      await bash.exec(
        "jq -c '[.[-0.5], del(.[-0.5]), del(.[-0.5], .[1]), del(.[-1.5])]' /input.json",
      ),
    ).toMatchObject({
      stdout: "[1,[1,2,3],[1,3],[1,2]]\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves conditional paths without accepting value-producing branches", async () => {
    const bash = new Bash({
      files: {
        "/active.json": '{"user":{"active":true,"secret":1,"keep":2}}',
        "/inactive.json": '{"user":{"active":false,"secret":1,"keep":2}}',
      },
    });
    const pathFilter = "[path(.user | if .active then . else empty end)]";
    expect(await bash.exec(`jq -c '${pathFilter}' /active.json`)).toMatchObject(
      {
        stdout: '[["user"]]\n',
        stderr: "",
        exitCode: 0,
      },
    );
    expect(
      await bash.exec(`jq -c '${pathFilter}' /inactive.json`),
    ).toMatchObject({ stdout: "[]\n", stderr: "", exitCode: 0 });
    expect(
      await bash.exec(
        "jq -c '[path(.user | if .active then .secret elif .keep == 2 then .keep else empty end)]' /inactive.json",
      ),
    ).toMatchObject({
      stdout: '[["user","keep"]]\n',
      stderr: "",
      exitCode: 0,
    });
    expect(
      await bash.exec(
        "jq -c 'del(.user | if .active then .secret else empty end)' /active.json",
      ),
    ).toMatchObject({
      stdout: '{"user":{"active":true,"keep":2}}\n',
      stderr: "",
      exitCode: 0,
    });
    const result = await bash.exec(
      "jq -c 'del(.user | if .active then .secret + 1 else empty end)' /active.json",
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unsupported path expression");
  });

  it("keeps passing jq spec cases out of the expected-failure list", () => {
    const passingCases = [
      ["jq.test", "path(.[] | select(.>3))"],
      [
        "jq.test",
        "del(.), del(empty), del((.foo,.bar,.baz) | .[2,3,0]), del(.foo[0], .bar[0], .foo, .baz.bar[0].x)",
      ],
      ["man.test", "del(.[1, 2])"],
    ];
    for (const [fileName, program] of passingCases) {
      expect(getSkipReason(fileName, program, program)).toBeUndefined();
    }
    const unsupported = "del(.[2:4],.[0],.[-2:])";
    expect(getSkipReason("jq.test", unsupported, unsupported)).toBeDefined();
    const unsupportedSlice = "del(.[1], .[-6], .[2], .[-3:9])";
    expect(
      getSkipReason("jq.test", unsupportedSlice, unsupportedSlice),
    ).toBeDefined();
  });
});
