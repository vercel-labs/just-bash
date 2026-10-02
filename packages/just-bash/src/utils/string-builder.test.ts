import { describe, expect, it } from "vitest";
import { createStringBuilder } from "./string-builder.js";

describe("string builder", () => {
  it.each([
    0, 1, 32, 33, 8191, 8192, 8193, 8223, 8224, 16384, 16385, 32769,
  ])("preserves %i mixed fragments across reused batches", (count) => {
    const fragments = ["", "a", "é", "水", "😀", "\ud800", "\udc00"];
    const builder = createStringBuilder();
    let expected = "";
    for (let i = 0; i < count; i++) {
      const fragment = fragments[i % fragments.length];
      builder.append(fragment);
      expected += fragment;
    }
    expect(builder.finish()).toBe(expected);
  });

  it("does not retain stale entries when a full batch has a short tail", () => {
    const builder = createStringBuilder();
    for (let i = 0; i < 8223; i++) builder.append("a");
    builder.append("z");
    expect(builder.finish()).toBe(`${"a".repeat(8223)}z`);
  });
});
