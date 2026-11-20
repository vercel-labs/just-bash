import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// jq compares objects by their keys and values, not by the order the keys were
// written in. Each expected value is what jq 1.6 prints for the same filter.
describe("jq objects that differ only in key order", () => {
  it.each([
    ['{"a":1,"b":2} == {"b":2,"a":1}', "true"],
    ['{"a":1,"b":2} != {"b":2,"a":1}', "false"],
    ['{"x":{"a":1,"b":2}} == {"x":{"b":2,"a":1}}', "true"],
    ['{"a":1} == {"a":1,"b":null}', "false"],
    ['[{"a":1,"b":2},{"b":2,"a":1}] | unique', '[{"a":1,"b":2}]'],
    ['[{"k":{"a":1,"b":2}},{"k":{"b":2,"a":1}}] | unique_by(.k) | length', "1"],
    ['[{"k":{"a":1,"b":2}},{"k":{"b":2,"a":1}}] | group_by(.k) | length', "1"],
    ['[{"a":1,"b":2}] - [{"b":2,"a":1}]', "[]"],
    ['[{"a":1,"b":2}] | index({"b":2,"a":1})', "0"],
    ['[{"a":1,"b":2}] | indices({"b":2,"a":1})', "[0]"],
    ['[{"c":3},{"a":1,"b":2}] | index([{"b":2,"a":1}])', "1"],
    ['{"b":2,"a":1} | IN({"a":1,"b":2})', "true"],
  ])("%s", async (filter, expected) => {
    const env = new Bash();
    const result = await env.exec(`jq -cn '${filter}'`);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  // Filter literals drop __proto__, constructor and prototype keys, so these
  // objects come from stdin.
  it.each([
    ['[{"__proto__":1,"a":2},{"a":2,"__proto__":1}]', "true"],
    ['[{"__proto__":1},{"__proto__":2}]', "false"],
    ['[{"constructor":{"b":1,"a":2}},{"constructor":{"a":2,"b":1}}]', "true"],
    ['[{"toString":1,"b":2},{"b":2,"toString":1}]', "true"],
  ])("compares prototype-named keys as data: %s", async (input, expected) => {
    const prototypeBefore = Object.getOwnPropertyNames(Object.prototype);
    const env = new Bash();
    const result = await env.exec(`echo '${input}' | jq -c '.[0] == .[1]'`);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(
      prototypeBefore,
    );
  });

  // Each expectation is jq 1.6's.
  it.each([
    // A key filter that emits nothing is its own key, not null.
    ["[1,2] | group_by(if . == 1 then empty else null end)", "[[1],[2]]"],
    ["[1,2] | unique_by(if . == 1 then empty else null end)", "[1,2]"],
    ["[[],[null],[null]] | group_by(.[]?)", "[[[]],[[null],[null]]]"],
    ["[[],[null],[null]] | unique_by(.[]?) | sort", "[[],[null]]"],
    // A sparse array equals its JSON round trip.
    ['([] | delpaths([[2,"a"]])) | . == (tojson | fromjson)', "true"],
    [
      '[([] | delpaths([[2,"a"]])), ([] | delpaths([[2,"a"]]) | tojson | fromjson)] | unique | length',
      "1",
    ],
    // Two-stream IN compares values, not their key order.
    ['IN({"a":1,"b":2}; {"b":2,"a":1})', "true"],
    ['IN({"a":1}; {"b":2,"a":1})', "false"],
  ])("%s", async (filter, expected) => {
    const env = new Bash();
    const result = await env.exec(`jq -cn '${filter}'`);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
