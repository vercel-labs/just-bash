import { describe, expect, it } from "vitest";
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
