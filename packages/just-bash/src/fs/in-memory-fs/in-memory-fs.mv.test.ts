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

  it("does not reject a symlinked destination parent", async () => {
    const fs = new InMemoryFs({
      "/real/.keep": "",
      "/f.txt": "content",
    });
    await fs.symlink("/real", "/link");
    await expect(fs.mv("/f.txt", "/link/f.txt")).resolves.toBeUndefined();
  });

  it("still renames a directory to a missing destination", async () => {
    const fs = new InMemoryFs({ "/srcdir/file.txt": "content" });
    await fs.mv("/srcdir", "/dstdir");
    expect(await fs.readFile("/dstdir/file.txt")).toBe("content");
    await expect(fs.stat("/srcdir")).rejects.toThrow();
  });
});

it("keeps a file reachable after moving it through a symlinked parent", async () => {
  const fs = new InMemoryFs({
    "/real/.keep": "",
    "/f.txt": "content",
  });
  await fs.symlink("/real", "/link");
  await fs.mv("/f.txt", "/link/f.txt");
  // Reads resolve through /link, so the content must live at /real/f.txt.
  await expect(fs.readFile("/link/f.txt")).resolves.toBe("content");
  await expect(fs.readFile("/real/f.txt")).resolves.toBe("content");
});

// rename(2) resolves the whole destination path, so a destination that is a
// symlink is followed: the link survives and its target is replaced. Reads alone
// cannot distinguish that from replacing the link, because both land on the same
// bytes, so the link itself is asserted too.
describe("InMemoryFs mv onto a symlink", () => {
  it("follows the link and replaces its target", async () => {
    const fs = new InMemoryFs({ "/real/victim.txt": "IMPORTANT" });
    await fs.writeFile("/src.txt", "NEW");
    await fs.symlink("/real/victim.txt", "/link");

    await fs.mv("/src.txt", "/link");

    expect(await fs.readFile("/real/victim.txt")).toBe("NEW");
    expect(await fs.readFile("/link")).toBe("NEW");
    expect(await fs.readlink("/link")).toBe("/real/victim.txt");
    await expect(fs.readFile("/src.txt")).rejects.toThrow(
      "ENOENT: no such file or directory, open '/src.txt'",
    );
  });

  it("follows a link whose target is relative", async () => {
    const fs = new InMemoryFs({ "/real/victim.txt": "IMPORTANT" });
    await fs.writeFile("/src.txt", "NEW");
    await fs.symlink("real/victim.txt", "/link");

    await fs.mv("/src.txt", "/link");

    expect(await fs.readFile("/real/victim.txt")).toBe("NEW");
    expect(await fs.readlink("/link")).toBe("real/victim.txt");
  });

  it("follows a chain of links to the entry that ends it", async () => {
    const fs = new InMemoryFs({ "/real/victim.txt": "IMPORTANT" });
    await fs.writeFile("/src.txt", "NEW");
    await fs.symlink("/real/victim.txt", "/hop");
    await fs.symlink("/hop", "/link");

    await fs.mv("/src.txt", "/link");

    // Both links survive and the target they end at holds the moved file.
    expect(await fs.readFile("/real/victim.txt")).toBe("NEW");
    expect(await fs.readlink("/link")).toBe("/hop");
    expect(await fs.readlink("/hop")).toBe("/real/victim.txt");
  });

  it("lands the entry at a dangling link's own path", async () => {
    const fs = new InMemoryFs({ "/real/.keep": "" });
    await fs.writeFile("/src.txt", "NEW");
    await fs.symlink("/real/missing.txt", "/link");

    await fs.mv("/src.txt", "/link");

    // Nothing sits at the target, so the entry goes where the link points and
    // the link becomes a plain one to it.
    expect(await fs.readFile("/real/missing.txt")).toBe("NEW");
    expect(await fs.readFile("/link")).toBe("NEW");
  });

  it("merges a directory into the directory a link points at", async () => {
    const fs = new InMemoryFs({
      "/target/.keep": "",
      "/srcdir/file.txt": "content",
    });
    await fs.symlink("/target", "/link");

    await fs.mv("/srcdir", "/link");

    expect(await fs.readFile("/target/file.txt")).toBe("content");
    expect(await fs.readFile("/link/file.txt")).toBe("content");
    expect(await fs.readlink("/link")).toBe("/target");
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
