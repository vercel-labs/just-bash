import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { sanitizeParsedData } from "./safe-object.js";

describe("sanitizeParsedData", () => {
  it("converts nested parsed objects to null-prototype records", () => {
    const input = {
      a: 1,
      nested: {
        b: 2,
      },
      list: [{ c: 3 }],
    };

    const result = sanitizeParsedData(input) as {
      a: number;
      nested: { b: number };
      list: Array<{ c: number }>;
    };

    expect(result).toEqual({
      a: 1,
      nested: { b: 2 },
      list: [{ c: 3 }],
    });
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(Object.getPrototypeOf(result.nested)).toBe(null);
    expect(Object.getPrototypeOf(result.list[0])).toBe(null);
  });

  it("preserves Date instances", () => {
    const date = new Date("2026-01-01T00:00:00.000Z");
    const result = sanitizeParsedData({ when: date }) as { when: Date };
    expect(result.when).toBe(date);
    expect(result.when instanceof Date).toBe(true);
  });

  it("handles cyclic arrays without stack overflow", () => {
    const loop: unknown[] = [];
    loop.push(loop);

    const sanitized = sanitizeParsedData(loop) as unknown[];

    expect(Array.isArray(sanitized)).toBe(true);
    expect(sanitized[0]).toBe(sanitized);
  });

  it("preserves shared references while sanitizing", () => {
    const shared = { value: 42 };
    const input = { left: shared, right: shared };

    const result = sanitizeParsedData(input) as {
      left: { value: number };
      right: { value: number };
    };

    expect(result.left).toBe(result.right);
    expect(Object.getPrototypeOf(result.left)).toBe(null);
  });

  it("iteratively rejects malicious pre-parsed data above the depth limit", () => {
    const root: unknown[] = [];
    let cursor = root;
    for (let depth = 0; depth < 20; depth++) {
      const child: unknown[] = [];
      cursor.push(child);
      cursor = child;
    }

    expect(() => sanitizeParsedData(root, { maxDepth: 19 })).toThrow(
      "query depth limit exceeded (19)",
    );
    expect(() => sanitizeParsedData(root, { maxDepth: 20 })).not.toThrow();
  });

  it("charges aggregate array and object members before cloning", () => {
    expect(() =>
      sanitizeParsedData({ a: [1, 2, 3] }, { maxElements: 3 }),
    ).toThrow("query input element limit exceeded (3)");
    expect(() =>
      sanitizeParsedData({ a: [1, 2, 3] }, { maxElements: 4 }),
    ).not.toThrow();
  });
});

describe("fresh JSON trees", () => {
  it("reuses fresh JSON containers while preserving dangerous own keys", () => {
    const original = Object.getOwnPropertyDescriptors(Object.prototype);
    const input = JSON.parse(
      '{"rows":[{"__proto__":{"polluted":true},"constructor":2,"prototype":3,"hasOwnProperty":4,"toString":5,"valueOf":6}]}',
    );
    const rows = input.rows;
    const record = rows[0];
    const result = sanitizeParsedData(input, { jsonTree: true }) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(result).toBe(input);
    expect(result.rows).toBe(rows);
    expect(result.rows[0]).toBe(record);
    expect(Object.getPrototypeOf(result)).toBe(null);
    expect(Object.getPrototypeOf(result.rows[0])).toBe(null);
    expect(Object.getPrototypeOf(result.rows[0].__proto__)).toBe(null);
    expect(JSON.stringify(result)).toBe(
      '{"rows":[{"__proto__":{"polluted":true},"constructor":2,"prototype":3,"hasOwnProperty":4,"toString":5,"valueOf":6}]}',
    );
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
      original,
    );
  });

  it.each([
    false,
    true,
  ])("keeps depth and shared element bounds (jsonTree: %s)", (jsonTree) => {
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

  it("sanitizes fresh jq input under defense-in-depth", async () => {
    const env = new Bash({
      defenseInDepth: true,
      files: { "/input.json": '{"__proto__":{"value":1},"constructor":2}' },
    });
    expect(await env.exec("jq -c . /input.json")).toMatchObject({
      stdout: '{"__proto__":{"value":1},"constructor":2}\n',
      stderr: "",
      exitCode: 0,
    });
  });
});
