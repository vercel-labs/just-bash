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

  it("rejects a nonempty destination even when its child shares an inode", async () => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 5 });
    await fs.mkdir("/source");
    await fs.mkdir("/destination");
    await fs.writeFile("/source/file", "12345");
    await fs.link("/source/file", "/destination/file");

    await expect(fs.mv("/source", "/destination")).rejects.toThrow("ENOTEMPTY");

    expect(await fs.readFile("/source/file")).toBe("12345");
    expect(await fs.readFile("/destination/file")).toBe("12345");
  });

  it.each([
    false,
    true,
  ])("retains directory entries when replacing an empty directory: %s", async (replace) => {
    const fs = new InMemoryFs(undefined, { maxTotalBytes: 5 });
    await fs.mkdir("/source/nested", { recursive: true });
    await fs.chmod("/source", 0o700);
    await fs.chmod("/source/nested", 0o750);
    await fs.writeFile("/source/nested/file", "12345");
    await fs.link("/source/nested/file", "/alias");
    await fs.symlink("nested/file", "/source/link");
    if (replace) await fs.mkdir("/destination");
    const paths = ["", "/nested", "/nested/file", "/link"];
    const stats = await Promise.all(
      paths.map((path) => fs.lstat(`/source${path}`)),
    );

    await fs.mv("/source", "/destination");

    expect(
      await Promise.all(paths.map((path) => fs.lstat(`/destination${path}`))),
    ).toEqual(stats);
    expect(await fs.readFile("/destination/link")).toBe("12345");

    expect(fs.getAllPaths().sort()).toEqual([
      "/",
      "/alias",
      "/destination",
      "/destination/link",
      "/destination/nested",
      "/destination/nested/file",
    ]);
    await fs.rm("/destination", { recursive: true });
    await expect(fs.writeFile("/replacement", "x")).rejects.toThrow("ENOSPC");
    await fs.rm("/alias");
    await expect(
      fs.writeFile("/replacement", "12345"),
    ).resolves.toBeUndefined();
  });

  it("rejects incompatible destination types without changing either entry", async () => {
    const fs = new InMemoryFs({ "/file": "content" });
    await fs.mkdir("/directory");
    await expect(fs.mv("/directory", "/file")).rejects.toThrow("ENOTDIR");
    await expect(fs.mv("/file", "/directory")).rejects.toThrow("EISDIR");
    expect(await fs.readFile("/file")).toBe("content");
    expect(await fs.readdir("/directory")).toEqual([]);
  });
});
