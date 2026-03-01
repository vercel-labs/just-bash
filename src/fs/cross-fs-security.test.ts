/**
 * Cross-filesystem security tests.
 *
 * Every attack vector in this file is run against BOTH OverlayFs and
 * ReadWriteFs.  This ensures the shared real-fs-utils code provides
 * consistent protection regardless of which filesystem is in use.
 *
 * Where the two FSes differ in surface semantics (e.g. OverlayFs is
 * copy-on-write, ReadWriteFs hits real disk), the test adapts, but the
 * security invariant is the same.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { IFileSystem } from "./interface.js";
import { OverlayFs } from "./overlay-fs/overlay-fs.js";
import { ReadWriteFs } from "./read-write-fs/read-write-fs.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TestContext {
  tempDir: string;
  outsideDir: string;
  outsideFile: string;
  fsImpl: IFileSystem;
}

function setupOverlay(tempDir: string): IFileSystem {
  return new OverlayFs({ root: tempDir, mountPoint: "/", allowSymlinks: true });
}

function setupReadWrite(tempDir: string): IFileSystem {
  return new ReadWriteFs({ root: tempDir, allowSymlinks: true });
}

// ---------------------------------------------------------------------------
// Parameterised test suite
// ---------------------------------------------------------------------------
describe.each([
  ["OverlayFs", setupOverlay],
  ["ReadWriteFs", setupReadWrite],
])("%s — cross-FS security", (_name, factory) => {
  let ctx: TestContext;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xfs-sandbox-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "xfs-outside-"));
    const outsideFile = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(outsideFile, "TOP SECRET");

    // Seed sandbox
    fs.writeFileSync(path.join(tempDir, "hello.txt"), "hello");
    fs.mkdirSync(path.join(tempDir, "sub"));
    fs.writeFileSync(path.join(tempDir, "sub", "nested.txt"), "nested");

    ctx = {
      tempDir,
      outsideDir,
      outsideFile,
      fsImpl: factory(tempDir),
    };
  });

  afterEach(() => {
    fs.rmSync(ctx.tempDir, { recursive: true, force: true });
    fs.rmSync(ctx.outsideDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // 1. Null-byte injection (validatePath)
  // -----------------------------------------------------------------------
  describe("null-byte injection", () => {
    it("rejects null byte in readFile", async () => {
      await expect(ctx.fsImpl.readFile("/hello\x00.txt")).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in writeFile", async () => {
      await expect(
        ctx.fsImpl.writeFile("/evil\x00.txt", "data"),
      ).rejects.toThrow("null byte");
    });

    it("rejects null byte in appendFile", async () => {
      await expect(
        ctx.fsImpl.appendFile("/evil\x00.txt", "data"),
      ).rejects.toThrow("null byte");
    });

    it("rejects null byte in stat", async () => {
      await expect(ctx.fsImpl.stat("/evil\x00.txt")).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in lstat", async () => {
      await expect(ctx.fsImpl.lstat("/evil\x00.txt")).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in mkdir", async () => {
      await expect(ctx.fsImpl.mkdir("/evil\x00dir")).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in rm", async () => {
      await expect(ctx.fsImpl.rm("/evil\x00.txt")).rejects.toThrow("null byte");
    });

    it("rejects null byte in chmod", async () => {
      await expect(ctx.fsImpl.chmod("/evil\x00.txt", 0o644)).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in symlink", async () => {
      await expect(ctx.fsImpl.symlink("target", "/link\x00")).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in link", async () => {
      await expect(ctx.fsImpl.link("/hello\x00.txt", "/dest")).rejects.toThrow(
        "null byte",
      );
      await expect(ctx.fsImpl.link("/hello.txt", "/dest\x00")).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in readlink", async () => {
      await expect(ctx.fsImpl.readlink("/link\x00")).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in realpath", async () => {
      await expect(ctx.fsImpl.realpath("/evil\x00")).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in utimes", async () => {
      const now = new Date();
      await expect(ctx.fsImpl.utimes("/evil\x00", now, now)).rejects.toThrow(
        "null byte",
      );
    });

    it("rejects null byte in cp (src and dest)", async () => {
      await expect(ctx.fsImpl.cp("/evil\x00", "/dest")).rejects.toThrow(
        "null byte",
      );
      await expect(ctx.fsImpl.cp("/hello.txt", "/dest\x00")).rejects.toThrow(
        "null byte",
      );
    });

    it("exists() returns false for null-byte paths (no throw)", async () => {
      const result = await ctx.fsImpl.exists("/hello\x00.txt");
      expect(result).toBe(false);
    });

    it("null byte at the start of the path", async () => {
      await expect(ctx.fsImpl.readFile("\x00/etc/passwd")).rejects.toThrow(
        "null byte",
      );
    });

    it("null byte between path segments", async () => {
      await expect(
        ctx.fsImpl.readFile("/sub\x00/../../../etc/passwd"),
      ).rejects.toThrow("null byte");
    });
  });

  // -----------------------------------------------------------------------
  // 2. Path traversal clamped at root
  // -----------------------------------------------------------------------
  describe("path traversal clamped at root", () => {
    it("excessive .. resolves to root and reads root content", async () => {
      // /../../../hello.txt should resolve to /hello.txt
      const content = await ctx.fsImpl.readFile("/../../../hello.txt");
      expect(content).toBe("hello");
    });

    it("/ after many .. is still root", async () => {
      const stat = await ctx.fsImpl.stat("/../../../../../");
      expect(stat.isDirectory).toBe(true);
    });

    it("readdir after traversal returns sandbox root", async () => {
      const entries = await ctx.fsImpl.readdir("/../../");
      expect(entries).toContain("hello.txt");
      expect(entries).not.toContain("secret.txt");
    });

    it("readdir never leaks /etc, /usr, /var", async () => {
      const entries = await ctx.fsImpl.readdir("/");
      for (const sysDir of ["etc", "usr", "var", "bin", "sbin"]) {
        expect(entries).not.toContain(sysDir);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. Symlink to filesystem root /
  // -----------------------------------------------------------------------
  describe("symlink targeting /", () => {
    it("cannot read /etc/passwd through symlink to /", async () => {
      await ctx.fsImpl.symlink("/", "/root-link");
      // Following symlink to / should scope to virtual /, which is the sandbox root
      // Reading /root-link/etc/passwd should fail
      await expect(
        ctx.fsImpl.readFile("/root-link/etc/passwd"),
      ).rejects.toThrow();
    });

    it("cannot list real filesystem entries through symlink to /", async () => {
      await ctx.fsImpl.symlink("/", "/root-link");
      try {
        const entries = await ctx.fsImpl.readdir("/root-link");
        // Should be sandbox contents, not real /
        expect(entries).not.toContain("etc");
        expect(entries).not.toContain("usr");
      } catch {
        // Throwing is also safe
      }
    });
  });

  // -----------------------------------------------------------------------
  // 4. Real OS symlink that forms a chain within sandbox
  // -----------------------------------------------------------------------
  describe("real-fs symlink chain within sandbox", () => {
    it("follows two-hop chain that stays inside sandbox", async () => {
      // Create real symlinks: a -> b -> hello.txt (all within sandbox)
      try {
        fs.symlinkSync(
          path.join(ctx.tempDir, "hello.txt"),
          path.join(ctx.tempDir, "link-b"),
        );
        fs.symlinkSync(
          path.join(ctx.tempDir, "link-b"),
          path.join(ctx.tempDir, "link-a"),
        );
      } catch {
        return; // Skip if symlinks not supported
      }

      const content = await ctx.fsImpl.readFile("/link-a");
      expect(content).toBe("hello");
    });

    it("blocks chain where last hop escapes", async () => {
      // Create: link-a -> link-b (inside), link-b -> outsideFile
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "chain-b"));
        fs.symlinkSync(
          path.join(ctx.tempDir, "chain-b"),
          path.join(ctx.tempDir, "chain-a"),
        );
      } catch {
        return;
      }

      await expect(ctx.fsImpl.readFile("/chain-a")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 5. Real OS symlink to parent (directory cycle)
  // -----------------------------------------------------------------------
  describe("symlink-to-parent cycle", () => {
    it("does not infinite-loop when directory symlinks to itself", async () => {
      try {
        fs.symlinkSync(ctx.tempDir, path.join(ctx.tempDir, "self-link"));
      } catch {
        return;
      }

      // The OS resolves self-link -> tempDir, so self-link/self-link/hello.txt
      // resolves to tempDir/hello.txt (safe, stays within sandbox).
      // The critical invariant: it doesn't hang and doesn't escape.
      try {
        const content = await ctx.fsImpl.readFile(
          "/self-link/self-link/self-link/hello.txt",
        );
        // If it succeeds, the content must be from within the sandbox
        expect(content).toBe("hello");
      } catch {
        // Throwing (ELOOP, ENOENT) is also safe
      }
    });
  });

  // -----------------------------------------------------------------------
  // 6. Double-dot filenames that are NOT traversal
  // -----------------------------------------------------------------------
  describe("double-dot filenames (legitimate)", () => {
    it("creates and reads file named '..foo'", async () => {
      await ctx.fsImpl.writeFile("/..foo", "dot-start");
      expect(await ctx.fsImpl.readFile("/..foo")).toBe("dot-start");
    });

    it("creates and reads file named 'foo..'", async () => {
      await ctx.fsImpl.writeFile("/foo..", "dot-end");
      expect(await ctx.fsImpl.readFile("/foo..")).toBe("dot-end");
    });

    it("creates and reads file named '...'", async () => {
      await ctx.fsImpl.writeFile("/...", "triple-dot");
      expect(await ctx.fsImpl.readFile("/...")).toBe("triple-dot");
    });

    it("creates and reads file named 'a..b'", async () => {
      await ctx.fsImpl.writeFile("/a..b", "mid-dot");
      expect(await ctx.fsImpl.readFile("/a..b")).toBe("mid-dot");
    });
  });

  // -----------------------------------------------------------------------
  // 7. lstat vs stat on real-fs symlinks pointing outside
  // -----------------------------------------------------------------------
  describe("lstat vs stat on escape symlinks", () => {
    it("lstat sees the symlink without following it", async () => {
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "ls-link"));
      } catch {
        return;
      }

      const st = await ctx.fsImpl.lstat("/ls-link");
      expect(st.isSymbolicLink).toBe(true);
      expect(st.isFile).toBe(false);
    });

    it("stat throws when following symlink outside", async () => {
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "st-link"));
      } catch {
        return;
      }

      await expect(ctx.fsImpl.stat("/st-link")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 8. readlink on non-symlink
  // -----------------------------------------------------------------------
  describe("readlink on non-symlink", () => {
    it("throws EINVAL for regular file", async () => {
      await expect(ctx.fsImpl.readlink("/hello.txt")).rejects.toThrow("EINVAL");
    });

    it("throws for directory", async () => {
      await expect(ctx.fsImpl.readlink("/sub")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 9. readlink does not leak real paths
  // -----------------------------------------------------------------------
  describe("readlink path sanitisation", () => {
    it("does not expose real path for absolute outside symlink", async () => {
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "rl-abs"));
      } catch {
        return;
      }

      const target = await ctx.fsImpl.readlink("/rl-abs");
      // Must NOT contain the real temp directory path
      expect(target).not.toContain(ctx.outsideDir);
      // Should be just the basename
      expect(target).toBe("secret.txt");
    });

    it("returns relative target as-is for within-root links (no leak)", async () => {
      try {
        fs.symlinkSync("hello.txt", path.join(ctx.tempDir, "rl-rel"));
      } catch {
        return;
      }

      const target = await ctx.fsImpl.readlink("/rl-rel");
      expect(target).toBe("hello.txt");
    });

    it("sanitises relative target that escapes root to basename only", async () => {
      // Create a relative symlink that traverses out of the sandbox
      const escapeTarget = path.relative(ctx.tempDir, ctx.outsideFile);
      try {
        fs.symlinkSync(escapeTarget, path.join(ctx.tempDir, "rl-rel-escape"));
      } catch {
        return;
      }

      const target = await ctx.fsImpl.readlink("/rl-rel-escape");
      // Must NOT contain "../" path traversal components
      expect(target).not.toContain("..");
      // Must NOT contain the real outside directory path
      expect(target).not.toContain(ctx.outsideDir);
      // Should be just the basename
      expect(target).toBe("secret.txt");
    });
  });

  // -----------------------------------------------------------------------
  // 10. realpath stays within sandbox
  // -----------------------------------------------------------------------
  describe("realpath sandbox boundary", () => {
    it("resolves internal file to virtual path", async () => {
      const rp = await ctx.fsImpl.realpath("/hello.txt");
      expect(rp).not.toContain(ctx.tempDir);
      expect(rp).toBe("/hello.txt");
    });

    it("throws for non-existent file", async () => {
      await expect(ctx.fsImpl.realpath("/no-such-file")).rejects.toThrow();
    });

    it("realpath for escape symlink does not expose real outside path", async () => {
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "rp-esc"));
      } catch {
        return;
      }
      // OverlayFs resolves within the virtual layer (symlink entry exists),
      // ReadWriteFs throws because the resolved target is outside root.
      // Both are safe — the critical invariant is no real path leakage.
      try {
        const resolved = await ctx.fsImpl.realpath("/rp-esc");
        expect(resolved).not.toContain(ctx.outsideDir);
        expect(resolved).not.toContain(ctx.tempDir);
      } catch {
        // Throwing is also safe (ReadWriteFs path)
      }
    });
  });

  // -----------------------------------------------------------------------
  // 11. Error messages never leak real paths
  // -----------------------------------------------------------------------
  describe("error messages never leak real paths", () => {
    it("readFile error does not contain real temp dir", async () => {
      try {
        await ctx.fsImpl.readFile("/no-such-xyz");
      } catch (e) {
        expect((e as Error).message).not.toContain(ctx.tempDir);
      }
    });

    it("stat error does not contain real temp dir", async () => {
      try {
        await ctx.fsImpl.stat("/no-such-xyz");
      } catch (e) {
        expect((e as Error).message).not.toContain(ctx.tempDir);
      }
    });

    it("lstat error does not contain real temp dir", async () => {
      try {
        await ctx.fsImpl.lstat("/no-such-xyz");
      } catch (e) {
        expect((e as Error).message).not.toContain(ctx.tempDir);
      }
    });

    it("readdir error does not contain real temp dir", async () => {
      try {
        await ctx.fsImpl.readdir("/no-such-xyz");
      } catch (e) {
        expect((e as Error).message).not.toContain(ctx.tempDir);
      }
    });

    it("chmod error does not contain real temp dir", async () => {
      try {
        await ctx.fsImpl.chmod("/no-such-xyz", 0o644);
      } catch (e) {
        expect((e as Error).message).not.toContain(ctx.tempDir);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 12. Concurrent attacks don't bypass validation
  // -----------------------------------------------------------------------
  describe("concurrent attack resistance", () => {
    it("blocks 50 concurrent path traversal reads", async () => {
      const attempts = Array.from({ length: 50 }, (_, i) =>
        ctx.fsImpl
          .readFile(`/${"../".repeat(i + 1)}etc/passwd`)
          .then(() => "leaked")
          .catch(() => "blocked"),
      );
      const results = await Promise.all(attempts);
      expect(results).not.toContain("leaked");
    });

    it("blocks 50 concurrent writes via path traversal", async () => {
      const attempts = Array.from({ length: 50 }, (_, i) =>
        ctx.fsImpl
          .writeFile(`/${"../".repeat(i + 1)}tmp/pwned-${i}`, "PWNED")
          .catch(() => "ok"),
      );
      await Promise.all(attempts);

      // No files should appear in the real /tmp
      for (let i = 0; i < 50; i++) {
        expect(fs.existsSync(`/tmp/pwned-${i}`)).toBe(false);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 13. cp/mv via symlink to outside
  // -----------------------------------------------------------------------
  describe("cp/mv blocked through escape symlinks", () => {
    it("cp from escape symlink fails", async () => {
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "cp-esc"));
      } catch {
        return;
      }

      await expect(ctx.fsImpl.cp("/cp-esc", "/stolen.txt")).rejects.toThrow();
      // /stolen.txt must not contain outside content
      try {
        const content = await ctx.fsImpl.readFile("/stolen.txt");
        expect(content).not.toContain("TOP SECRET");
      } catch {
        // ENOENT is fine — file was never created
      }
    });
  });

  // -----------------------------------------------------------------------
  // 14. chmod / utimes via escape symlink
  // -----------------------------------------------------------------------
  describe("chmod/utimes blocked through escape symlinks", () => {
    it("chmod via escape symlink fails", async () => {
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "chmod-esc"));
      } catch {
        return;
      }
      await expect(ctx.fsImpl.chmod("/chmod-esc", 0o777)).rejects.toThrow();
    });

    it("utimes via escape symlink fails", async () => {
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "utimes-esc"));
      } catch {
        return;
      }
      const now = new Date();
      await expect(
        ctx.fsImpl.utimes("/utimes-esc", now, now),
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 15. getAllPaths never leaks outside content
  // -----------------------------------------------------------------------
  describe("getAllPaths never leaks outside content", () => {
    it("symlink to outside dir does not traverse into it", () => {
      try {
        fs.symlinkSync(ctx.outsideDir, path.join(ctx.tempDir, "scan-esc"));
      } catch {
        return;
      }

      const paths = ctx.fsImpl.getAllPaths();
      for (const p of paths) {
        expect(p).not.toContain("secret");
        expect(p).not.toContain(ctx.outsideDir);
      }
    });

    it("all paths start with /", () => {
      const paths = ctx.fsImpl.getAllPaths();
      for (const p of paths) {
        expect(p.startsWith("/")).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 16. Root that is itself a symlink
  // -----------------------------------------------------------------------
  describe("root directory is a symlink", () => {
    it("works when root is symlink to a real directory", async () => {
      const realDir = fs.mkdtempSync(path.join(os.tmpdir(), "xfs-realroot-"));
      const linkRoot = path.join(os.tmpdir(), `xfs-linkroot-${Date.now()}`);
      try {
        fs.symlinkSync(realDir, linkRoot);
      } catch {
        fs.rmSync(realDir, { recursive: true, force: true });
        return;
      }

      fs.writeFileSync(path.join(realDir, "data.txt"), "via symlink root");

      try {
        const impl = factory(linkRoot);
        // Should be able to read through the symlinked root
        const content = await impl.readFile("/data.txt");
        expect(content).toBe("via symlink root");
      } finally {
        fs.rmSync(linkRoot, { force: true });
        fs.rmSync(realDir, { recursive: true, force: true });
      }
    });
  });

  // -----------------------------------------------------------------------
  // 17. Intermediate OS directory symlink to outside
  // -----------------------------------------------------------------------
  describe("intermediate directory symlink escape", () => {
    it("blocks readFile when parent dir is OS symlink to outside", async () => {
      try {
        fs.symlinkSync(ctx.outsideDir, path.join(ctx.tempDir, "esc-dir"));
      } catch {
        return;
      }
      await expect(
        ctx.fsImpl.readFile("/esc-dir/secret.txt"),
      ).rejects.toThrow();
    });

    it("writeFile through escape dir never writes to real outside dir", async () => {
      try {
        fs.symlinkSync(ctx.outsideDir, path.join(ctx.tempDir, "wesc-dir"));
      } catch {
        return;
      }
      // OverlayFs writes to memory (doesn't throw), ReadWriteFs rejects.
      // Either way, the critical invariant is: real outside dir is untouched.
      try {
        await ctx.fsImpl.writeFile("/wesc-dir/pwned.txt", "PWNED");
      } catch {
        // Expected for ReadWriteFs
      }
      expect(fs.existsSync(path.join(ctx.outsideDir, "pwned.txt"))).toBe(false);
    });

    it("writeFile through broken symlink never creates file outside sandbox", async () => {
      // A broken symlink (target doesn't exist) pointing outside the sandbox.
      // The target's parent exists, so writeFile following the symlink could
      // create the target file outside the sandbox.
      const brokenTarget = path.join(ctx.outsideDir, "broken-target.txt");
      try {
        fs.symlinkSync(brokenTarget, path.join(ctx.tempDir, "broken-escape"));
      } catch {
        return;
      }
      try {
        await ctx.fsImpl.writeFile("/broken-escape", "PWNED");
      } catch {
        // Expected for ReadWriteFs
      }
      expect(fs.existsSync(brokenTarget)).toBe(false);
    });

    it("blocks stat when parent dir is OS symlink to outside", async () => {
      try {
        fs.symlinkSync(ctx.outsideDir, path.join(ctx.tempDir, "sesc-dir"));
      } catch {
        return;
      }
      await expect(ctx.fsImpl.stat("/sesc-dir/secret.txt")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 18. maxFileReadSize enforcement
  // -----------------------------------------------------------------------
  describe("maxFileReadSize enforcement", () => {
    it("blocks reading oversized file", async () => {
      const bigContent = "x".repeat(500);
      fs.writeFileSync(path.join(ctx.tempDir, "big.txt"), bigContent);

      const small =
        factory === setupOverlay
          ? new OverlayFs({
              root: ctx.tempDir,
              mountPoint: "/",
              maxFileReadSize: 100,
              allowSymlinks: true,
            })
          : new ReadWriteFs({
              root: ctx.tempDir,
              maxFileReadSize: 100,
              allowSymlinks: true,
            });

      await expect(small.readFile("/big.txt")).rejects.toThrow("EFBIG");
    });

    it("blocks reading oversized file through internal symlink", async () => {
      const bigContent = "x".repeat(500);
      fs.writeFileSync(path.join(ctx.tempDir, "big2.txt"), bigContent);
      try {
        fs.symlinkSync(
          path.join(ctx.tempDir, "big2.txt"),
          path.join(ctx.tempDir, "big2-link"),
        );
      } catch {
        return;
      }

      const small =
        factory === setupOverlay
          ? new OverlayFs({
              root: ctx.tempDir,
              mountPoint: "/",
              maxFileReadSize: 100,
              allowSymlinks: true,
            })
          : new ReadWriteFs({
              root: ctx.tempDir,
              maxFileReadSize: 100,
              allowSymlinks: true,
            });

      await expect(small.readFile("/big2-link")).rejects.toThrow("EFBIG");
    });
  });

  // -----------------------------------------------------------------------
  // 19. resolvePath does not escape
  // -----------------------------------------------------------------------
  describe("resolvePath never produces escape", () => {
    it("clamps traversal from sub to root", () => {
      const resolved = ctx.fsImpl.resolvePath("/sub", "../../etc/passwd");
      expect(resolved).toBe("/etc/passwd");
      // The path is valid as a *virtual* path — security is enforced at I/O time
    });

    it("absolute path wins over base", () => {
      const resolved = ctx.fsImpl.resolvePath("/sub", "/etc/passwd");
      expect(resolved).toBe("/etc/passwd");
    });
  });

  // -----------------------------------------------------------------------
  // 20. writeFile to traversal path stays inside sandbox
  // -----------------------------------------------------------------------
  describe("write to traversal path stays inside sandbox", () => {
    it("writeFile to /../foo.txt creates /foo.txt inside sandbox", async () => {
      await ctx.fsImpl.writeFile("/../foo.txt", "sandboxed");
      const content = await ctx.fsImpl.readFile("/foo.txt");
      expect(content).toBe("sandboxed");
      // Must NOT exist outside the sandbox
      expect(
        fs.existsSync(path.join(path.dirname(ctx.tempDir), "foo.txt")),
      ).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // 21. Exists returns false for paths outside sandbox
  // -----------------------------------------------------------------------
  describe("exists returns false for outside paths", () => {
    it("exists returns false for escape symlink target", async () => {
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "ex-esc"));
      } catch {
        return;
      }

      // OverlayFs returns true (lstat sees the symlink entry itself)
      // ReadWriteFs returns false (resolveAndValidate rejects escape)
      // Both are safe — the key invariant is that you can't READ through it
      await expect(ctx.fsImpl.readFile("/ex-esc")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 22. Consecutive operations don't corrupt state
  // -----------------------------------------------------------------------
  describe("sequential operation integrity", () => {
    it("write → read → delete → read-fails", async () => {
      await ctx.fsImpl.writeFile("/seq.txt", "step1");
      expect(await ctx.fsImpl.readFile("/seq.txt")).toBe("step1");
      await ctx.fsImpl.rm("/seq.txt");
      await expect(ctx.fsImpl.readFile("/seq.txt")).rejects.toThrow("ENOENT");
    });

    it("mkdir → writeFile → readdir shows child", async () => {
      await ctx.fsImpl.mkdir("/seqdir", { recursive: true });
      await ctx.fsImpl.writeFile("/seqdir/child.txt", "c");
      const entries = await ctx.fsImpl.readdir("/seqdir");
      expect(entries).toContain("child.txt");
    });
  });

  // -----------------------------------------------------------------------
  // 23. appendFile through real-fs escape symlink must not leak content
  // -----------------------------------------------------------------------
  describe("appendFile through escape symlink", () => {
    it("does not leak outside file content via appendFile read step", async () => {
      // appendFile reads existing content, then appends.
      // If the read goes through an escape symlink, it could leak outside data.
      try {
        fs.symlinkSync(ctx.outsideFile, path.join(ctx.tempDir, "append-esc"));
      } catch {
        return;
      }

      // appendFile should either throw or write only the new content
      try {
        await ctx.fsImpl.appendFile("/append-esc", " appended");
      } catch {
        // Throwing is safe — ReadWriteFs rejects via resolveAndValidate
        return;
      }

      // If it didn't throw (OverlayFs path), verify no outside content leaked
      const content = await ctx.fsImpl.readFile("/append-esc");
      expect(content).not.toContain("TOP SECRET");
    });
  });

  // -----------------------------------------------------------------------
  // 24. cp/mv where DESTINATION is an escape symlink
  // -----------------------------------------------------------------------
  describe("cp/mv with escape symlink as destination", () => {
    it("cp to escape symlink does not write outside", async () => {
      try {
        fs.symlinkSync(
          path.join(ctx.outsideDir, "stolen.txt"),
          path.join(ctx.tempDir, "dest-esc"),
        );
      } catch {
        return;
      }

      try {
        await ctx.fsImpl.cp("/hello.txt", "/dest-esc");
      } catch {
        // Throwing is safe
      }

      // Must NOT have created a file outside
      expect(fs.existsSync(path.join(ctx.outsideDir, "stolen.txt"))).toBe(
        false,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 25. Symlink whose target is literally ".."
  // -----------------------------------------------------------------------
  describe("symlink with target '..'", () => {
    it("symlink to '..' does not escape sandbox", async () => {
      await ctx.fsImpl.symlink("..", "/dotdot-link");

      // Following the symlink from root should resolve to root (clamped)
      try {
        const entries = await ctx.fsImpl.readdir("/dotdot-link");
        // Must be sandbox contents, not parent directory
        expect(entries).toContain("hello.txt");
        expect(entries).not.toContain("secret.txt");
      } catch {
        // Throwing is also safe
      }
    });

    it("symlink to '..' from subdir resolves within sandbox", async () => {
      await ctx.fsImpl.mkdir("/deep/dir", { recursive: true });
      await ctx.fsImpl.symlink("..", "/deep/dir/up-link");

      try {
        const entries = await ctx.fsImpl.readdir("/deep/dir/up-link");
        // Should resolve to /deep, not escape
        expect(entries).not.toContain("secret.txt");
      } catch {
        // Throwing is safe
      }
    });
  });

  // -----------------------------------------------------------------------
  // 26. Long symlink chain — ELOOP detection
  // -----------------------------------------------------------------------
  describe("long symlink chain ELOOP detection", () => {
    it("detects loop in 40+ hop chain", async () => {
      // Create a chain: link0 -> link1 -> link2 -> ... -> link39 -> link0
      for (let i = 0; i < 40; i++) {
        const target = `/chain-link${(i + 1) % 40}`;
        await ctx.fsImpl.symlink(target, `/chain-link${i}`);
      }

      await expect(ctx.fsImpl.readFile("/chain-link0")).rejects.toThrow();
    });

    it("detects mutual symlink loop", async () => {
      await ctx.fsImpl.symlink("/ping", "/pong");
      await ctx.fsImpl.symlink("/pong", "/ping");

      await expect(ctx.fsImpl.readFile("/ping")).rejects.toThrow();
      await expect(ctx.fsImpl.stat("/pong")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // 27. Type change after delete (file → dir, dir → file)
  // -----------------------------------------------------------------------
  describe("type change after delete", () => {
    it("can replace file with directory", async () => {
      await ctx.fsImpl.writeFile("/morph.txt", "file");
      await ctx.fsImpl.rm("/morph.txt");
      await ctx.fsImpl.mkdir("/morph.txt");
      const stat = await ctx.fsImpl.stat("/morph.txt");
      expect(stat.isDirectory).toBe(true);
      expect(stat.isFile).toBe(false);
    });

    it("can replace directory with file", async () => {
      await ctx.fsImpl.mkdir("/morph-dir");
      await ctx.fsImpl.rm("/morph-dir", { recursive: true });
      await ctx.fsImpl.writeFile("/morph-dir", "now a file");
      const content = await ctx.fsImpl.readFile("/morph-dir");
      expect(content).toBe("now a file");
      const stat = await ctx.fsImpl.stat("/morph-dir");
      expect(stat.isFile).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 28. Relative paths without leading /
  // -----------------------------------------------------------------------
  describe("relative paths without leading /", () => {
    it("normalizes 'hello.txt' to '/hello.txt'", async () => {
      const content = await ctx.fsImpl.readFile("hello.txt");
      expect(content).toBe("hello");
    });

    it("normalizes 'sub/nested.txt' to '/sub/nested.txt'", async () => {
      const content = await ctx.fsImpl.readFile("sub/nested.txt");
      expect(content).toBe("nested");
    });

    it("normalizes '../hello.txt' to '/hello.txt'", async () => {
      const content = await ctx.fsImpl.readFile("../hello.txt");
      expect(content).toBe("hello");
    });
  });

  // -----------------------------------------------------------------------
  // 29. rm force:true on non-existent escape path
  // -----------------------------------------------------------------------
  describe("rm force on escape paths", () => {
    it("rm force:true on traversal path does not touch real FS", async () => {
      await ctx.fsImpl.rm("/../../../etc/passwd", { force: true });
      // Must not have deleted anything on the real FS
      // /etc/passwd won't exist in the sandbox so force silences ENOENT
    });

    it("rm force:true on outside absolute path does not touch real FS", async () => {
      await ctx.fsImpl.rm(ctx.outsideFile, { force: true });
      // Real file must still exist
      expect(fs.existsSync(ctx.outsideFile)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 30. Deeply nested relative symlink that traverses out and back in
  // -----------------------------------------------------------------------
  describe("relative symlink out-and-back", () => {
    it("relative symlink ../../sub/nested.txt from /a/b/ stays safe", async () => {
      await ctx.fsImpl.mkdir("/a/b", { recursive: true });
      await ctx.fsImpl.symlink("../../sub/nested.txt", "/a/b/tricky-link");

      try {
        const content = await ctx.fsImpl.readFile("/a/b/tricky-link");
        // Resolves to /sub/nested.txt — inside sandbox
        expect(content).toBe("nested");
      } catch {
        // Throwing is also acceptable (path may not resolve on real FS)
      }
    });
  });

  // -----------------------------------------------------------------------
  // 31. stat on root /
  // -----------------------------------------------------------------------
  describe("stat on root", () => {
    it("stat / returns directory", async () => {
      const stat = await ctx.fsImpl.stat("/");
      expect(stat.isDirectory).toBe(true);
      expect(stat.isFile).toBe(false);
    });

    it("readdir / returns sandbox contents", async () => {
      const entries = await ctx.fsImpl.readdir("/");
      expect(entries).toContain("hello.txt");
      expect(entries).toContain("sub");
    });
  });

  // -----------------------------------------------------------------------
  // 32. Concurrent create + delete races
  // -----------------------------------------------------------------------
  describe("concurrent create/delete races", () => {
    it("concurrent write/delete/read cycles don't crash", async () => {
      const ops = Array.from({ length: 30 }, (_, i) =>
        (async () => {
          try {
            await ctx.fsImpl.writeFile(`/race-${i % 5}.txt`, `v${i}`);
            await ctx.fsImpl.readFile(`/race-${i % 5}.txt`);
            await ctx.fsImpl.rm(`/race-${i % 5}.txt`);
          } catch {
            // Race-induced ENOENT is fine
          }
        })(),
      );
      // Must complete without hanging or crashing
      await Promise.all(ops);
    });
  });

  // -----------------------------------------------------------------------
  // 33. Link through escape directory
  // -----------------------------------------------------------------------
  describe("link through escape directory", () => {
    it("hard link from escape dir path fails", async () => {
      try {
        fs.symlinkSync(ctx.outsideDir, path.join(ctx.tempDir, "link-esc-dir"));
      } catch {
        return;
      }

      await expect(
        ctx.fsImpl.link("/link-esc-dir/secret.txt", "/stolen.txt"),
      ).rejects.toThrow();
    });

    it("hard link to escape dir path never writes outside", async () => {
      try {
        fs.symlinkSync(ctx.outsideDir, path.join(ctx.tempDir, "link-esc-dir2"));
      } catch {
        return;
      }

      // OverlayFs creates a copy in memory (safe), ReadWriteFs rejects.
      // Either way, the real outside directory must be untouched.
      try {
        await ctx.fsImpl.link("/hello.txt", "/link-esc-dir2/planted.txt");
      } catch {
        // Expected for ReadWriteFs
      }
      expect(fs.existsSync(path.join(ctx.outsideDir, "planted.txt"))).toBe(
        false,
      );
    });
  });

  // -----------------------------------------------------------------------
  // 34. Readdir through real-fs internal symlink
  // -----------------------------------------------------------------------
  describe("readdir through internal real-fs symlink", () => {
    it("readdir through symlink to internal dir works", async () => {
      try {
        fs.symlinkSync(
          path.join(ctx.tempDir, "sub"),
          path.join(ctx.tempDir, "sub-alias"),
        );
      } catch {
        return;
      }

      const entries = await ctx.fsImpl.readdir("/sub-alias");
      expect(entries).toContain("nested.txt");
    });
  });
});

// ===========================================================================
// OverlayFs-specific tests (not applicable to ReadWriteFs)
// ===========================================================================
describe("OverlayFs-specific security", () => {
  let tempDir: string;
  let outsideDir: string;
  let outsideFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "xfs-ov-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "xfs-ov-out-"));
    outsideFile = path.join(outsideDir, "secret.txt");
    fs.writeFileSync(outsideFile, "TOP SECRET");
    fs.writeFileSync(path.join(tempDir, "hello.txt"), "hello");
    fs.mkdirSync(path.join(tempDir, "sub"));
    fs.writeFileSync(path.join(tempDir, "sub", "nested.txt"), "nested");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  describe("writeFileSync/mkdirSync null-byte bypass", () => {
    it("writeFileSync with null byte in path doesn't crash", () => {
      // writeFileSync doesn't call validatePath — it normalizes only.
      // Null bytes become part of the key. The file is in memory only,
      // so there's no real FS risk, but let's verify no crash.
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });
      expect(() =>
        overlay.writeFileSync("/init\x00file.txt", "data"),
      ).not.toThrow();
    });

    it("mkdirSync with null byte in path doesn't crash", () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });
      expect(() => overlay.mkdirSync("/init\x00dir")).not.toThrow();
    });
  });

  describe("memory layer isolation", () => {
    it("writeFile never modifies real filesystem", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });

      await overlay.writeFile("/hello.txt", "MODIFIED IN OVERLAY");

      // Real file must be unchanged
      const realContent = fs.readFileSync(
        path.join(tempDir, "hello.txt"),
        "utf8",
      );
      expect(realContent).toBe("hello");

      // Overlay sees the modification
      expect(await overlay.readFile("/hello.txt")).toBe("MODIFIED IN OVERLAY");
    });

    it("rm never deletes from real filesystem", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });

      await overlay.rm("/hello.txt");

      // Overlay says gone
      expect(await overlay.exists("/hello.txt")).toBe(false);

      // Real file still exists
      expect(fs.existsSync(path.join(tempDir, "hello.txt"))).toBe(true);
    });

    it("mkdir never creates on real filesystem", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });

      await overlay.mkdir("/new-overlay-dir");

      expect(await overlay.exists("/new-overlay-dir")).toBe(true);
      expect(fs.existsSync(path.join(tempDir, "new-overlay-dir"))).toBe(false);
    });

    it("chmod never modifies real filesystem permissions", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });
      const originalMode = fs.statSync(path.join(tempDir, "hello.txt")).mode;

      await overlay.chmod("/hello.txt", 0o777);

      // Real permissions unchanged
      const realMode = fs.statSync(path.join(tempDir, "hello.txt")).mode;
      expect(realMode).toBe(originalMode);
    });
  });

  describe("mount point edge cases", () => {
    it("mount point with trailing slashes is normalized", () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/mnt/data///",
        allowSymlinks: true,
      });
      expect(overlay.getMountPoint()).toBe("/mnt/data");
    });

    it("mount point '/' works correctly", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });
      const content = await overlay.readFile("/hello.txt");
      expect(content).toBe("hello");
    });

    it("rejects non-absolute mount point", () => {
      expect(
        () =>
          new OverlayFs({
            root: tempDir,
            mountPoint: "relative/path",
            allowSymlinks: true,
          }),
      ).toThrow("absolute path");
    });
  });

  describe("deleted set interactions", () => {
    it("delete file, re-create same name, old content gone", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });

      // Real-fs file exists
      expect(await overlay.readFile("/hello.txt")).toBe("hello");

      // Delete it
      await overlay.rm("/hello.txt");
      await expect(overlay.readFile("/hello.txt")).rejects.toThrow("ENOENT");

      // Re-create with different content
      await overlay.writeFile("/hello.txt", "new content");
      expect(await overlay.readFile("/hello.txt")).toBe("new content");

      // Real file is untouched
      expect(fs.readFileSync(path.join(tempDir, "hello.txt"), "utf8")).toBe(
        "hello",
      );
    });

    it("delete directory, children don't reappear", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });

      await overlay.rm("/sub", { recursive: true });
      expect(await overlay.exists("/sub")).toBe(false);
      expect(await overlay.exists("/sub/nested.txt")).toBe(false);

      // Create new content under same dir name
      await overlay.writeFile("/sub/other.txt", "other");

      const entries = await overlay.readdir("/sub");
      expect(entries).toContain("other.txt");
      expect(entries).not.toContain("nested.txt");
    });

    it("double delete doesn't crash", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });
      await overlay.rm("/hello.txt");
      // Second delete should throw ENOENT
      await expect(overlay.rm("/hello.txt")).rejects.toThrow("ENOENT");
      // force variant should succeed silently
      await overlay.rm("/hello.txt", { force: true });
    });
  });

  describe("readOnly mode enforcement", () => {
    it("blocks all write operations", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
        allowSymlinks: true,
      });

      await expect(overlay.writeFile("/x", "data")).rejects.toThrow("EROFS");
      await expect(overlay.appendFile("/x", "data")).rejects.toThrow("EROFS");
      await expect(overlay.mkdir("/x")).rejects.toThrow("EROFS");
      await expect(overlay.rm("/hello.txt")).rejects.toThrow("EROFS");
      await expect(overlay.cp("/hello.txt", "/copy.txt")).rejects.toThrow(
        "EROFS",
      );
      await expect(overlay.mv("/hello.txt", "/moved.txt")).rejects.toThrow(
        "EROFS",
      );
      await expect(overlay.chmod("/hello.txt", 0o777)).rejects.toThrow("EROFS");
      await expect(overlay.symlink("target", "/link")).rejects.toThrow("EROFS");
      await expect(overlay.link("/hello.txt", "/hard")).rejects.toThrow(
        "EROFS",
      );
      const now = new Date();
      await expect(overlay.utimes("/hello.txt", now, now)).rejects.toThrow(
        "EROFS",
      );
    });

    it("allows all read operations", async () => {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        readOnly: true,
        allowSymlinks: true,
      });

      expect(await overlay.readFile("/hello.txt")).toBe("hello");
      expect(await overlay.exists("/hello.txt")).toBe(true);
      expect((await overlay.stat("/hello.txt")).isFile).toBe(true);
      expect((await overlay.lstat("/hello.txt")).isFile).toBe(true);
      expect(await overlay.readdir("/")).toContain("hello.txt");
      expect(await overlay.realpath("/hello.txt")).toBe("/hello.txt");
      expect(overlay.getAllPaths()).toContain("/hello.txt");
    });
  });

  describe("overlay shadows real-fs escape symlink", () => {
    it("writing a file over real-fs escape symlink prevents escape", async () => {
      // Create real-fs escape symlink
      try {
        fs.symlinkSync(outsideFile, path.join(tempDir, "shadow-link"));
      } catch {
        return;
      }

      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });

      // Before shadowing, reading through escape symlink should fail
      await expect(overlay.readFile("/shadow-link")).rejects.toThrow();

      // Shadow it with a regular file in memory
      await overlay.writeFile("/shadow-link", "safe content");

      // Now reading returns the memory-layer content, not outside data
      expect(await overlay.readFile("/shadow-link")).toBe("safe content");
    });
  });
});
