import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../in-memory-fs/in-memory-fs.js";
import { MountableFs } from "../mountable-fs/mountable-fs.js";
import type { VirtualFsSource } from "./virtual-fs.js";
import { VirtualFs, defineVirtualFs } from "./virtual-fs.js";

// ── helpers ────────────────────────────────────────────────

function createReportSource(): VirtualFsSource {
  const reports: Record<string, string> = {
    "report-1": "Status: OK\nMetric: 42\n",
    "report-2": "Status: ERROR\nMetric: 0\n",
    "report-3": "Status: WARN\nMetric: 17\n",
  };

  return {
    async readFile(path) {
      const name = path.slice(1);
      return reports[name] ?? null;
    },
    async readdir(path) {
      if (path === "/") {
        return Object.keys(reports).map((name) => ({
          name,
          isFile: true,
          isDirectory: false,
        }));
      }
      return null;
    },
  };
}

function createNestedSource(): VirtualFsSource {
  return {
    async readFile(path) {
      if (path === "/cpu/node-1.txt") return "usage: 45%\n";
      if (path === "/cpu/node-2.txt") return "usage: 89%\n";
      if (path === "/status.json") return '{"ok":true}\n';
      return null;
    },
    async readdir(path) {
      if (path === "/") {
        return [
          { name: "cpu", isFile: false, isDirectory: true },
          { name: "status.json", isFile: true, isDirectory: false },
        ];
      }
      if (path === "/cpu") {
        return [
          { name: "node-1.txt", isFile: true, isDirectory: false },
          { name: "node-2.txt", isFile: true, isDirectory: false },
        ];
      }
      return null;
    },
  };
}

// ── tests ──────────────────────────────────────────────────

