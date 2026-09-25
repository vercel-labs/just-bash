import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./in-memory-fs.js";

describe("InMemoryFs moves with hard links", () => {
  it("keeps a direct rename onto the same inode as a no-op", async () => {
    const fs = new InMemoryFs();
    await fs.writeFile("/original", "content");
    await fs.link("/original", "/alias");
    const identity = (await fs.stat("/original")).identity;

    await fs.mv("/original", "/alias");

    expect(await fs.readFile("/original")).toBe("content");
    expect(await fs.readFile("/alias")).toBe("content");
    expect((await fs.stat("/alias")).identity).toBe(identity);
  });

  it("removes the old child link when moving its parent directory", async () => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 5 });
    await fs.mkdir("/source");
    await fs.mkdir("/destination");
    await fs.writeFile("/source/file", "12345");
    await fs.link("/source/file", "/destination/file");

    await fs.mv("/source", "/destination");

    expect(fs.getAllPaths().sort()).toEqual([
      "/",
      "/destination",
      "/destination/file",
    ]);
    await expect(fs.lstat("/source/file")).rejects.toThrow("ENOENT");
    expect(await fs.readFile("/destination/file")).toBe("12345");

    await fs.rm("/destination/file");
    await expect(
      fs.writeFile("/replacement", "12345"),
    ).resolves.toBeUndefined();
  });
});
