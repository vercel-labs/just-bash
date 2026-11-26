import { describe, expect, it } from "vitest";
import { InMemoryFs } from "./index.js";

// rename(2) requires the destination's parent directory to exist; mv must not
// create missing parents (issue #690).
describe("InMemoryFs mv destination parent", () => {
  it("throws ENOENT when the destination parent is missing", async () => {
    const fs = new InMemoryFs({ "/abc.txt": "content" });
    await expect(fs.mv("/abc.txt", "/def/abc.txt")).rejects.toThrow(
      "ENOENT: no such file or directory, mv '/abc.txt' -> '/def/abc.txt'",
    );
    expect(await fs.readFile("/abc.txt")).toBe("content");
    await expect(fs.stat("/def")).rejects.toThrow();
  });

  it("throws ENOTDIR when the destination parent is a file", async () => {
    const fs = new InMemoryFs({
      "/f.txt": "",
      "/b": "content",
    });
    await expect(fs.mv("/f.txt", "/b/c")).rejects.toThrow(
      "ENOTDIR: not a directory, mv '/f.txt' -> '/b/c'",
    );
  });

  it("keeps a file reachable through a symlinked destination parent", async () => {
    const fs = new InMemoryFs({
      "/real/.keep": "",
      "/f.txt": "content",
    });
    await fs.symlink("/real", "/link");
    await fs.mv("/f.txt", "/link/f.txt");

    await expect(fs.readFile("/link/f.txt")).resolves.toBe("content");
    await expect(fs.readFile("/real/f.txt")).resolves.toBe("content");
    await expect(fs.stat("/f.txt")).rejects.toThrow("ENOENT");
  });

  it("preserves errors raised while resolving the destination parent", async () => {
    const fs = new InMemoryFs({ "/src.txt": "content", "/file": "" });
    await fs.symlink("/loop", "/loop");

    await expect(fs.mv("/src.txt", "/file/child/dest")).rejects.toThrow(
      "ENOTDIR",
    );
    await expect(fs.mv("/src.txt", "/loop/dest")).rejects.toThrow("ELOOP");
    await expect(fs.readFile("/src.txt")).resolves.toBe("content");
  });

  it("still renames a directory to a missing destination", async () => {
    const fs = new InMemoryFs({ "/srcdir/file.txt": "content" });
    await fs.mv("/srcdir", "/dstdir");
    expect(await fs.readFile("/dstdir/file.txt")).toBe("content");
    await expect(fs.stat("/srcdir")).rejects.toThrow();
  });
});

describe("InMemoryFs mv onto a symlink", () => {
  it("replaces the destination link and preserves its target", async () => {
    const fs = new InMemoryFs({
      "/real/target.txt": "original",
      "/src.txt": "moved",
    });
    await fs.symlink("/real/target.txt", "/link");

    await fs.mv("/src.txt", "/link");

    await expect(fs.readFile("/real/target.txt")).resolves.toBe("original");
    await expect(fs.readFile("/link")).resolves.toBe("moved");
    expect((await fs.lstat("/link")).isSymbolicLink).toBe(false);
    await expect(fs.stat("/src.txt")).rejects.toThrow("ENOENT");
  });

  it("replaces a dangling destination link", async () => {
    const fs = new InMemoryFs({ "/src.txt": "moved" });
    await fs.symlink("/missing.txt", "/link");

    await fs.mv("/src.txt", "/link");

    await expect(fs.readFile("/link")).resolves.toBe("moved");
    await expect(fs.stat("/missing.txt")).rejects.toThrow("ENOENT");
  });

  it("refuses to replace a destination link with a directory", async () => {
    const fs = new InMemoryFs({
      "/target/.keep": "",
      "/srcdir/file.txt": "content",
    });
    await fs.symlink("/target", "/link");

    await expect(fs.mv("/srcdir", "/link")).rejects.toThrow("ENOTDIR");
    await expect(fs.readFile("/srcdir/file.txt")).resolves.toBe("content");
    await expect(fs.stat("/target/file.txt")).rejects.toThrow("ENOENT");
    await expect(fs.readlink("/link")).resolves.toBe("/target");
  });

  it("refuses to move a directory into itself through a link", async () => {
    const fs = new InMemoryFs({ "/srcdir/inner/file.txt": "content" });
    await fs.symlink("/srcdir", "/link");

    await expect(fs.mv("/srcdir", "/link/inner")).rejects.toThrow(
      "EINVAL: cannot move '/srcdir' into itself, '/link/inner'",
    );
    expect(await fs.readFile("/srcdir/inner/file.txt")).toBe("content");
  });
});

it("keeps the source when a symlinked parent resolves to the same destination", async () => {
  const fs = new InMemoryFs({ "/real/file.txt": "content" });
  await fs.symlink("/real", "/link");

  await fs.mv("/real/file.txt", "/link/file.txt");

  await expect(fs.readFile("/real/file.txt")).resolves.toBe("content");
});

it("moves a file only once when two moves start together", async () => {
  const fs = new InMemoryFs({ "/dir/src.txt": "content" });
  const first = fs.mv("/dir/src.txt", "/dir/first.txt");
  const second = fs.mv("/dir/src.txt", "/dir/second.txt");

  await Promise.all([
    expect(first).resolves.toBeUndefined(),
    expect(second).rejects.toThrow("ENOENT"),
  ]);
  await expect(fs.readFile("/dir/first.txt")).resolves.toBe("content");
  await expect(fs.stat("/dir/second.txt")).rejects.toThrow("ENOENT");
});
