import { describe, expect, it } from "vitest";
import { matchesAllowListEntry, validateAllowList } from "../allow-list.js";

describe("path-scoped allow-list canonicalization", () => {
  const entry = "https://api.example.com/safe/";

  it.each([
    "/safe/item;admin=true",
    "/safe/..;/admin",
    "/safe/item%3badmin=true",
    "/safe/item%3Badmin=true",
    "/safe/item%253badmin=true",
    "/safe/item%25253badmin=true",
    "/safe/item%2f..%2fadmin",
    "/safe/item%252f..%252fadmin",
    "/safe/%2e%2e/admin",
    "/safe/%2E%2e/admin",
    "/safe/%252e%252e/admin",
    "/safe/%25252e%25252e/admin",
    "/safe/%252f%252e%252e%252fadmin",
    "/safe/item%5c..%5cadmin",
    "/safe/item%zz",
    "/safe/item%",
  ])("rejects ambiguous effective path %s", (pathname) => {
    expect(
      matchesAllowListEntry(`https://api.example.com${pathname}`, entry),
    ).toBe(false);
  });

  it.each([
    "/safe/",
    "/safe/item",
    "/safe/file%20name.txt",
    "/safe/report~latest",
  ])("allows an ordinary path %s", (pathname) => {
    expect(
      matchesAllowListEntry(`https://api.example.com${pathname}`, entry),
    ).toBe(true);
  });

  it("preserves documented origin-only semantics", () => {
    expect(
      matchesAllowListEntry(
        "https://api.example.com/any;matrix=value",
        "https://api.example.com",
      ),
    ).toBe(true);
  });

  it.each([
    "https://api.example.com/safe;matrix=value",
    "https://api.example.com/safe%3bmatrix=value",
    "https://api.example.com/safe%253bmatrix=value",
    "https://api.example.com/safe%zz",
  ])("rejects ambiguous path-scoped configuration %s", (configuredEntry) => {
    expect(validateAllowList([configuredEntry])).toHaveLength(1);
  });
});
