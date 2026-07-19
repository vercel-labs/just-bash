import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { resolveLimits } from "../../limits.js";

describe("compatibility-safe execution limit configuration", () => {
  it("uses liberal normal defaults and keeps the former ceilings opt-in", () => {
    const normal = resolveLimits();
    const hardened = resolveLimits(undefined, "hardened");

    expect(normal.maxCommandCount).toBe(100_000);
    expect(normal.maxStringLength).toBe(64 * 1024 * 1024);
    expect(normal.maxOutputSize).toBe(256 * 1024 * 1024);
    expect(normal.maxArchiveCompressedBytes).toBe(512 * 1024 * 1024);
    expect(normal.maxExecutionTimeMs).toBe(60 * 60 * 1000);
    expect(hardened.maxCommandCount).toBe(10_000);
    expect(hardened.maxStringLength).toBe(10 * 1024 * 1024);
    expect(hardened.maxOutputSize).toBe(10 * 1024 * 1024);
    expect(hardened.maxArchiveCompressedBytes).toBe(64 * 1024 * 1024);
    expect(hardened.maxExecutionTimeMs).toBe(30_000);
  });

  it("exposes the hardened profile through Bash options", async () => {
    const bash = new Bash({ executionLimitProfile: "hardened" });
    const result = await bash.exec("echo ok");

    expect(result).toMatchObject({ stdout: "ok\n", stderr: "", exitCode: 0 });
  });

  it("separates query shape limits from shell call and loop limits", () => {
    const limits = resolveLimits({
      maxCallDepth: 17,
      maxJqIterations: 23,
      maxArrayElements: 31,
    });

    expect(limits.maxQueryDepth).toBe(1_000);
    expect(limits.maxQueryTokens).toBe(100_000);
    expect(limits.maxQueryElements).toBe(31);
  });

  it("allows trusted hosts to configure byte budgets above 256 MiB", () => {
    const configured = 512 * 1024 * 1024;
    const limits = resolveLimits({
      maxStringLength: configured,
      maxHeredocSize: configured,
      maxOutputSize: configured,
    });

    expect(limits.maxStringLength).toBe(configured);
    expect(limits.maxHeredocSize).toBe(configured);
    expect(limits.maxOutputSize).toBe(configured);
  });

  it("still rejects byte budgets beyond the documented runtime ceiling", () => {
    expect(() =>
      resolveLimits({ maxStringLength: 4 * 1024 * 1024 * 1024 + 1 }),
    ).toThrow(RangeError);
  });

  it("runs a bounded 10k+ operation workload under the normal profile", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'for ((i=0; i<10001; i++)); do :; done; printf "%s" "$i"',
    );

    expect(result).toMatchObject({ stdout: "10001", stderr: "", exitCode: 0 });
  });

  it("supports representative nested scripts and pipelines", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      descend() {
        if [ "$1" -gt 0 ]; then descend $(($1 - 1)); else printf nested; fi
      }
      descend 75 | awk '{ print toupper($0) }' | grep NESTED
    `);

    expect(result).toMatchObject({
      stdout: "NESTED\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("accepts query depth and CSV volume beyond hardened defaults", async () => {
    let nested: unknown = 0;
    const queryParts: string[] = [];
    for (let index = 0; index < 300; index++) {
      nested = { a: nested };
      queryParts.push(".a");
    }
    const csv = `value\n${Array.from({ length: 10_001 }, (_, i) => i).join("\n")}\n`;
    const bash = new Bash({
      files: {
        "/deep.json": JSON.stringify(nested),
        "/rows.csv": csv,
      },
    });

    const result = await bash.exec(
      `jq '${queryParts.join("")}' /deep.json; xan count /rows.csv`,
    );
    expect(result).toMatchObject({
      stdout: "0\n10001\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
