import { describe, expect, it } from "vitest";
import { UserRegex } from "./user-regex.js";

describe("boolean regex search", () => {
  it.each([
    [
      "cust.?item|cust[-_ ]+item|customer[-_ ]+item|custom[-_ ]+item|cust[-_ ]*sku|cust.?item.*sku|sku.*cust.?item",
      "i",
    ],
    ["(?<word>cust).?(item)|sku", "gi"],
    ["^item$|^sku$", "im"],
    ["cust.*item", "s"],
    ["\\b(sku|item)\\b", "i"],
    ["\\btoken\\b|item[-_ ]?code", "i"],
    ["\\Btoken\\B|^item$", "im"],
    ["(Σ|k|s)+", "i"],
    ["a*", "g"],
    ["missing|", ""],
  ])("agrees with captured search for /%s/%s", (pattern, flags) => {
    const boolean = new UserRegex(pattern, flags);
    const captured = new UserRegex(pattern, flags);
    for (const input of [
      "",
      "Account.Customer_Name__c Items total",
      "CUST ITEM",
      "customer__ITEM",
      "SKU x cust-item",
      "sku\nitem",
      "cust\nitem",
      "cuſt item",
      "ςσΣ K S ſ",
      "İ",
      "😀cust😀item😀",
      "\ud800cust\udc00item",
      "xitemx",
      "unrelated",
      "token",
      "(TOKEN)",
      "token_value",
      "7token9",
      "xtokeny",
      "😀token😀",
      "item-code",
    ]) {
      boolean.lastIndex = 4;
      captured.lastIndex = 0;
      const expected = captured.exec(input);
      expect(boolean.test(input)).toBe(expected !== null);
      expect(boolean.lastIndex).toBe(flags.includes("g") ? 0 : 4);
      boolean.lastIndex = 0;
      expect(boolean.exec(input)).toEqual(expected);
    }
  });
});
