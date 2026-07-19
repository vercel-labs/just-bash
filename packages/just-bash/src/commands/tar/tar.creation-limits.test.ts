import { describe, expect, it } from "vitest";
import { ExecutionScope } from "../../execution-scope.js";
import { resolveLimits } from "../../limits.js";
import {
  createArchive,
  createBzip2CompressedArchive,
  createCompressedArchive,
} from "./archive.js";

describe("tar creation limits", () => {
  it("rejects an excessive entry count before packing", async () => {
    await expect(
      createArchive(
        [
          { name: "one", content: "1" },
          { name: "two", content: "2" },
        ],
        { maxEntries: 1 },
      ),
    ).rejects.toThrow("Too many archive entries (max 1)");
  });

  it("rejects aggregate content before packing or compressing", async () => {
    const entries = [{ name: "payload", content: new Uint8Array(4096) }];

    await expect(
      createArchive(entries, { maxArchiveSize: 2048 }),
    ).rejects.toThrow("Archive too large (max 2048 bytes)");
    await expect(
      createCompressedArchive(entries, { maxArchiveSize: 2048 }),
    ).rejects.toThrow("Archive too large (max 2048 bytes)");
  });

  it("accounts for attacker-controlled PAX metadata before packing", async () => {
    const longName = `${"directory/".repeat(80)}payload`;

    await expect(
      createArchive([{ name: longName, content: "x" }], {
        maxArchiveSize: 2048,
      }),
    ).rejects.toThrow("Archive too large (max 2048 bytes)");
  });

  it("bounds bzip2 output while the bitstream is written", async () => {
    await expect(
      createBzip2CompressedArchive(
        [{ name: "payload", content: "data that must produce output" }],
        { maxArchiveSize: 8192, maxCompressedSize: 4 },
      ),
    ).rejects.toThrow("bzip2 output exceeds limit (4 bytes)");
  });

  it("reserves archive construction against the shared live-byte budget", async () => {
    const scope = new ExecutionScope(resolveLimits({ maxLiveBytes: 1024 }));

    await expect(
      createArchive([{ name: "payload", content: "x" }], {
        maxArchiveSize: 8192,
        executionScope: scope,
      }),
    ).rejects.toThrow("live byte limit exceeded (1024 bytes)");
  });
});