describe("VirtualFs", () => {
  // ── readFile ─────────────────────────────────────────────

  describe("readFile", () => {
    it("should return content for an existing file", async () => {
      const fs = new VirtualFs(createReportSource());
      const content = await fs.readFile("/report-1");
      expect(content).toBe("Status: OK\nMetric: 42\n");
    });

    it("should throw ENOENT for missing files", async () => {
      const fs = new VirtualFs(createReportSource());
      await expect(fs.readFile("/missing")).rejects.toThrow("ENOENT");
    });

    it("should handle Uint8Array content", async () => {
      const bytes = new TextEncoder().encode("binary data");
      const fs = new VirtualFs({
        async readFile() {
          return bytes;
        },
        async readdir() {
          return null;
        },
      });
      const content = await fs.readFile("/file");
      expect(content).toBe("binary data");
    });

    it("should normalize paths", async () => {
      const fs = new VirtualFs(createReportSource());
      const content = await fs.readFile("/./report-1");
      expect(content).toBe("Status: OK\nMetric: 42\n");
    });
  });

  // ── readFileBuffer ───────────────────────────────────────

  describe("readFileBuffer", () => {
    it("should return Uint8Array for string content", async () => {
      const fs = new VirtualFs(createReportSource());
      const buf = await fs.readFileBuffer("/report-1");
      expect(buf).toBeInstanceOf(Uint8Array);
      expect(new TextDecoder().decode(buf)).toBe("Status: OK\nMetric: 42\n");
    });

    it("should pass through Uint8Array content", async () => {
      const original = new Uint8Array([0x00, 0xff, 0x42]);
      const fs = new VirtualFs({
        async readFile() {
          return original;
        },
        async readdir() {
          return null;
        },
      });
      const buf = await fs.readFileBuffer("/bin");
      expect(buf).toBe(original);
    });

    it("should throw ENOENT for missing files", async () => {
      const fs = new VirtualFs(createReportSource());
      await expect(fs.readFileBuffer("/nope")).rejects.toThrow("ENOENT");
    });
  });

  // ── readdir ──────────────────────────────────────────────

  describe("readdir", () => {
    it("should return sorted entry names", async () => {
      const fs = new VirtualFs(createReportSource());
      const entries = await fs.readdir("/");
      expect(entries).toEqual(["report-1", "report-2", "report-3"]);
    });

    it("should throw ENOENT for non-directories", async () => {
      const fs = new VirtualFs(createReportSource());
      await expect(fs.readdir("/report-1")).rejects.toThrow("ENOENT");
    });

    it("should handle nested directories", async () => {
      const fs = new VirtualFs(createNestedSource());
      expect(await fs.readdir("/")).toEqual(["cpu", "status.json"]);
      expect(await fs.readdir("/cpu")).toEqual(["node-1.txt", "node-2.txt"]);
    });
  });

  // ── readdirWithFileTypes ─────────────────────────────────

  describe("readdirWithFileTypes", () => {
    it("should return DirentEntry with isSymbolicLink: false", async () => {
      const fs = new VirtualFs(createNestedSource());
      const entries = await fs.readdirWithFileTypes("/");
      expect(entries).toEqual([
        { name: "cpu", isFile: false, isDirectory: true, isSymbolicLink: false },
        {
          name: "status.json",
          isFile: true,
          isDirectory: false,
          isSymbolicLink: false,
        },
      ]);
    });

    it("should throw ENOENT for non-directories", async () => {
      const fs = new VirtualFs(createReportSource());
      await expect(fs.readdirWithFileTypes("/missing")).rejects.toThrow(
        "ENOENT",
      );
    });
  });

  // ── stat (derived) ──────────────────────────────────────

  describe("stat (derived from readdir/readFile)", () => {
    it("should return directory stat for root", async () => {
      const fs = new VirtualFs(createReportSource());
      const s = await fs.stat("/");
      expect(s.isDirectory).toBe(true);
      expect(s.isFile).toBe(false);
    });

    it("should return directory stat when readdir succeeds", async () => {
      const fs = new VirtualFs(createNestedSource());
      const s = await fs.stat("/cpu");
      expect(s.isDirectory).toBe(true);
    });

    it("should return file stat when readFile succeeds", async () => {
      const fs = new VirtualFs(createReportSource());
      const s = await fs.stat("/report-1");
      expect(s.isFile).toBe(true);
      expect(s.isDirectory).toBe(false);
      expect(s.size).toBeGreaterThan(0);
    });

    it("should compute correct byte size for string content", async () => {
      const fs = new VirtualFs({
        async readFile(path) {
          return path === "/emoji.txt" ? "café ☕" : null;
        },
        async readdir() {
          return null;
        },
      });
      const s = await fs.stat("/emoji.txt");
      expect(s.size).toBe(new TextEncoder().encode("café ☕").length);
    });

    it("should throw ENOENT for missing paths", async () => {
      const fs = new VirtualFs(createReportSource());
      await expect(fs.stat("/nope")).rejects.toThrow("ENOENT");
    });
  });

  // ── stat (user-provided) ────────────────────────────────

  describe("stat (user-provided hook)", () => {
    it("should delegate to source.stat when provided", async () => {
      const customStat = {
        isFile: true,
        isDirectory: false,
        isSymbolicLink: false,
        mode: 0o444,
        size: 999,
        mtime: new Date("2025-01-01"),
      };
      const fs = new VirtualFs({
        async readFile() {
          return "data";
        },
        async readdir() {
          return null;
        },
        async stat(path) {
          return path === "/special" ? customStat : null;
        },
      });
      const s = await fs.stat("/special");
      expect(s).toEqual(customStat);
    });

    it("should throw ENOENT when source.stat returns null", async () => {
      const fs = new VirtualFs({
        async readFile() {
          return null;
        },
        async readdir() {
          return null;
        },
        async stat() {
          return null;
        },
      });
      await expect(fs.stat("/gone")).rejects.toThrow("ENOENT");
    });

    it("should still return directory for root even if source.stat returns null", async () => {
      const fs = new VirtualFs({
        async readFile() {
          return null;
        },
        async readdir() {
          return null;
        },
        async stat() {
          return null;
        },
      });
      const s = await fs.stat("/");
      expect(s.isDirectory).toBe(true);
    });
  });

  // ── exists ──────────────────────────────────────────────

  describe("exists", () => {
    it("should return true for existing files (derived)", async () => {
      const fs = new VirtualFs(createReportSource());
      expect(await fs.exists("/report-1")).toBe(true);
    });

    it("should return true for root (derived)", async () => {
      const fs = new VirtualFs(createReportSource());
      expect(await fs.exists("/")).toBe(true);
    });

    it("should return false for missing paths (derived)", async () => {
      const fs = new VirtualFs(createReportSource());
      expect(await fs.exists("/missing")).toBe(false);
    });

    it("should delegate to source.exists when provided", async () => {
      const spy = vi.fn(async (path: string) => path === "/found");
      const fs = new VirtualFs({
        async readFile() {
          return null;
        },
        async readdir() {
          return null;
        },
        exists: spy,
      });
      expect(await fs.exists("/found")).toBe(true);
      expect(await fs.exists("/lost")).toBe(false);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  // ── lstat ───────────────────────────────────────────────

  describe("lstat", () => {
    it("should delegate to stat", async () => {
      const fs = new VirtualFs(createReportSource());
      const s = await fs.lstat("/report-2");
      expect(s.isFile).toBe(true);
    });
  });

  // ── realpath ────────────────────────────────────────────

  describe("realpath", () => {
    it("should return normalized path for existing files", async () => {
      const fs = new VirtualFs(createReportSource());
      expect(await fs.realpath("/./report-1")).toBe("/report-1");
    });

    it("should throw ENOENT for missing paths", async () => {
      const fs = new VirtualFs(createReportSource());
      await expect(fs.realpath("/missing")).rejects.toThrow("ENOENT");
    });
  });

  // ── resolvePath ─────────────────────────────────────────

  describe("resolvePath", () => {
    it("should resolve relative paths", () => {
      const fs = new VirtualFs(createReportSource());
      expect(fs.resolvePath("/a", "b")).toBe("/a/b");
      expect(fs.resolvePath("/a/b", "../c")).toBe("/a/c");
    });

    it("should return absolute paths unchanged", () => {
      const fs = new VirtualFs(createReportSource());
      expect(fs.resolvePath("/a", "/b")).toBe("/b");
    });
  });

  // ── getAllPaths ──────────────────────────────────────────

  describe("getAllPaths", () => {
    it("should return empty array (dynamic content cannot be enumerated)", () => {
      const fs = new VirtualFs(createReportSource());
      expect(fs.getAllPaths()).toEqual([]);
    });
  });

  // ── read-only enforcement ───────────────────────────────

  describe("read-only enforcement (EROFS)", () => {
    const now = new Date();
    const ops: Array<[string, (fs: VirtualFs) => Promise<unknown>]> = [
      ["writeFile", (fs) => fs.writeFile("/x", "data")],
      ["appendFile", (fs) => fs.appendFile("/x", "data")],
      ["mkdir", (fs) => fs.mkdir("/x")],
      ["rm", (fs) => fs.rm("/x")],
      ["cp", (fs) => fs.cp("/a", "/b")],
      ["mv", (fs) => fs.mv("/a", "/b")],
      ["chmod", (fs) => fs.chmod("/x", 0o644)],
      ["symlink", (fs) => fs.symlink("/a", "/b")],
      ["link", (fs) => fs.link("/a", "/b")],
      ["utimes", (fs) => fs.utimes("/x", now, now)],
    ];

    for (const [name, op] of ops) {
      it(`${name} should throw EROFS when source has no hook`, async () => {
        const fs = new VirtualFs(createReportSource());
        await expect(op(fs)).rejects.toThrow("EROFS");
      });
    }
  });

  // ── write hooks ────────────────────────────────────────

  describe("write hooks (delegate to source)", () => {
    it("writeFile hook should be called with correct args", async () => {
      const spy = vi.fn(async () => {});
      const fs = new VirtualFs({ ...createReportSource(), writeFile: spy });
      await fs.writeFile("/new", "content");
      expect(spy).toHaveBeenCalledWith("/new", "content");
    });

    it("appendFile hook should be called", async () => {
      const spy = vi.fn(async () => {});
      const fs = new VirtualFs({ ...createReportSource(), appendFile: spy });
      await fs.appendFile("/file", "more");
      expect(spy).toHaveBeenCalledWith("/file", "more");
    });

    it("mkdir hook should be called", async () => {
      const spy = vi.fn(async () => {});
      const fs = new VirtualFs({ ...createReportSource(), mkdir: spy });
      await fs.mkdir("/dir", { recursive: true });
      expect(spy).toHaveBeenCalledWith("/dir", { recursive: true });
    });

    it("rm hook should be called", async () => {
      const spy = vi.fn(async () => {});
      const fs = new VirtualFs({ ...createReportSource(), rm: spy });
      await fs.rm("/file");
      expect(spy).toHaveBeenCalledWith("/file");
    });

    it("cp hook should be called", async () => {
      const spy = vi.fn(async () => {});
      const fs = new VirtualFs({ ...createReportSource(), cp: spy });
      await fs.cp("/a", "/b");
      expect(spy).toHaveBeenCalledWith("/a", "/b");
    });

    it("mv hook should be called", async () => {
      const spy = vi.fn(async () => {});
      const fs = new VirtualFs({ ...createReportSource(), mv: spy });
      await fs.mv("/old", "/new");
      expect(spy).toHaveBeenCalledWith("/old", "/new");
    });

    it("chmod hook should be called", async () => {
      const spy = vi.fn(async () => {});
      const fs = new VirtualFs({ ...createReportSource(), chmod: spy });
      await fs.chmod("/file", 0o755);
      expect(spy).toHaveBeenCalledWith("/file", 0o755);
    });

    it("symlink hook should be called", async () => {
      const spy = vi.fn(async () => {});
      const fs = new VirtualFs({ ...createReportSource(), symlink: spy });
      await fs.symlink("/target", "/link");
      expect(spy).toHaveBeenCalledWith("/target", "/link");
    });

    it("link hook should be called", async () => {
      const spy = vi.fn(async () => {});
      const fs = new VirtualFs({ ...createReportSource(), link: spy });
      await fs.link("/existing", "/new");
      expect(spy).toHaveBeenCalledWith("/existing", "/new");
    });

    it("utimes hook should be called", async () => {
      const spy = vi.fn(async () => {});
      const now = new Date();
      const fs = new VirtualFs({ ...createReportSource(), utimes: spy });
      await fs.utimes("/file", now, now);
      expect(spy).toHaveBeenCalledWith("/file", now, now);
    });

    it("hook error should propagate", async () => {
      const fs = new VirtualFs({
        ...createReportSource(),
        async writeFile() {
          throw new Error("disk full");
        },
      });
      await expect(fs.writeFile("/x", "data")).rejects.toThrow("disk full");
    });

    it("partial hooks: provided hook delegates, missing rejects with EROFS", async () => {
      const writeSpy = vi.fn(async () => {});
      const fs = new VirtualFs({
        ...createReportSource(),
        writeFile: writeSpy,
      });
      await fs.writeFile("/ok", "data");
      expect(writeSpy).toHaveBeenCalledOnce();
      await expect(fs.mkdir("/dir")).rejects.toThrow("EROFS");
      await expect(fs.rm("/file")).rejects.toThrow("EROFS");
    });
  });

  // ── readlink ────────────────────────────────────────────

  describe("readlink", () => {
    it("should throw EINVAL", async () => {
      const fs = new VirtualFs(createReportSource());
      await expect(fs.readlink("/report-1")).rejects.toThrow("EINVAL");
    });
  });

  // ── defineVirtualFs ─────────────────────────────────────

  describe("defineVirtualFs", () => {
    it("should create a parameterized factory", async () => {
      const factory = defineVirtualFs((opts: { prefix: string }) => ({
        async readFile(path) {
          return `${opts.prefix}:${path}`;
        },
        async readdir() {
          return null;
        },
      }));

      const source = factory({ prefix: "test" });
      const fs = new VirtualFs(source);
      expect(await fs.readFile("/hello")).toBe("test:/hello");
    });
  });

  // ── dispose ─────────────────────────────────────────────

  describe("dispose", () => {
    it("should call source.dispose when provided", async () => {
      const disposeFn = vi.fn(async () => {});
      const fs = new VirtualFs({
        ...createReportSource(),
        dispose: disposeFn,
      });
      await fs.dispose();
      expect(disposeFn).toHaveBeenCalledOnce();
    });

    it("should succeed when source has no dispose", async () => {
      const fs = new VirtualFs(createReportSource());
      await expect(fs.dispose()).resolves.toBeUndefined();
    });
  });

  // ── MountableFs integration ─────────────────────────────

  describe("MountableFs integration", () => {
    it("should serve files through a mount point", async () => {
      const mfs = new MountableFs({
        mounts: [
          {
            mountPoint: "/reports",
            filesystem: new VirtualFs(createReportSource()),
          },
        ],
      });
      const content = await mfs.readFile("/reports/report-1");
      expect(content).toBe("Status: OK\nMetric: 42\n");
    });

    it("should list entries through a mount point", async () => {
      const mfs = new MountableFs({
        mounts: [
          {
            mountPoint: "/reports",
            filesystem: new VirtualFs(createReportSource()),
          },
        ],
      });
      const entries = await mfs.readdir("/reports");
      expect(entries).toEqual(["report-1", "report-2", "report-3"]);
    });

    it("should coexist with regular files on the base fs", async () => {
      const base = new InMemoryFs({ "/readme.txt": "hello" });
      const mfs = new MountableFs({
        base,
        mounts: [
          {
            mountPoint: "/data",
            filesystem: new VirtualFs(createReportSource()),
          },
        ],
      });
      expect(await mfs.readFile("/readme.txt")).toBe("hello");
      expect(await mfs.readFile("/data/report-1")).toContain("OK");
    });

    it("should handle nested virtual directories through mount", async () => {
      const mfs = new MountableFs({
        mounts: [
          {
            mountPoint: "/metrics",
            filesystem: new VirtualFs(createNestedSource()),
          },
        ],
      });
      expect(await mfs.readdir("/metrics")).toEqual(["cpu", "status.json"]);
      expect(await mfs.readdir("/metrics/cpu")).toEqual([
        "node-1.txt",
        "node-2.txt",
      ]);
      expect(await mfs.readFile("/metrics/cpu/node-1.txt")).toBe(
        "usage: 45%\n",
      );
    });
  });

  // ── Bash e2e ────────────────────────────────────────────

  describe("Bash e2e", () => {
    function createBash(): Bash {
      return new Bash({
        fs: new MountableFs({
          mounts: [
            {
              mountPoint: "/reports",
              filesystem: new VirtualFs(createReportSource()),
            },
            {
              mountPoint: "/metrics",
              filesystem: new VirtualFs(createNestedSource()),
            },
          ],
        }),
      });
    }

    it("ls should list virtual files", async () => {
      const bash = createBash();
      const result = await bash.exec("ls /reports");
      expect(result.stdout).toContain("report-1");
      expect(result.stdout).toContain("report-2");
      expect(result.stdout).toContain("report-3");
      expect(result.exitCode).toBe(0);
    });

    it("cat should read virtual file content", async () => {
      const bash = createBash();
      const result = await bash.exec("cat /reports/report-2");
      expect(result.stdout).toContain("ERROR");
      expect(result.exitCode).toBe(0);
    });

    it("cat should fail on missing virtual files", async () => {
      const bash = createBash();
      const result = await bash.exec("cat /reports/nope");
      expect(result.exitCode).not.toBe(0);
    });

    it("grep should search across virtual files", async () => {
      const bash = createBash();
      const result = await bash.exec("grep ERROR /reports/report-2");
      expect(result.stdout).toContain("ERROR");
      expect(result.exitCode).toBe(0);
    });

    it("wc should count lines in virtual files", async () => {
      const bash = createBash();
      const result = await bash.exec("wc -l /reports/report-1");
      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toContain("2");
    });

    it("pipelines should work with virtual files", async () => {
      const bash = createBash();
      const result = await bash.exec(
        "cat /reports/report-1 | grep Metric",
      );
      expect(result.stdout).toContain("42");
      expect(result.exitCode).toBe(0);
    });

    it("ls should list nested virtual directories", async () => {
      const bash = createBash();
      const result = await bash.exec("ls /metrics/cpu");
      expect(result.stdout).toContain("node-1.txt");
      expect(result.stdout).toContain("node-2.txt");
      expect(result.exitCode).toBe(0);
    });

    it("cat should read from nested virtual paths", async () => {
      const bash = createBash();
      const result = await bash.exec("cat /metrics/cpu/node-1.txt");
      expect(result.stdout).toBe("usage: 45%\n");
    });

    it("shell should not be able to write to virtual fs without hooks", async () => {
      const bash = createBash();
      await expect(
        bash.exec("echo hello > /reports/new-file"),
      ).rejects.toThrow("EROFS");
    });

    it("shell write should succeed when writeFile hook is provided", async () => {
      const written: Record<string, string> = {};
      const source: VirtualFsSource = {
        ...createReportSource(),
        async writeFile(path: string, content) {
          written[path] = String(content);
        },
      };
      const bash = new Bash({
        fs: new MountableFs({
          mounts: [
            { mountPoint: "/reports", filesystem: new VirtualFs(source) },
          ],
        }),
      });
      const result = await bash.exec("echo hello > /reports/new-file");
      expect(result.exitCode).toBe(0);
      expect(written["/new-file"]).toContain("hello");
    });
  });
});
