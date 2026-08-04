import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "./in-memory-fs.js";

describe("InMemoryFs retained-byte accounting", () => {
  it("counts a hard-linked body once and releases it after the final alias", async () => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 8 });
    await fs.writeFile("/original", "12345678");
    await fs.link("/original", "/alias");
    await fs.rm("/original");

    await expect(fs.writeFile("/other", "x")).rejects.toThrow("ENOSPC");
    expect(await fs.readFile("/alias")).toBe("12345678");

    await fs.rm("/alias");
    await expect(fs.writeFile("/other", "x")).resolves.toBeUndefined();
  });

  it("does not credit an overwritten alias while another link retains it", async () => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 8 });
    await fs.writeFile("/original", "12345678");
    await fs.link("/original", "/alias");

    await expect(fs.writeFile("/original", "x")).rejects.toThrow("ENOSPC");
    expect(await fs.readFile("/original")).toBe("12345678");
    expect(await fs.readFile("/alias")).toBe("12345678");
  });

  it("moves a full-quota file without requiring duplicate capacity", async () => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 8 });
    await fs.writeFile("/source", "12345678");

    await expect(fs.mv("/source", "/dest")).resolves.toBeUndefined();
    expect(await fs.exists("/source")).toBe(false);
    expect(await fs.readFile("/dest")).toBe("12345678");
  });

  it("keeps a lazy entry retryable when materialization exceeds the quota", async () => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 4 });
    let calls = 0;
    fs.writeFileLazy("/lazy", () => {
      calls++;
      return "12345";
    });

    await expect(fs.readFile("/lazy")).rejects.toThrow("ENOSPC");
    await expect(fs.readFile("/lazy")).rejects.toThrow("ENOSPC");
    expect(calls).toBe(2);
  });

  it("handles many small files without rescanning retained contents", async () => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 20_000 });
    for (let index = 0; index < 10_000; index++) {
      await fs.writeFile(`/files/${index}`, "x");
    }
    for (let index = 0; index < 10_000; index += 2) {
      await fs.rm(`/files/${index}`);
    }
    for (let index = 0; index < 7_500; index++) {
      await fs.writeFile(`/replacement/${index}`, "yy");
    }

    await expect(fs.writeFile("/overflow", "x")).rejects.toThrow("ENOSPC");
  });
});

describe("Bash default filesystem quota", () => {
  it("uses the resolved custom filesystem-byte limit", async () => {
    const bash = new Bash({
      files: { "/seed": "x".repeat(800) },
      executionLimits: { maxFileSystemBytes: 1_024 },
    });

    await expect(bash.fs.writeFile("/extra", "x".repeat(800))).rejects.toThrow(
      "byte limit exceeded (1024 bytes)",
    );
    await bash.fs.rm("/seed");
    await expect(bash.fs.writeFile("/extra", "x")).resolves.toBeUndefined();
  });

  it("does not override the policy of an explicitly supplied filesystem", async () => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 16_384 });
    const bash = new Bash({
      fs,
      executionLimits: { maxFileSystemBytes: 1 },
    });

    await expect(
      bash.fs.writeFile("/file", "x".repeat(8_192)),
    ).resolves.toBeUndefined();
  });
});
