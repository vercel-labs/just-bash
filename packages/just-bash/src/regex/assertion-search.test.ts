import { describe, expect, it } from "vitest";
import { UserRegex } from "./user-regex.js";

describe("regex assertion search", () => {
  it.each([
    ["\\btoken\\b|item[-_ ]?code", "i", "(TOKEN)", true],
    ["\\btoken\\b|item[-_ ]?code", "i", "token_value", false],
    ["\\btoken\\b|item[-_ ]?code", "i", "7token9", false],
    ["\\btoken\\b|item[-_ ]?code", "i", "😀token😀", true],
    ["\\btoken\\b|item[-_ ]?code", "i", "item-code", true],
    ["\\Btoken\\B", "", "xtokeny", true],
    ["\\Btoken\\B", "", " token ", false],
    ["^token$", "m", "before\ntoken\nafter", true],
    ["^token$", "", "before\ntoken\nafter", false],
    ["\\b(k|s)\\b", "i", "K ſ", false],
    ["\\b(k|s)\\b", "i", "K S", true],
  ])("preserves assertions for /%s/%s on %j", (pattern, flags, input, expected) => {
    expect(new UserRegex(pattern, flags).test(input)).toBe(expected);
  });
});
