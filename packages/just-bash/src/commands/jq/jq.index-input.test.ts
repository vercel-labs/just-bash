import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Expected values recorded from jq 1.7.1
describe("jq X[expr] evaluates expr against the input", () => {
  async function runJq(filter: string, input: string) {
    const env = new Bash();
    return env.exec(`echo '${input}' | jq -c '${filter}'`);
  }

  it.each([
    [
      "try path(.a[.b]) catch .",
      '{"a":5,"b":"x"}',
      '"Cannot index number with string \\"x\\""',
    ],
    [
      "try pick(.a[.b]) catch .",
      '{"a":5,"b":"x"}',
      '"Cannot index number with string \\"x\\""',
    ],
    [
      "try path(.a[.b]) catch .",
      '{"a":[],"b":"x"}',
      '"Cannot index array with string \\"x\\""',
    ],
    [
      "try path(.a[.b]) catch .",
      '{"a":{},"b":0}',
      '"Cannot index object with number"',
    ],
    ["path(.a[.b])", '{"b":"x"}', '["a","x"]'],
    ["pick(.a[.b])", '{"a":null,"b":"x"}', '{"a":{"x":null}}'],
    ['try path(.a.options[error("index")]) catch .', '{"a":[]}', '"index"'],
    ["[path(.a.options[empty])]", '{"a":[]}', "[]"],
    ['{"a":1,"b":2} as $m | $m[.]', '"b"', "2"],
    ["[10,20,30] as $a | $a[.]", "1", "20"],
    [".foo[.bar]", '{"foo":{"x":1},"bar":"x"}', "1"],
    [".foo[.n]", '{"foo":[10,20],"n":1}', "20"],
    [
      '{"b":true} as $m | map(select($m[.id]))',
      '[{"id":"a"},{"id":"b"}]',
      '[{"id":"b"}]',
    ],
    ["[(.x,.y)[0,1]]", '{"x":[1,2],"y":[3,4]}', "[1,3,2,4]"],
    ['[error("base")[empty]]', "null", "[]"],
    ['try (error("base")[error("index")]) catch .', "null", '"index"'],
    ["[path(.a[.i, 0])]", '{"a":[10,20],"i":1}', '[["a",1],["a",0]]'],
    ["path(.foo[.bar])", '{"foo":{"x":1},"bar":"x"}', '["foo","x"]'],
    ["del(.a[.i].b)", '{"a":[{"b":1,"c":2}],"i":0}', '{"a":[{"c":2}],"i":0}'],
    [
      "del(.p | .x[.k].y)",
      '{"k":0,"p":{"k":1,"x":[{"y":1},{"y":2}]}}',
      '{"k":0,"p":{"k":1,"x":[{"y":1},{}]}}',
    ],
    [
      "try path(.settings.options[.key]) catch .",
      '{"settings":[],"key":"theme"}',
      '"Cannot index array with string \\"options\\""',
    ],
    [
      "pick(.settings.options[.key])",
      '{"settings":{"options":{"theme":"dark"}},"key":"theme"}',
      '{"settings":{"options":{"theme":"dark"}}}',
    ],
  ])("%s on %s", async (filter, input, expected) => {
    const result = await runJq(filter, input);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
