import { describe, expect, it } from "vitest";
import { parseOptions } from "./parse.js";

describe("curl redirect limit parsing", () => {
  it("retains zero as a real per-request redirect limit", () => {
    const result = parseOptions(["--max-redirs", "0", "https://example.com"]);
    expect("maxRedirects" in result && result.maxRedirects).toBe(0);
  });

  it.each([
    "-1",
    "1x",
    "Infinity",
    "9007199254740992",
    "",
  ])("rejects invalid --max-redirs value %j", (value) => {
    const result = parseOptions([
      `--max-redirs=${value}`,
      "https://example.com",
    ]);
    expect("exitCode" in result && result.exitCode).toBe(2);
  });

  it("rejects a missing separate value", () => {
    const result = parseOptions(["--max-redirs"]);
    expect("exitCode" in result && result.exitCode).toBe(2);
  });
});
