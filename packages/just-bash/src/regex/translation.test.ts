import { describe, expect, it } from "vitest";
import { UserRegex } from "./user-regex.js";

describe("regex syntax translation", () => {
  it.each([
    "\\8",
    "\\9",
    "\\Z",
    "\\y",
    "\\h",
    "\\x",
    "\\u",
    "\\c1",
  ])("rejects unsupported escape %s instead of matching a literal", (pattern) => {
    expect(() => new UserRegex(pattern)).toThrow(SyntaxError);
  });

  it("preserves escaped backslashes and quoted RE2 literals", () => {
    for (const pattern of ["\\\\8", "\\Q\\8\\E"]) {
      const regex = new UserRegex(pattern);
      expect(regex.test("\\8")).toBe(true);
      expect(regex.test("8")).toBe(false);
    }
  });

  it("translates JavaScript Unicode, control escapes and named groups", () => {
    const regex = new UserRegex("(?<value>\\u0041\\u{1F600}\\cA)");
    expect(regex.exec("A😀\x01")?.groups).toEqual({ value: "A😀\x01" });
    expect(regex.test("u0041u{1F600}cA")).toBe(false);
  });

  it("keeps named-group characters literal inside a character class", () => {
    const regex = new UserRegex("[(?<]");
    expect(regex.test("<")).toBe(true);
    expect(regex.test("P")).toBe(false);
  });
});
