import { describe, expect, it, vi } from "vitest";
import { HttpFs } from "./http-fs.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetch(files: Record<string, string | Uint8Array>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    void init;
    for (const [path, content] of Object.entries(files)) {
      if (url.endsWith(path)) {
        const body =
          typeof content === "string"
            ? content
            : new Blob([content as BlobPart]);
        return new Response(body, { status: 200 });
      }
    }
    return new Response("Not Found", { status: 404 });
  });
}

function createFs(
  files: string[],
  served: Record<string, string>,
  options?: { headers?: Record<string, string>; maxFileSize?: number },
) {
  const fetch = mockFetch(served);
  const fs = new HttpFs("https://cdn.test", files, { fetch, ...options });
  return { fs, fetch };
}

// ---------------------------------------------------------------------------
// Tree construction
// ---------------------------------------------------------------------------

describe("HttpFs", () => {
  describe("tree construction", () => {
    it("builds directories from file paths", async () => {
      const { fs } = createFs(
        ["src/index.ts", "src/utils.ts", "README.md"],
        {},
      );

      expect(await fs.exists("/")).toBe(true);
      expect(await fs.exists("/src")).toBe(true);
      expect(await fs.exists("/src/index.ts")).toBe(true);
      expect(await fs.exists("/README.md")).toBe(true);
      expect(await fs.exists("/nope")).toBe(false);
    });

    it("accepts paths with leading slashes", async () => {
      const { fs } = createFs(["/a/b.txt", "/c.txt"], {});

      expect(await fs.exists("/a")).toBe(true);
      expect(await fs.exists("/a/b.txt")).toBe(true);
      expect(await fs.exists("/c.txt")).toBe(true);
    });

    it("accepts a record with metadata", async () => {
      const fetch = mockFetch({});
      const fs = new HttpFs(
        "https://cdn.test",
        { "data.csv": { size: 999 } },
        { fetch },
      );

      const stat = await fs.stat("/data.csv");
      expect(stat.size).toBe(999);
      expect(stat.isFile).toBe(true);
    });

    it("handles explicit directory entries (trailing slash)", async () => {
      const { fs } = createFs(["empty/", "empty/sub/"], {});

      expect(await fs.exists("/empty")).toBe(true);
      expect((await fs.stat("/empty")).isDirectory).toBe(true);
      expect(await fs.exists("/empty/sub")).toBe(true);
      expect((await fs.stat("/empty/sub")).isDirectory).toBe(true);
    });

    it("handles deeply nested paths", async () => {
      const { fs } = createFs(["a/b/c/d/e.txt"], {});

      expect(await fs.exists("/a")).toBe(true);
      expect(await fs.exists("/a/b")).toBe(true);
      expect(await fs.exists("/a/b/c")).toBe(true);
      expect(await fs.exists("/a/b/c/d")).toBe(true);
      expect(await fs.exists("/a/b/c/d/e.txt")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Reading files
  // ---------------------------------------------------------------------------

  describe("readFile", () => {
    it("fetches on first read, caches on second", async () => {
      const { fs, fetch } = createFs(["hello.txt"], {
        "/hello.txt": "Hello, world!",
      });

      const first = await fs.readFile("/hello.txt");
      expect(first).toBe("Hello, world!");
      expect(fetch).toHaveBeenCalledTimes(1);

      const second = await fs.readFile("/hello.txt");
      expect(second).toBe("Hello, world!");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("fetches binary content via readFileBuffer", async () => {
      const bytes = new Uint8Array([0x00, 0xff, 0x42]);
      const fetch = mockFetch({ "/bin.dat": bytes });
      const fs = new HttpFs("https://cdn.test", ["bin.dat"], { fetch });

      const buf = await fs.readFileBuffer("/bin.dat");
      expect(buf).toEqual(bytes);
    });

    it("throws ENOENT for files not in manifest", async () => {
      const { fs } = createFs(["a.txt"], {});
      await expect(fs.readFile("/missing.txt")).rejects.toThrow("ENOENT");
    });

    it("throws ENOENT when server returns 404", async () => {
      const { fs } = createFs(["ghost.txt"], {});
      await expect(fs.readFile("/ghost.txt")).rejects.toThrow("ENOENT");
    });

    it("throws EISDIR when reading a directory", async () => {
      const { fs } = createFs(["dir/file.txt"], {});
      await expect(fs.readFile("/dir")).rejects.toThrow("EISDIR");
    });

    it("throws EFBIG for oversized files", async () => {
      const fetch = mockFetch({ "/big.txt": "x".repeat(100) });
      const fs = new HttpFs("https://cdn.test", ["big.txt"], {
        fetch,
        maxFileSize: 10,
      });

      await expect(fs.readFile("/big.txt")).rejects.toThrow("EFBIG");
    });
  });

  // ---------------------------------------------------------------------------
  // stat / lstat
  // ---------------------------------------------------------------------------

  describe("stat", () => {
    it("returns file stats", async () => {
      const fetch = mockFetch({});
      const fs = new HttpFs(
        "https://cdn.test",
        { "f.txt": { size: 42 } },
        { fetch },
      );

      const s = await fs.stat("/f.txt");
      expect(s.isFile).toBe(true);
      expect(s.isDirectory).toBe(false);
      expect(s.isSymbolicLink).toBe(false);
      expect(s.size).toBe(42);
      expect(s.mode).toBe(0o644);
    });

    it("returns directory stats", async () => {
      const { fs } = createFs(["d/x.txt"], {});

      const s = await fs.stat("/d");
      expect(s.isFile).toBe(false);
      expect(s.isDirectory).toBe(true);
      expect(s.mode).toBe(0o755);
    });

    it("updates size after fetch", async () => {
      const { fs } = createFs(["f.txt"], { "/f.txt": "abcdef" });

      expect((await fs.stat("/f.txt")).size).toBe(0);
      await fs.readFile("/f.txt");
      expect((await fs.stat("/f.txt")).size).toBe(6);
    });

    it("throws ENOENT for missing paths", async () => {
      const { fs } = createFs([], {});
      await expect(fs.stat("/nope")).rejects.toThrow("ENOENT");
    });

    it("lstat behaves like stat (no symlinks)", async () => {
      const { fs } = createFs(["a.txt"], {});
      const stat = await fs.stat("/a.txt");
      const lstat = await fs.lstat("/a.txt");
      expect(stat).toEqual(lstat);
    });
  });

  // ---------------------------------------------------------------------------
  // readdir / readdirWithFileTypes
  // ---------------------------------------------------------------------------

  describe("readdir", () => {
    it("lists directory contents sorted", async () => {
      const { fs } = createFs(["z.txt", "a.txt", "m/nested.txt"], {});

      expect(await fs.readdir("/")).toEqual(["a.txt", "m", "z.txt"]);
      expect(await fs.readdir("/m")).toEqual(["nested.txt"]);
    });

    it("throws ENOENT for missing directories", async () => {
      const { fs } = createFs([], {});
      await expect(fs.readdir("/missing")).rejects.toThrow("ENOENT");
    });

    it("throws ENOTDIR for files", async () => {
      const { fs } = createFs(["f.txt"], {});
      await expect(fs.readdir("/f.txt")).rejects.toThrow("ENOTDIR");
    });
  });

  describe("readdirWithFileTypes", () => {
    it("returns entries with type info", async () => {
      const { fs } = createFs(["dir/a.txt", "dir/sub/b.txt"], {});

      const entries = await fs.readdirWithFileTypes("/dir");
      expect(entries).toEqual([
        {
          name: "a.txt",
          isFile: true,
          isDirectory: false,
          isSymbolicLink: false,
        },
        {
          name: "sub",
          isFile: false,
          isDirectory: true,
          isSymbolicLink: false,
        },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // Path resolution
  // ---------------------------------------------------------------------------

  describe("resolvePath", () => {
    it("resolves absolute paths", () => {
      const { fs } = createFs([], {});
      expect(fs.resolvePath("/foo", "/bar")).toBe("/bar");
    });

    it("resolves relative paths against base", () => {
      const { fs } = createFs([], {});
      expect(fs.resolvePath("/foo", "bar")).toBe("/foo/bar");
      expect(fs.resolvePath("/", "bar")).toBe("/bar");
    });

    it("handles .. and .", () => {
      const { fs } = createFs([], {});
      expect(fs.resolvePath("/a/b", "../c")).toBe("/a/c");
      expect(fs.resolvePath("/a/b", "./c")).toBe("/a/b/c");
    });
  });

  describe("getAllPaths", () => {
    it("returns all paths sorted", () => {
      const { fs } = createFs(["b.txt", "a/c.txt"], {});
      expect(fs.getAllPaths()).toEqual(["/", "/a", "/a/c.txt", "/b.txt"]);
    });
  });

  describe("realpath", () => {
    it("returns normalized path for existing entries", async () => {
      const { fs } = createFs(["a.txt"], {});
      expect(await fs.realpath("/a.txt")).toBe("/a.txt");
      expect(await fs.realpath("/")).toBe("/");
    });

    it("throws ENOENT for missing paths", async () => {
      const { fs } = createFs([], {});
      await expect(fs.realpath("/nope")).rejects.toThrow("ENOENT");
    });
  });

  // ---------------------------------------------------------------------------
  // Write operations (all EROFS)
  // ---------------------------------------------------------------------------

  describe("write operations throw EROFS", () => {
    it("writeFile", async () => {
      const { fs } = createFs([], {});
      await expect(fs.writeFile("/x", "y")).rejects.toThrow("EROFS");
    });

    it("appendFile", async () => {
      const { fs } = createFs([], {});
      await expect(fs.appendFile("/x", "y")).rejects.toThrow("EROFS");
    });

    it("mkdir", async () => {
      const { fs } = createFs([], {});
      await expect(fs.mkdir("/x")).rejects.toThrow("EROFS");
    });

    it("rm", async () => {
      const { fs } = createFs(["a.txt"], {});
      await expect(fs.rm("/a.txt")).rejects.toThrow("EROFS");
    });

    it("cp", async () => {
      const { fs } = createFs(["a.txt"], {});
      await expect(fs.cp("/a.txt", "/b.txt")).rejects.toThrow("EROFS");
    });

    it("mv", async () => {
      const { fs } = createFs(["a.txt"], {});
      await expect(fs.mv("/a.txt", "/b.txt")).rejects.toThrow("EROFS");
    });

    it("chmod", async () => {
      const { fs } = createFs(["a.txt"], {});
      await expect(fs.chmod("/a.txt", 0o777)).rejects.toThrow("EROFS");
    });

    it("symlink", async () => {
      const { fs } = createFs([], {});
      await expect(fs.symlink("/a", "/b")).rejects.toThrow("EROFS");
    });

    it("link", async () => {
      const { fs } = createFs(["a.txt"], {});
      await expect(fs.link("/a.txt", "/b.txt")).rejects.toThrow("EROFS");
    });

    it("utimes", async () => {
      const { fs } = createFs(["a.txt"], {});
      const now = new Date();
      await expect(fs.utimes("/a.txt", now, now)).rejects.toThrow("EROFS");
    });

    it("readlink", async () => {
      const { fs } = createFs(["a.txt"], {});
      await expect(fs.readlink("/a.txt")).rejects.toThrow("EINVAL");
    });
  });

  // ---------------------------------------------------------------------------
  // Fetch behaviour
  // ---------------------------------------------------------------------------

  describe("fetch behaviour", () => {
    it("passes custom headers", async () => {
      const fetch = mockFetch({ "/secret.txt": "classified" });
      const fs = new HttpFs("https://cdn.test", ["secret.txt"], {
        fetch,
        headers: { Authorization: "Bearer tok123" },
      });

      await fs.readFile("/secret.txt");

      const call = fetch.mock.calls[0] as unknown[];
      const init = call[1] as RequestInit | undefined;
      expect(init?.headers).toEqual(
        expect.objectContaining({ Authorization: "Bearer tok123" }),
      );
    });

    it("normalises base URL without trailing slash", async () => {
      const fetch = mockFetch({ "/data.json": "{}" });
      const fs = new HttpFs("https://cdn.test", ["data.json"], { fetch });

      await fs.readFile("/data.json");

      expect(fetch.mock.calls[0][0]).toBe("https://cdn.test/data.json");
    });

    it("normalises base URL with trailing slash", async () => {
      const fetch = mockFetch({ "/data.json": "{}" });
      const fs = new HttpFs("https://cdn.test/", ["data.json"], { fetch });

      await fs.readFile("/data.json");

      expect(fetch.mock.calls[0][0]).toBe("https://cdn.test/data.json");
    });

    it("constructs correct URLs for nested files", async () => {
      const fetch = mockFetch({ "/a/b/c.txt": "deep" });
      const fs = new HttpFs("https://cdn.test", ["a/b/c.txt"], { fetch });

      await fs.readFile("/a/b/c.txt");

      expect(fetch.mock.calls[0][0]).toBe("https://cdn.test/a/b/c.txt");
    });

    it("throws EIO for server errors", async () => {
      const fetch = vi.fn(async () => new Response("err", { status: 500 }));
      const fs = new HttpFs("https://cdn.test", ["f.txt"], { fetch });

      await expect(fs.readFile("/f.txt")).rejects.toThrow("EIO");
    });
  });

  // ---------------------------------------------------------------------------
  // prefetch
  // ---------------------------------------------------------------------------

  describe("prefetch", () => {
    it("eagerly fetches all files", async () => {
      const { fs, fetch } = createFs(["a.txt", "b.txt"], {
        "/a.txt": "A",
        "/b.txt": "B",
      });

      await fs.prefetch();

      expect(fetch).toHaveBeenCalledTimes(2);

      const a = await fs.readFile("/a.txt");
      const b = await fs.readFile("/b.txt");
      expect(a).toBe("A");
      expect(b).toBe("B");
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });
});
