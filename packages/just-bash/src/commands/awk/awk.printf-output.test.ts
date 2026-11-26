import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("awk printf output accounting", () => {
  it("bounds printf by the UTF-8 size of what awk has already written", async () => {
    // awk's own bound is min(maxStringLength, maxOutputSize), so a small
    // maxStringLength makes it the one that binds. Sixty two-byte characters
    // are 120 bytes but 60 UTF-16 units: counting units would let all of
    // them through.
    const bash = new Bash({ executionLimits: { maxStringLength: 100 } });

    const result = await bash.exec(
      `awk 'BEGIN { for (i = 0; i < 60; i++) printf "é" }'`,
    );

    expect(result.exitCode).toBe(126);
    expect(Buffer.byteLength(result.stdout)).toBe(100);
    expect(result.stderr).toBe(
      "awk: formatted string size limit exceeded (0 bytes)\n",
    );
  });

  it("counts a character split across two writes once", async () => {
    // U+1F600 written as its two surrogates by separate printfs is 4 bytes
    // of output, not 3 + 3, so "xx" after it still fits in 7.
    const bash = new Bash({ executionLimits: { maxOutputSize: 7 } });

    const result = await bash.exec(
      `awk 'BEGIN { printf "%c", 55357; printf "%c", 56832; printf "xx" }'`,
    );

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("\u{1F600}xx");
  });

  it("runs printf over many records in linear time", async () => {
    // Guarded by the test timeout: re-measuring the accumulated output on
    // every printf made this about ten seconds, and it runs in well under one.
    const bash = new Bash();

    const result = await bash.exec(
      `seq 1 20000 | awk '{ printf "%s\\n", $0 }' | wc -l`,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("20000");
  });
});
