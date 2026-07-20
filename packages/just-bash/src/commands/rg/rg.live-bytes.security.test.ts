import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg live-byte accounting", () => {
  it("prospectively bounds concurrently-read file batches", async () => {
    const bash = new Bash({
      files: {
        "/one.txt": "a".repeat(30),
        "/two.txt": "a".repeat(30),
      },
      executionLimits: { maxInputBytes: 1_000, maxLiveBytes: 100 },
    });

    const result = await bash.exec("rg a /one.txt /two.txt");

    expect(result.exitCode).toBe(126);
    expect(result.stderr).toMatch(/rg: live byte limit exceeded \(100 bytes\)/);
  });

  it("releases a completed batch lease", async () => {
    const bash = new Bash({
      files: { "/one.txt": "a".repeat(30) },
      executionLimits: { maxInputBytes: 1_000, maxLiveBytes: 100 },
    });

    const result = await bash.exec("rg a /one.txt; rg a /one.txt");

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});
