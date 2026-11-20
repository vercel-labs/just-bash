import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "read-write-fs-test-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("constructor", () => {
    it("should create with valid root directory", () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      expect(rwfs).toBeInstanceOf(ReadWriteFs);
    });

    it("should throw for non-existent root", () => {
      expect(() => {
        new ReadWriteFs({
          root: "/nonexistent/path/12345",
          allowSymlinks: true,
        });
      }).toThrow("does not exist");
    });

    it("should throw for file as root", () => {
      const filePath = path.join(tempDir, "file.txt");
      fs.writeFileSync(filePath, "content");
      expect(() => {
        new ReadWriteFs({ root: filePath, allowSymlinks: true });
      }).toThrow("not a directory");
    });
  });

  describe("reading files", () => {
    it("should read files from filesystem", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "real content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const content = await rwfs.readFile("/test.txt");
      expect(content).toBe("real content");
    });

    it("should read nested files", async () => {
      fs.mkdirSync(path.join(tempDir, "subdir"));
      fs.writeFileSync(path.join(tempDir, "subdir", "file.txt"), "nested");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const content = await rwfs.readFile("/subdir/file.txt");
      expect(content).toBe("nested");
    });

    it("should read files as buffer", async () => {
      const data = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      fs.writeFileSync(path.join(tempDir, "binary.bin"), data);
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const buffer = await rwfs.readFileBuffer("/binary.bin");
      expect(buffer).toEqual(new Uint8Array(data));
    });

    it("should throw ENOENT for non-existent file", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readFile("/nonexistent.txt")).rejects.toThrow("ENOENT");
    });

    it("should throw EISDIR when reading a directory", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readFile("/dir")).rejects.toThrow("EISDIR");
    });
  });

  describe("writing files", () => {
    it("should write files to filesystem", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/new.txt", "new content");

      // Should read back from filesystem
      const content = await rwfs.readFile("/new.txt");
      expect(content).toBe("new content");

      // Real filesystem should have the file
      expect(fs.readFileSync(path.join(tempDir, "new.txt"), "utf8")).toBe(
        "new content",
      );
    });

    it("should create parent directories when writing", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/deep/nested/file.txt", "content");

      expect(fs.existsSync(path.join(tempDir, "deep/nested/file.txt"))).toBe(
        true,
      );
    });

    it("should overwrite existing files", async () => {
      fs.writeFileSync(path.join(tempDir, "test.txt"), "original");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/test.txt", "modified");

      expect(fs.readFileSync(path.join(tempDir, "test.txt"), "utf8")).toBe(
        "modified",
      );
    });

    it("should overwrite a private writable file without replacing its directory entry", async () => {
      const dirPath = path.join(tempDir, "non-writable-dir");
      const filePath = path.join(dirPath, "writable.txt");
      fs.mkdirSync(dirPath);
      fs.writeFileSync(filePath, "original");
      fs.chmodSync(filePath, 0o666);
      fs.chmodSync(dirPath, 0o555);
      const rwfs = new ReadWriteFs({ root: tempDir });

      try {
        await rwfs.writeFile("/non-writable-dir/writable.txt", "modified");

        expect(fs.readFileSync(filePath, "utf8")).toBe("modified");
      } finally {
        fs.chmodSync(dirPath, 0o755);
      }
    });

    it("should write binary content", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      const data = new Uint8Array([0x00, 0x01, 0x02, 0xff]);

      await rwfs.writeFile("/binary.bin", data);

      const written = fs.readFileSync(path.join(tempDir, "binary.bin"));
      expect(new Uint8Array(written)).toEqual(data);
    });
  });

  describe("appending files", () => {
    it("should append to existing files", async () => {
      fs.writeFileSync(path.join(tempDir, "append.txt"), "start");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.appendFile("/append.txt", "-end");

      expect(fs.readFileSync(path.join(tempDir, "append.txt"), "utf8")).toBe(
        "start-end",
      );
    });

    it("should create file if it does not exist", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.appendFile("/new.txt", "content");

      expect(fs.readFileSync(path.join(tempDir, "new.txt"), "utf8")).toBe(
        "content",
      );
    });
  });

  describe("exists", () => {
    it("should return true for existing files", async () => {
      fs.writeFileSync(path.join(tempDir, "exists.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      expect(await rwfs.exists("/exists.txt")).toBe(true);
    });

    it("should return true for existing directories", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      expect(await rwfs.exists("/dir")).toBe(true);
    });

    it("should return false for non-existent paths", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      expect(await rwfs.exists("/nonexistent")).toBe(false);
    });
  });

  describe("stat", () => {
    it("should stat files", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const stat = await rwfs.stat("/file.txt");
      expect(stat.isFile).toBe(true);
      expect(stat.isDirectory).toBe(false);
      expect(stat.size).toBe(7);
    });

    it("should stat directories", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const stat = await rwfs.stat("/dir");
      expect(stat.isFile).toBe(false);
      expect(stat.isDirectory).toBe(true);
    });

    it("should throw ENOENT for non-existent paths", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.stat("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw ENOTDIR (not 'outside sandbox') when a file is traversed as a directory (fixes #745)", async () => {
      fs.writeFileSync(path.join(tempDir, "notes.txt"), "hello\n");
      for (const allowSymlinks of [false, true]) {
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks });

        await expect(rwfs.stat("/notes.txt/child")).rejects.toMatchObject({
          code: "ENOTDIR",
          message: "ENOTDIR: not a directory, realpath '/notes.txt/child'",
        });
      }
    });

    it("should use the host system description for other in-root lookup errors", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      const longPath = `/${"a".repeat(1024)}`;

      await expect(rwfs.stat(longPath)).rejects.toMatchObject({
        code: "ENAMETOOLONG",
        message: `ENAMETOOLONG: name too long, realpath '${longPath}'`,
      });
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "reports an in-root permission failure without a host path",
      async () => {
        const locked = path.join(tempDir, "locked");
        fs.mkdirSync(locked);
        fs.writeFileSync(path.join(locked, "secret.txt"), "secret");
        const rwfs = new ReadWriteFs({ root: tempDir });
        fs.chmodSync(locked, 0);
        try {
          await expect(rwfs.stat("/locked/secret.txt")).rejects.toMatchObject({
            code: "EACCES",
            message: "EACCES: permission denied, realpath '/locked/secret.txt'",
          });
        } finally {
          fs.chmodSync(locked, 0o700);
        }
      },
    );

    it("should reject a symlink loop without exposing its errno", async () => {
      try {
        fs.symlinkSync("loop-b", path.join(tempDir, "loop-a"));
        fs.symlinkSync("loop-a", path.join(tempDir, "loop-b"));
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      for (const allowSymlinks of [false, true]) {
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks });
        for (const suffix of ["", "/child"]) {
          const error = await rwfs.stat(`/loop-a${suffix}`).catch((e) => e);
          expect(error.message).toBe(
            `EACCES: permission denied, '/loop-a${suffix}' resolves outside sandbox`,
          );
          expect(error.code).toBeUndefined();
        }
      }
    });

    it("should not surface ENOTDIR for a failure past a symlink that escapes the root (review #767)", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.writeFileSync(path.join(outsideDir, "shadow"), "secret");
        try {
          fs.symlinkSync(outsideDir, path.join(tempDir, "escape-link"));
        } catch {
          // Skip on systems that don't support symlinks
          return;
        }
        for (const allowSymlinks of [false, true]) {
          const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks });
          const error = await rwfs
            .stat("/escape-link/shadow/child")
            .catch((e) => e);
          expect(error.message).toBe(
            "EACCES: permission denied, '/escape-link/shadow/child' resolves outside sandbox",
          );
          expect(error.code).toBeUndefined();
        }
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });

    it("rejects an ENOTDIR after the root is replaced by an outside symlink", async () => {
      const root = path.join(tempDir, "root");
      const relocated = path.join(tempDir, "relocated");
      const outside = path.join(tempDir, "outside");
      fs.mkdirSync(root);
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(root, "sensitive"), "inside");
      fs.writeFileSync(path.join(outside, "sensitive"), "outside");
      const rwfs = new ReadWriteFs({ root, allowSymlinks: true });
      fs.renameSync(root, relocated);
      fs.symlinkSync(outside, root);

      const error = await rwfs.stat("/sensitive/child").catch((e) => e);
      expect(error.message).toBe(
        "EACCES: permission denied, '/sensitive/child' resolves outside sandbox",
      );
      expect(error.code).toBeUndefined();
    });

    it("reports only verified in-root failures without copying host error text", () => {
      const root = fs.realpathSync(tempDir);
      const blocked = path.join(root, "blocked");
      const sourceUrl = pathToFileURL(
        path.resolve("src/fs/read-write-fs/read-write-fs.ts"),
      ).href;
      const script = `
        const fs = require("node:fs");
        const { ReadWriteFs } = require(${JSON.stringify(sourceUrl)});
        const box = new ReadWriteFs({ root: ${JSON.stringify(root)} });
        const realpathSync = fs.realpathSync;
        const lstatSync = fs.lstatSync;
        const blockedIsSymlink = process.argv[1] === "symlink";
        const errnos = new Map([...require("node:util").getSystemErrorMap()]
          .map(([errno, [code]]) => [code, errno]));
        let realpathCode = "ENOTDIR";
        fs.realpathSync = (target, ...args) => {
          if (target === ${JSON.stringify(path.join(blocked, "child"))}) {
            throw Object.assign(new Error(realpathCode + ": " + target + ", realpath"), { code: realpathCode, errno: errnos.get(realpathCode) });
          }
          return realpathSync(target, ...args);
        };
        fs.lstatSync = (target, ...args) => {
          if (target === ${JSON.stringify(blocked)}) {
            if (blockedIsSymlink) return { isSymbolicLink: () => true };
            const code = realpathCode === "ENOTDIR" ? "ERR_ACCESS_DENIED" : realpathCode;
            throw Object.assign(new Error("denied"), { code, resource: target });
          }
          return lstatSync(target, ...args);
        };
        (async () => {
          const results = [];
          for (realpathCode of ["ENOTDIR", "ERR_ACCESS_DENIED", "ELOOP", "EACCES", "ENAMETOOLONG"]) {
            for (const operation of ["stat", "realpath"]) {
              try { await box[operation]("/blocked/child"); } catch (error) {
                results.push({ code: error.code ?? null, message: error.message });
              }
            }
          }
          process.stdout.write(JSON.stringify(results));
        })();
      `;
      const genericStat = {
        code: null,
        message:
          "EACCES: permission denied, '/blocked/child' resolves outside sandbox",
      };
      const genericRealpath = {
        code: null,
        message: "ENOENT: no such file or directory, realpath '/blocked/child'",
      };
      const genericResults = Array.from({ length: 5 }, () => [
        genericStat,
        genericRealpath,
      ]).flat();
      const run = (scenario: string) =>
        JSON.parse(
          execFileSync(
            process.execPath,
            ["--import=tsx", "-e", script, scenario],
            { encoding: "utf8" },
          ),
        );

      expect(run("denied")).toEqual([
        ...genericResults.slice(0, 6),
        {
          code: "EACCES",
          message: "EACCES: permission denied, realpath '/blocked/child'",
        },
        {
          code: "EACCES",
          message: "EACCES: permission denied, realpath '/blocked/child'",
        },
        {
          code: "ENAMETOOLONG",
          message: "ENAMETOOLONG: name too long, realpath '/blocked/child'",
        },
        {
          code: "ENAMETOOLONG",
          message: "ENAMETOOLONG: name too long, realpath '/blocked/child'",
        },
      ]);
      expect(run("symlink")).toEqual(genericResults);
    });
  });

  describe("realpath", () => {
    it("should keep ENOTDIR for a file traversed as a directory (review #767)", async () => {
      fs.writeFileSync(path.join(tempDir, "notes.txt"), "hello\n");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.realpath("/notes.txt/child")).rejects.toMatchObject({
        code: "ENOTDIR",
        message: "ENOTDIR: not a directory, realpath '/notes.txt/child'",
      });
    });

    it("should map a symlink loop rejection to ENOENT", async () => {
      try {
        fs.symlinkSync("loop-b", path.join(tempDir, "loop-a"));
        fs.symlinkSync("loop-a", path.join(tempDir, "loop-b"));
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.realpath("/loop-a")).rejects.toThrow(
        "ENOENT: no such file or directory, realpath '/loop-a'",
      );
    });

    it("does not map an uncoded realpath failure to ENOENT", () => {
      const root = fs.realpathSync(tempDir);
      const file = path.join(root, "file");
      const sourceUrl = pathToFileURL(
        path.resolve("src/fs/read-write-fs/read-write-fs.ts"),
      ).href;
      const script = `
        const fs = require("node:fs");
        const { ReadWriteFs } = require(${JSON.stringify(sourceUrl)});
        const box = new ReadWriteFs({ root: ${JSON.stringify(root)} });
        const original = fs.realpathSync;
        fs.realpathSync = (target, ...args) => {
          if (target === ${JSON.stringify(file)}) throw new Error("EACCES: private host path: " + target);
          return original(target, ...args);
        };
        box.realpath("/file").catch(error => process.stdout.write(error.message));
      `;
      const output = execFileSync(
        process.execPath,
        ["--import=tsx", "-e", script],
        { encoding: "utf8" },
      );

      expect(output).toBe("EIO: realpath '/file'");
    });

    it("sanitizes unexpected resolver errors instead of mapping them to ENOENT", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir });
      const resolver = rwfs as unknown as { resolveAndValidate: () => never };
      const error = Object.assign(
        new Error(`EACCES: private path ${tempDir}`),
        {
          code: "ERR_ACCESS_DENIED",
          resource: tempDir,
        },
      );
      vi.spyOn(resolver, "resolveAndValidate").mockImplementation(() => {
        throw error;
      });

      const caught = await rwfs.realpath("/file").catch((e) => e);
      expect(caught.message).toBe("ERR_ACCESS_DENIED: realpath '/file'");
      expect(caught.code).toBeUndefined();
      expect(caught.resource).toBeUndefined();
    });

    it("should still map genuine sandbox rejections to ENOENT (review #767)", async () => {
      const outsideDir = fs.mkdtempSync(
        path.join(os.tmpdir(), "rwfs-outside-"),
      );
      try {
        fs.writeFileSync(path.join(outsideDir, "shadow"), "secret");
        try {
          fs.symlinkSync(outsideDir, path.join(tempDir, "escape-link"));
        } catch {
          // Skip on systems that don't support symlinks
          return;
        }
        const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

        await expect(
          rwfs.realpath("/escape-link/shadow/child"),
        ).rejects.toThrow("ENOENT");
        await expect(rwfs.realpath("/nonexistent")).rejects.toThrow("ENOENT");
      } finally {
        fs.rmSync(outsideDir, { recursive: true, force: true });
      }
    });
  });

  describe("lstat", () => {
    it("should lstat symlinks without following", async () => {
      fs.writeFileSync(path.join(tempDir, "target.txt"), "content");
      try {
        fs.symlinkSync(
          path.join(tempDir, "target.txt"),
          path.join(tempDir, "link"),
        );
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const stat = await rwfs.lstat("/link");
      expect(stat.isSymbolicLink).toBe(true);
    });
  });

  describe("mkdir", () => {
    it("should create directories", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.mkdir("/newdir");

      expect(fs.statSync(path.join(tempDir, "newdir")).isDirectory()).toBe(
        true,
      );
    });

    it("should create nested directories with recursive option", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.mkdir("/a/b/c", { recursive: true });

      expect(fs.statSync(path.join(tempDir, "a/b/c")).isDirectory()).toBe(true);
    });

    it("should throw ENOENT without recursive for missing parent", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.mkdir("/missing/dir")).rejects.toThrow("ENOENT");
    });

    it("should throw EEXIST for existing directory without recursive", async () => {
      fs.mkdirSync(path.join(tempDir, "existing"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.mkdir("/existing")).rejects.toThrow("EEXIST");
    });
  });

  describe("readdir", () => {
    it("should list directory contents", async () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      fs.mkdirSync(path.join(tempDir, "subdir"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const entries = await rwfs.readdir("/");
      expect(entries).toContain("a.txt");
      expect(entries).toContain("b.txt");
      expect(entries).toContain("subdir");
    });

    it("should throw ENOENT for non-existent directory", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readdir("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw ENOTDIR for files", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readdir("/file.txt")).rejects.toThrow("ENOTDIR");
    });
  });

  describe("rm", () => {
    it("should delete files", async () => {
      fs.writeFileSync(path.join(tempDir, "delete.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.rm("/delete.txt");

      expect(fs.existsSync(path.join(tempDir, "delete.txt"))).toBe(false);
    });

    it("should delete directories recursively", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      fs.writeFileSync(path.join(tempDir, "dir", "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.rm("/dir", { recursive: true });

      expect(fs.existsSync(path.join(tempDir, "dir"))).toBe(false);
    });

    it("should throw ENOENT without force option", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.rm("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should not throw with force option for non-existent files", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(
        rwfs.rm("/nonexistent", { force: true }),
      ).resolves.not.toThrow();
    });
  });

  describe("cp", () => {
    it("should copy files", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.cp("/source.txt", "/dest.txt");

      expect(fs.readFileSync(path.join(tempDir, "dest.txt"), "utf8")).toBe(
        "content",
      );
    });

    it("should copy directories recursively", async () => {
      fs.mkdirSync(path.join(tempDir, "srcdir"));
      fs.writeFileSync(path.join(tempDir, "srcdir", "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.cp("/srcdir", "/destdir", { recursive: true });

      expect(
        fs.readFileSync(path.join(tempDir, "destdir", "file.txt"), "utf8"),
      ).toBe("content");
    });

    it("should throw ENOENT for non-existent source", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.cp("/nonexistent", "/dest")).rejects.toThrow("ENOENT");
    });

    it("should keep the failing destination path and .code during recursive copy", async () => {
      fs.mkdirSync(path.join(tempDir, "src"));
      fs.mkdirSync(path.join(tempDir, "src", "file"));
      fs.writeFileSync(path.join(tempDir, "src", "file", "child"), "data");
      fs.mkdirSync(path.join(tempDir, "dst", "file"), { recursive: true });
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      const destination = path.join(fs.realpathSync(tempDir), "dst", "file");
      const sourceDirectory = path.join(
        fs.realpathSync(tempDir),
        "src",
        "file",
      );
      let reads = 0;
      const originalReaddir = fs.promises.readdir.bind(fs.promises);
      vi.spyOn(fs.promises, "readdir").mockImplementation(async (...args) => {
        const entries = await originalReaddir(...args);
        // The first read is preflight; replace the destination during copy.
        if (args[0] === sourceDirectory && ++reads === 2) {
          fs.rmdirSync(destination);
          fs.writeFileSync(destination, "replaced");
        }
        return entries;
      });

      await expect(
        rwfs.cp("/src", "/dst", { recursive: true }),
      ).rejects.toMatchObject({
        code: "ENOTDIR",
        message: "ENOTDIR: not a directory, realpath '/dst/file/child'",
      });
    });

    it.each([
      "access denied",
      "EACCES: denied",
    ])("sanitizes pathless Node errors from recursive copy (%s)", async (message) => {
      fs.mkdirSync(path.join(tempDir, "src"));
      fs.writeFileSync(path.join(tempDir, "src", "file"), "data");
      const resource = path.join(tempDir, "private-resource");
      const originalOpen = fs.promises.open.bind(fs.promises);
      vi.spyOn(fs.promises, "open").mockImplementation(
        async (target, flags, mode) => {
          if (String(target).includes(".just-bash-write-")) {
            throw Object.assign(new Error(`${message} ${resource}`), {
              code: "ERR_ACCESS_DENIED",
              resource,
            });
          }
          return originalOpen(target, flags, mode);
        },
      );

      const error = await new ReadWriteFs({ root: tempDir })
        .cp("/src", "/dst", { recursive: true })
        .catch((e) => e);
      expect(error.message).toBe("ERR_ACCESS_DENIED: cp '/src'");
      expect(error.code).toBeUndefined();
      expect(error.resource).toBeUndefined();
    });
  });

  describe("mv", () => {
    it("should move files", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.mv("/source.txt", "/dest.txt");

      expect(fs.existsSync(path.join(tempDir, "source.txt"))).toBe(false);
      expect(fs.readFileSync(path.join(tempDir, "dest.txt"), "utf8")).toBe(
        "content",
      );
    });

    it("should move directories", async () => {
      fs.mkdirSync(path.join(tempDir, "srcdir"));
      fs.writeFileSync(path.join(tempDir, "srcdir", "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.mv("/srcdir", "/destdir");

      expect(fs.existsSync(path.join(tempDir, "srcdir"))).toBe(false);
      expect(
        fs.readFileSync(path.join(tempDir, "destdir", "file.txt"), "utf8"),
      ).toBe("content");
    });
  });

  describe("chmod", () => {
    it("should change file permissions", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.chmod("/file.txt", 0o755);

      const stat = fs.statSync(path.join(tempDir, "file.txt"));
      expect(stat.mode & 0o777).toBe(0o755);
    });

    it("should throw ENOENT for non-existent file", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.chmod("/nonexistent", 0o755)).rejects.toThrow("ENOENT");
    });

    it("should preserve special mode bits through replacement", async () => {
      const filePath = path.join(tempDir, "special-mode.txt");
      fs.writeFileSync(filePath, "content");
      const rwfs = new ReadWriteFs({ root: tempDir });

      await rwfs.chmod("/special-mode.txt", 0o4755);

      expect(fs.statSync(filePath).mode & 0o7777).toBe(0o4755);
    });

    it("should allow metadata operations above maxFileReadSize", async () => {
      const filePath = path.join(tempDir, "large-metadata.txt");
      fs.writeFileSync(filePath, "content larger than four bytes");
      const changed = new Date("2020-05-01T00:00:00.000Z");
      const rwfs = new ReadWriteFs({ root: tempDir, maxFileReadSize: 4 });

      await rwfs.chmod("/large-metadata.txt", 0o700);
      await rwfs.utimes("/large-metadata.txt", changed, changed);

      const stat = fs.statSync(filePath);
      expect(stat.mode & 0o777).toBe(0o700);
      expect(stat.mtimeMs).toBe(changed.getTime());
    });
  });

  describe("symlink", () => {
    it("should create symbolic links", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      try {
        await rwfs.symlink("target.txt", "/link");
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }

      const target = fs.readlinkSync(path.join(tempDir, "link"));
      expect(target).toBe("target.txt");
    });

    it("should throw EEXIST for existing path", async () => {
      fs.writeFileSync(path.join(tempDir, "existing"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.symlink("target", "/existing")).rejects.toThrow(
        "EEXIST",
      );
    });

    it("should write through an allowed dangling symlink within the root", async () => {
      fs.symlinkSync("target.txt", path.join(tempDir, "link.txt"));
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/link.txt", "created");

      expect(fs.readlinkSync(path.join(tempDir, "link.txt"))).toBe(
        "target.txt",
      );
      expect(fs.readFileSync(path.join(tempDir, "target.txt"), "utf8")).toBe(
        "created",
      );
    });

    it("should write through an allowed absolute dangling symlink within the root", async () => {
      fs.symlinkSync(
        path.join(tempDir, "target.txt"),
        path.join(tempDir, "link"),
      );
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.writeFile("/link", "created");

      expect(fs.readFileSync(path.join(tempDir, "target.txt"), "utf8")).toBe(
        "created",
      );
    });

    it("preserves writes through a dangling link spelled through a root alias", async () => {
      const root = path.join(tempDir, "root");
      const alias = path.join(tempDir, "alias");
      fs.mkdirSync(path.join(root, "sub"), { recursive: true });
      fs.symlinkSync(root, alias);
      fs.symlinkSync(`${alias}/sub/../new`, path.join(root, "link"));

      await new ReadWriteFs({ root: alias, allowSymlinks: true }).writeFile(
        "/link",
        "created",
      );

      expect(fs.readFileSync(path.join(root, "new"), "utf8")).toBe("created");
    });
  });

  describe("link", () => {
    it("should create hard links", async () => {
      fs.writeFileSync(path.join(tempDir, "original.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await rwfs.link("/original.txt", "/hardlink.txt");

      const content = fs.readFileSync(
        path.join(tempDir, "hardlink.txt"),
        "utf8",
      );
      expect(content).toBe("content");
    });

    it("should throw ENOENT for non-existent source", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.link("/nonexistent", "/link")).rejects.toThrow(
        "ENOENT",
      );
    });

    it("should throw EEXIST for existing destination", async () => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "content");
      fs.writeFileSync(path.join(tempDir, "existing.txt"), "existing");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.link("/source.txt", "/existing.txt")).rejects.toThrow(
        "EEXIST",
      );
    });
  });

  describe("readlink", () => {
    it("should read symlink target", async () => {
      try {
        fs.symlinkSync("target.txt", path.join(tempDir, "link"));
      } catch {
        // Skip on systems that don't support symlinks
        return;
      }
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const target = await rwfs.readlink("/link");
      expect(target).toBe("target.txt");
    });

    it("should throw ENOENT for non-existent symlink", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      await expect(rwfs.readlink("/nonexistent")).rejects.toThrow("ENOENT");
    });

    it("should throw EINVAL for non-symlink", async () => {
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.readlink("/file.txt")).rejects.toThrow("EINVAL");
    });
  });

  describe("resolvePath", () => {
    it("should resolve relative paths", () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      expect(rwfs.resolvePath("/dir", "file.txt")).toBe("/dir/file.txt");
      expect(rwfs.resolvePath("/dir", "../file.txt")).toBe("/file.txt");
    });

    it("should handle absolute paths", () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      expect(rwfs.resolvePath("/dir", "/other/file.txt")).toBe(
        "/other/file.txt",
      );
    });
  });

  describe("getAllPaths", () => {
    it("should return all paths in filesystem", () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.mkdirSync(path.join(tempDir, "subdir"));
      fs.writeFileSync(path.join(tempDir, "subdir", "b.txt"), "b");
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      const paths = rwfs.getAllPaths();
      expect(paths).toContain("/a.txt");
      expect(paths).toContain("/subdir");
      expect(paths).toContain("/subdir/b.txt");
    });
  });

  describe("encoding support", () => {
    it("should write and read with base64 encoding", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      const base64Content = btoa("Hello World");

      await rwfs.writeFile("/base64.txt", base64Content, "base64");
      const content = await rwfs.readFile("/base64.txt");
      expect(content).toBe("Hello World");
    });

    it("should write and read with hex encoding", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      const hexContent = "48656c6c6f"; // "Hello"

      await rwfs.writeFile("/hex.txt", hexContent, "hex");
      const content = await rwfs.readFile("/hex.txt");
      expect(content).toBe("Hello");
    });
  });

  describe("readdirWithFileTypes", () => {
    it("should return entries with correct type info", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");
      fs.mkdirSync(path.join(tempDir, "subdir"));

      const entries = await rwfs.readdirWithFileTypes("/");

      const file = entries.find((e) => e.name === "file.txt");
      expect(file).toBeDefined();
      expect(file?.isFile).toBe(true);
      expect(file?.isDirectory).toBe(false);
      expect(file?.isSymbolicLink).toBe(false);

      const subdir = entries.find((e) => e.name === "subdir");
      expect(subdir).toBeDefined();
      expect(subdir?.isFile).toBe(false);
      expect(subdir?.isDirectory).toBe(true);
      expect(subdir?.isSymbolicLink).toBe(false);
    });

    it("should return entries sorted case-sensitively", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      fs.writeFileSync(path.join(tempDir, "Zebra.txt"), "z");
      fs.writeFileSync(path.join(tempDir, "apple.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "Banana.txt"), "b");

      const entries = await rwfs.readdirWithFileTypes("/");
      const names = entries.map((e) => e.name);

      // Case-sensitive sort: uppercase before lowercase
      expect(names).toEqual(["Banana.txt", "Zebra.txt", "apple.txt"]);
    });

    it("should identify symlinks correctly", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      fs.writeFileSync(path.join(tempDir, "real.txt"), "content");
      fs.symlinkSync(
        path.join(tempDir, "real.txt"),
        path.join(tempDir, "link.txt"),
      );

      const entries = await rwfs.readdirWithFileTypes("/");

      const link = entries.find((e) => e.name === "link.txt");
      expect(link).toBeDefined();
      expect(link?.isFile).toBe(false);
      expect(link?.isDirectory).toBe(false);
      expect(link?.isSymbolicLink).toBe(true);
    });

    it("should throw ENOENT for non-existent directory", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      await expect(rwfs.readdirWithFileTypes("/nonexistent")).rejects.toThrow(
        "ENOENT",
      );
    });

    it("should throw ENOTDIR for file path", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });
      fs.writeFileSync(path.join(tempDir, "file.txt"), "content");

      await expect(rwfs.readdirWithFileTypes("/file.txt")).rejects.toThrow(
        "ENOTDIR",
      );
    });

    it("should return same names as readdir", async () => {
      const rwfs = new ReadWriteFs({ root: tempDir, allowSymlinks: true });

      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      fs.mkdirSync(path.join(tempDir, "sub"));

      const namesFromReaddir = await rwfs.readdir("/");
      const entriesWithTypes = await rwfs.readdirWithFileTypes("/");
      const namesFromWithTypes = entriesWithTypes.map((e) => e.name);

      expect(namesFromWithTypes).toEqual(namesFromReaddir);
    });
  });
});
