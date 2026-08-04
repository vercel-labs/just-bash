import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg compressed search limits", () => {
  it("rejects gzip expansion above maxStringLength before decoding text", async () => {
    const env = new Bash({
      executionLimits: { maxStringLength: 128, maxOutputSize: 1024 },
    });
    await env.fs.writeFile("/bomb.gz", gzipSync("X".repeat(4096)));

    const result = await env.exec("rg -z X /bomb.gz");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("searches gzip content below the configured ceiling", async () => {
    const env = new Bash({
      executionLimits: { maxStringLength: 128, maxOutputSize: 1024 },
    });
    await env.fs.writeFile("/safe.gz", gzipSync("hello\n"));

    const result = await env.exec("rg -z hello /safe.gz");

    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
