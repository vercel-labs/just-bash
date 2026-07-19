import { describe, expect, it } from "vitest";
import { getValueDepth } from "./value-operations.js";

describe("getValueDepth", () => {
  it("examines deep non-first object and array branches", () => {
    expect(getValueDepth({ first: 1, second: { a: { b: {} } } })).toBe(4);
    expect(getValueDepth([0, [1, [[2]]]])).toBe(4);
  });

  it("handles deep input iteratively and exits at the configured limit", () => {
    let value: unknown = null;
    for (let i = 0; i < 10_000; i++) value = [value];
    expect(getValueDepth(value, 128)).toBe(128);
  });

  it("fails closed on cyclic graphs", () => {
    const value: { self?: unknown } = {};
    value.self = value;
    expect(getValueDepth(value, 16)).toBe(16);
  });

  it("does not inspect containers beyond the depth limit", () => {
    let accesses = 0;
    const child = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(child, "expensive", {
      enumerable: true,
      get() {
        accesses++;
        return {};
      },
    });
    expect(getValueDepth({ child }, 2)).toBe(2);
    expect(accesses).toBe(0);
  });
});
