import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("sqlite3 resource limits", () => {
  it("stops collecting rows at the worker bridge row limit", async () => {
    const env = new Bash({ executionLimits: { maxArrayElements: 2 } });
    const result = await env.exec(
      'sqlite3 :memory: "SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("query result exceeds 2 row limit");
  });

  it("rejects formatter expansion before building oversized output", async () => {
    const env = new Bash({
      executionLimits: { maxOutputSize: 128, maxStringLength: 128 },
    });
    const result = await env.exec(
      `sqlite3 -html :memory: "SELECT '${"<&".repeat(12)}'"`,
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("formatted output exceeds 128 byte limit");
  });

  it("rejects an oversized database prospectively before reading it", async () => {
    const fs = new InMemoryFs({ "/large.db": "12345" });
    const read = vi.spyOn(fs, "readFileBuffer");
    const env = new Bash({
      fs,
      executionLimits: { maxDatabaseBytes: 4 },
    });

    const result = await env.exec('sqlite3 /large.db "SELECT 1"');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("database exceeds 4 byte limit");
    expect(read).not.toHaveBeenCalled();
  });

  it("checks the actual database buffer after a stat/read race", async () => {
    const fs = new InMemoryFs({ "/growing.db": "12345" });
    const actualStat = await fs.stat("/growing.db");
    vi.spyOn(fs, "stat").mockResolvedValue({ ...actualStat, size: 4 });
    const read = vi.spyOn(fs, "readFileBuffer");
    const env = new Bash({
      fs,
      executionLimits: { maxDatabaseBytes: 4 },
    });

    const result = await env.exec('sqlite3 /growing.db "SELECT 1"');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("database exceeds 4 byte limit");
    expect(read).toHaveBeenCalledOnce();
  });
});
