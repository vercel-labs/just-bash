import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { sanitizeParsedData } from "./safe-object.js";

const DANGEROUS =
  '{"__proto__":{"polluted":true},"constructor":2,"prototype":3,"hasOwnProperty":4,"toString":5,"valueOf":6}';

describe("sanitizeParsedData with jsonTree", () => {
  it("makes records null-prototype in place, keeping dangerous own keys", () => {
    const original = Object.getOwnPropertyDescriptors(Object.prototype);
    const input = JSON.parse(
      `{"rows":[${DANGEROUS}],"nested":{"a":[{"b":1}]}}`,
    );
    const rows = input.rows;
    const result = sanitizeParsedData(input, { jsonTree: true }) as {
      rows: Array<Record<string, unknown>>;
      nested: { a: Array<{ b: number }> };
    };

    expect(result).toBe(input);
    expect(result.rows).toBe(rows);
    for (const record of [
      result,
      result.rows[0],
      result.nested,
      result.nested.a[0],
    ]) {
      expect(Object.getPrototypeOf(record)).toBe(null);
    }
    expect(Object.getPrototypeOf(result.rows[0].__proto__)).toBe(null);
    expect(Object.keys(result.rows[0])).toEqual([
      "__proto__",
      "constructor",
      "prototype",
      "hasOwnProperty",
      "toString",
      "valueOf",
    ]);
    expect(JSON.stringify(result.rows[0])).toBe(DANGEROUS);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
      original,
    );
  });

  it.each([
    false,
    true,
  ])("applies the same depth and element limits (jsonTree: %s)", (jsonTree) => {
    expect(() =>
      sanitizeParsedData(JSON.parse('{"a":[1,2,3]}'), {
        maxElements: 3,
        jsonTree,
      }),
    ).toThrow("query input element limit exceeded (3)");
    expect(() =>
      sanitizeParsedData(JSON.parse('{"a":[1,2,3]}'), {
        maxElements: 4,
        jsonTree,
      }),
    ).not.toThrow();
    expect(() =>
      sanitizeParsedData(JSON.parse('{"a":{"b":[]}}'), {
        maxDepth: 1,
        jsonTree,
      }),
    ).toThrow("query depth limit exceeded (1)");
    expect(() =>
      sanitizeParsedData(JSON.parse('{"a":{"b":[]}}'), {
        maxDepth: 2,
        jsonTree,
      }),
    ).not.toThrow();
    const elementBudget = { used: 0 };
    const limits = { maxElements: 2, elementBudget, jsonTree };
    sanitizeParsedData(JSON.parse('{"a":1}'), limits);
    sanitizeParsedData(JSON.parse("[2]"), limits);
    expect(() => sanitizeParsedData(JSON.parse('{"b":3}'), limits)).toThrow(
      "query input element limit exceeded (2)",
    );
    expect(elementBudget.used).toBe(2);
  });

  it("runs under defense-in-depth for jq input", async () => {
    const original = Object.getOwnPropertyDescriptors(Object.prototype);
    const env = new Bash({
      defenseInDepth: true,
      files: { "/d.json": `[${DANGEROUS},{"a":{"b":1}}]` },
    });
    const result = await env.exec(
      "jq -c '[.[0].__proto__.polluted, .[0].constructor, .[1].a.b, (.[0] | keys | length)]' /d.json",
    );
    expect(result).toMatchObject({
      stdout: "[true,2,1,6]\n",
      stderr: "",
      exitCode: 0,
    });
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
      original,
    );
  });
});
