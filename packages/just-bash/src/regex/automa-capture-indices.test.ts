// Automa modifications: N00b patchAwkRegexOffsets uses exact bounded RE2 offsets.
import { describe, expect, it } from "vitest";
import { createUserRegex } from "./user-regex.js";

describe("optional capture offsets", () => {
  it("distinguishes repeated captures, unmatched groups and empty captures", () => {
    const regex = createUserRegex("(a)(a)(z)?()");
    expect(regex.exec("xaa", true)?.indices).toEqual([
      [1, 3],
      [1, 2],
      [2, 3],
      [-1, -1],
      [3, 3],
    ]);
    expect(regex.exec("xaa")?.indices).toBeUndefined();
  });
  it("reports UTF-16 positions directly from the original matcher", () => {
    const result = createUserRegex("(a)(b)").exec("😀ab", true);
    expect(result?.indices).toEqual([
      [2, 4],
      [2, 3],
      [3, 4],
    ]);
  });
});
