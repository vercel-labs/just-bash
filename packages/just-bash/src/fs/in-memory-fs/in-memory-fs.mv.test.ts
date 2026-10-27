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
