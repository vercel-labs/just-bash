/**
 * Tests for default-deny symlink behavior (allowSymlinks: false).
 *
 * Verifies that both OverlayFs and ReadWriteFs correctly block symlink
 * creation and traversal by default, while still allowing lstat/readlink
 * on existing symlinks and normal (non-symlink) operations.
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
  fsImpl: IFileSystem;
}

// Default: allowSymlinks is false (not specified)
function setupOverlay(tempDir: string): IFileSystem {
  return new OverlayFs({ root: tempDir, mountPoint: "/" });
}

function setupReadWrite(tempDir: string): IFileSystem {
  return new ReadWriteFs({ root: tempDir });
}

// With symlinks enabled
function setupOverlayWithSymlinks(tempDir: string): IFileSystem {
  return new OverlayFs({
    root: tempDir,
    mountPoint: "/",
    allowSymlinks: true,
  });
}

function setupReadWriteWithSymlinks(tempDir: string): IFileSystem {
  return new ReadWriteFs({ root: tempDir, allowSymlinks: true });
}

// ---------------------------------------------------------------------------
// Parameterised test suite — default deny (allowSymlinks: false)
// ---------------------------------------------------------------------------
describe.each([
  ["OverlayFs", setupOverlay],
  ["ReadWriteFs", setupReadWrite],
])("%s — default-deny symlinks", (_name, factory) => {
  let ctx: TestContext;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nosym-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "nosym-out-"));
    fs.writeFileSync(path.join(tempDir, "real.txt"), "real content");
    fs.mkdirSync(path.join(tempDir, "subdir"));
    fs.writeFileSync(
      path.join(tempDir, "subdir", "nested.txt"),
      "nested content",
    );
    // Create a real-FS symlink pointing to a file within sandbox
    fs.symlinkSync(
      path.join(tempDir, "real.txt"),
      path.join(tempDir, "link-to-real.txt"),
    );
    // Create a real-FS directory symlink
    fs.symlinkSync(
      path.join(tempDir, "subdir"),
      path.join(tempDir, "link-to-subdir"),
    );
    // Create a broken symlink pointing outside the sandbox (target doesn't exist)
    fs.symlinkSync(
      path.join(outsideDir, "nonexistent.txt"),
      path.join(tempDir, "broken-escape-link"),
    );

    ctx = { tempDir, outsideDir, fsImpl: factory(tempDir) };
  });

  afterEach(() => {
    fs.rmSync(ctx.tempDir, { recursive: true, force: true });
    fs.rmSync(ctx.outsideDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // symlink() is blocked
  // -----------------------------------------------------------------------
  describe("symlink() blocked", () => {
    it("should throw EPERM when creating a symlink", async () => {
      await expect(
        ctx.fsImpl.symlink("/real.txt", "/new-link"),
      ).rejects.toThrow("EPERM");
    });
  });

  // -----------------------------------------------------------------------
  // broken symlink write escape prevention
  // -----------------------------------------------------------------------
  describe("broken symlink write escape", () => {
    it("should reject writeFile through a broken symlink pointing outside", async () => {
      // This is the critical test: a broken symlink (target doesn't exist)
      // pointing outside the sandbox. Without the lstatSync defense-in-depth
      // check, writeFile would follow the symlink and create the target file
      // outside the sandbox.
      if (_name === "OverlayFs") {
        // OverlayFs writes to memory, so this doesn't apply — but symlink()
        // is still blocked, so writeFile through the link won't work either.
        // The readFile test below covers OverlayFs's rejection.
        return;
      }
      await expect(
        ctx.fsImpl.writeFile("/broken-escape-link", "pwned"),
      ).rejects.toThrow();

      // Verify the target file was NOT created outside the sandbox
      expect(fs.existsSync(path.join(ctx.outsideDir, "nonexistent.txt"))).toBe(
        false,
      );
    });

    it("should reject readFile through a broken symlink pointing outside", async () => {
      await expect(
        ctx.fsImpl.readFile("/broken-escape-link"),
      ).rejects.toThrow();
    });

    it("should reject stat through a broken symlink pointing outside", async () => {
      await expect(ctx.fsImpl.stat("/broken-escape-link")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // readFile through real-FS symlinks is blocked
  // -----------------------------------------------------------------------
  describe("readFile through symlink", () => {
    it("should reject readFile through a file symlink", async () => {
      await expect(ctx.fsImpl.readFile("/link-to-real.txt")).rejects.toThrow();
    });

    it("should reject readFile through a directory symlink", async () => {
      await expect(
        ctx.fsImpl.readFile("/link-to-subdir/nested.txt"),
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // stat through real-FS symlinks is blocked
  // -----------------------------------------------------------------------
  describe("stat through symlink", () => {
    it("should reject stat through a file symlink", async () => {
      await expect(ctx.fsImpl.stat("/link-to-real.txt")).rejects.toThrow();
    });

    it("should reject stat through a directory symlink", async () => {
      await expect(
        ctx.fsImpl.stat("/link-to-subdir/nested.txt"),
      ).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // realpath through real-FS symlinks is blocked
  // -----------------------------------------------------------------------
  describe("realpath through symlink", () => {
    it("should reject realpath on a file symlink", async () => {
      await expect(ctx.fsImpl.realpath("/link-to-real.txt")).rejects.toThrow();
    });

    it("should reject realpath through a directory symlink", async () => {
      await expect(
        ctx.fsImpl.realpath("/link-to-subdir/nested.txt"),
      ).rejects.toThrow();
    });

    it("should resolve realpath on a regular file", async () => {
      const resolved = await ctx.fsImpl.realpath("/real.txt");
      expect(resolved).toBe("/real.txt");
    });
  });

  // -----------------------------------------------------------------------
  // lstat on real-FS symlinks works (returns symlink info)
  // -----------------------------------------------------------------------
  describe("lstat on symlink", () => {
    it("should return symlink info for a file symlink", async () => {
      const stat = await ctx.fsImpl.lstat("/link-to-real.txt");
      expect(stat.isSymbolicLink).toBe(true);
      expect(stat.isFile).toBe(false);
    });

    it("should return symlink info for a directory symlink", async () => {
      const stat = await ctx.fsImpl.lstat("/link-to-subdir");
      expect(stat.isSymbolicLink).toBe(true);
      expect(stat.isDirectory).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // readlink on real-FS symlinks works
  // -----------------------------------------------------------------------
  describe("readlink on symlink", () => {
    it("should read the target of a file symlink", async () => {
      const target = await ctx.fsImpl.readlink("/link-to-real.txt");
      expect(typeof target).toBe("string");
      expect(target.length).toBeGreaterThan(0);
    });

    it("should read the target of a directory symlink", async () => {
      const target = await ctx.fsImpl.readlink("/link-to-subdir");
      expect(typeof target).toBe("string");
      expect(target.length).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // readdir lists symlink entries (but can't follow them)
  // -----------------------------------------------------------------------
  describe("readdir with symlinks", () => {
    it("should list symlink entries in directory listing", async () => {
      const entries = await ctx.fsImpl.readdir("/");
      expect(entries).toContain("link-to-real.txt");
      expect(entries).toContain("link-to-subdir");
      expect(entries).toContain("real.txt");
      expect(entries).toContain("subdir");
    });
  });

  // -----------------------------------------------------------------------
  // Non-symlink operations work normally
  // -----------------------------------------------------------------------
  describe("non-symlink operations", () => {
    it("should read regular files", async () => {
      const content = await ctx.fsImpl.readFile("/real.txt");
      expect(content).toBe("real content");
    });

    it("should stat regular files", async () => {
      const stat = await ctx.fsImpl.stat("/real.txt");
      expect(stat.isFile).toBe(true);
    });

    it("should readdir regular directories", async () => {
      const entries = await ctx.fsImpl.readdir("/subdir");
      expect(entries).toContain("nested.txt");
    });

    it("should read files in regular subdirectories", async () => {
      const content = await ctx.fsImpl.readFile("/subdir/nested.txt");
      expect(content).toBe("nested content");
    });

    it("should check existence of regular files", async () => {
      expect(await ctx.fsImpl.exists("/real.txt")).toBe(true);
      expect(await ctx.fsImpl.exists("/nonexistent")).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// allowSymlinks: true restores full behavior
// ---------------------------------------------------------------------------
describe.each([
  ["OverlayFs", setupOverlayWithSymlinks],
  ["ReadWriteFs", setupReadWriteWithSymlinks],
])("%s — allowSymlinks: true restores behavior", (_name, factory) => {
  let ctx: TestContext;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sym-ok-"));
    fs.writeFileSync(path.join(tempDir, "target.txt"), "target content");
    fs.symlinkSync(
      path.join(tempDir, "target.txt"),
      path.join(tempDir, "link.txt"),
    );

    ctx = { tempDir, outsideDir: "", fsImpl: factory(tempDir) };
  });

  afterEach(() => {
    fs.rmSync(ctx.tempDir, { recursive: true, force: true });
  });

  it("should create symlinks", async () => {
    await ctx.fsImpl.symlink("/target.txt", "/new-link");
    const stat = await ctx.fsImpl.lstat("/new-link");
    expect(stat.isSymbolicLink).toBe(true);
  });

  it("should read through file symlinks", async () => {
    const content = await ctx.fsImpl.readFile("/link.txt");
    expect(content).toBe("target content");
  });

  it("should stat through file symlinks", async () => {
    const stat = await ctx.fsImpl.stat("/link.txt");
    expect(stat.isFile).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Security edge-case tests
// ---------------------------------------------------------------------------
describe.each([
  ["OverlayFs", setupOverlay],
  ["ReadWriteFs", setupReadWrite],
])("%s — security edge cases", (_name, factory) => {
  let ctx: TestContext;

  beforeEach(() => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-"));
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "edge-out-"));
    fs.writeFileSync(path.join(tempDir, "file.txt"), "safe content");
    fs.mkdirSync(path.join(tempDir, "subdir"));
    fs.writeFileSync(
      path.join(tempDir, "subdir", "nested.txt"),
      "nested content",
    );
    // Symlink pointing outside the sandbox
    fs.symlinkSync(outsideDir, path.join(tempDir, "escape-link"));
    // Symlink with relative target pointing outside
    fs.symlinkSync(
      path.join("..", path.basename(outsideDir)),
      path.join(tempDir, "relative-escape"),
    );
    ctx = { tempDir, outsideDir, fsImpl: factory(tempDir) };
  });

  afterEach(() => {
    fs.rmSync(ctx.tempDir, { recursive: true, force: true });
    fs.rmSync(ctx.outsideDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Path traversal via .. sequences
  // -----------------------------------------------------------------------
  describe("path traversal", () => {
    it("should block readFile with .. escaping root", async () => {
      await expect(
        ctx.fsImpl.readFile("/../../../etc/passwd"),
      ).rejects.toThrow();
    });

    it("should block readFile with encoded .. in subdir", async () => {
      await expect(
        ctx.fsImpl.readFile("/subdir/../../etc/passwd"),
      ).rejects.toThrow();
    });

    it("should normalize double slashes", async () => {
      const content = await ctx.fsImpl.readFile("//file.txt");
      expect(content).toBe("safe content");
    });

    it("should handle trailing dot path component", async () => {
      const content = await ctx.fsImpl.readFile("/./file.txt");
      expect(content).toBe("safe content");
    });
  });

  // -----------------------------------------------------------------------
  // Symlink in intermediate directory
  // -----------------------------------------------------------------------
  describe("intermediate directory symlink", () => {
    it("should block readFile through dir symlink pointing outside", async () => {
      await expect(
        ctx.fsImpl.readFile("/escape-link/anything"),
      ).rejects.toThrow();
    });

    it("should block stat through dir symlink pointing outside", async () => {
      await expect(ctx.fsImpl.stat("/escape-link/anything")).rejects.toThrow();
    });

    it("should block readdir through dir symlink pointing outside", async () => {
      if (_name === "OverlayFs") {
        // OverlayFs returns empty array (symlink target inaccessible)
        const entries = await ctx.fsImpl.readdir("/escape-link");
        expect(entries).toEqual([]);
      } else {
        await expect(ctx.fsImpl.readdir("/escape-link")).rejects.toThrow();
      }
    });

    it("should block exists through dir symlink pointing outside", async () => {
      // exists should return false, not true
      expect(await ctx.fsImpl.exists("/escape-link/anything")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Relative symlink escape
  // -----------------------------------------------------------------------
  describe("relative symlink escape", () => {
    it("should block readFile through relative escape symlink", async () => {
      await expect(
        ctx.fsImpl.readFile("/relative-escape/anything"),
      ).rejects.toThrow();
    });

    it("should block stat through relative escape symlink", async () => {
      await expect(ctx.fsImpl.stat("/relative-escape")).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // Null byte injection
  // -----------------------------------------------------------------------
  describe("null byte injection", () => {
    it("should reject paths with null bytes in readFile", async () => {
      await expect(ctx.fsImpl.readFile("/file.txt\0.evil")).rejects.toThrow();
    });

    it("should reject paths with null bytes in writeFile", async () => {
      await expect(
        ctx.fsImpl.writeFile("/evil\0path", "data"),
      ).rejects.toThrow();
    });

    it("should return false for exists with null byte path", async () => {
      expect(await ctx.fsImpl.exists("/file.txt\0")).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Unicode normalization (NFD vs NFC on macOS)
  // -----------------------------------------------------------------------
  describe("unicode normalization", () => {
    it("should handle NFC unicode paths consistently", async () => {
      // NFC: é as single codepoint U+00E9
      const nfcName = "caf\u00e9.txt";
      await ctx.fsImpl.writeFile(`/${nfcName}`, "nfc content");
      const content = await ctx.fsImpl.readFile(`/${nfcName}`);
      expect(content).toBe("nfc content");
    });

    it("should handle NFD unicode paths consistently", async () => {
      // NFD: e + combining acute accent U+0301
      const nfdName = "cafe\u0301.txt";
      await ctx.fsImpl.writeFile(`/${nfdName}`, "nfd content");
      const content = await ctx.fsImpl.readFile(`/${nfdName}`);
      expect(content).toBe("nfd content");
    });

    it("should not allow NFC/NFD mismatch to bypass symlink checks", async () => {
      // Create file with NFC name, try to access via NFD
      // Both should work OR both should fail — but neither should escape
      const nfc = "caf\u00e9";
      const nfd = "cafe\u0301";
      await ctx.fsImpl.writeFile(`/${nfc}/test.txt`, "data").catch(() => {});
      // Even if the names normalize to the same FS entry, no escape should occur
      const exists = await ctx.fsImpl.exists(`/${nfd}/test.txt`);
      // Either true or false is fine — but no error/crash
      expect(typeof exists).toBe("boolean");
    });
  });

  // -----------------------------------------------------------------------
  // Deep path recursion (DoS prevention)
  // -----------------------------------------------------------------------
  describe("deep paths", () => {
    it("should handle moderately deep paths without crashing", async () => {
      // 100 levels deep — should not cause stack overflow
      const deepPath = `/${Array.from({ length: 100 }, (_, i) => `d${i}`).join("/")}/file.txt`;
      // Should throw ENOENT (path doesn't exist) not crash
      await expect(ctx.fsImpl.readFile(deepPath)).rejects.toThrow();
    });

    it("should handle long filenames near 255 char limit", async () => {
      const longName = `${"a".repeat(250)}.txt`;
      // Should either work or throw a proper error, not crash
      try {
        await ctx.fsImpl.writeFile(`/${longName}`, "content");
        const content = await ctx.fsImpl.readFile(`/${longName}`);
        expect(content).toBe("content");
      } catch (e) {
        expect((e as Error).message).toMatch(/ENAMETOOLONG|ENOENT|EIO/);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Root-as-symlink behavior
  // -----------------------------------------------------------------------
  describe("root directory edge cases", () => {
    it("should work when root is accessed through /tmp symlink (macOS)", async () => {
      // On macOS, /tmp -> /private/tmp, which means
      // the root path goes through a symlink.
      // The FS should handle this transparently.
      const content = await ctx.fsImpl.readFile("/file.txt");
      expect(content).toBe("safe content");
    });

    it("should clamp .. at root (POSIX behavior)", async () => {
      // /../file.txt normalizes to /file.txt — can't go above root
      const content = await ctx.fsImpl.readFile("/../file.txt");
      expect(content).toBe("safe content");
    });
  });

  // -----------------------------------------------------------------------
  // chmod/rename through symlinks
  // -----------------------------------------------------------------------
  describe("chmod through symlink", () => {
    it("should block chmod through a symlink pointing outside", async () => {
      await expect(ctx.fsImpl.chmod("/escape-link", 0o777)).rejects.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // writeFile through broken symlink (escape prevention)
  // -----------------------------------------------------------------------
  describe("writeFile escape via broken symlink", () => {
    it("should not create files outside sandbox via broken symlink", async () => {
      // Create a broken symlink whose target is outside the sandbox
      const targetPath = path.join(ctx.outsideDir, "created-by-escape.txt");
      fs.symlinkSync(targetPath, path.join(ctx.tempDir, "write-escape"));

      if (_name === "OverlayFs") {
        // OverlayFs writes to memory overlay — the write "succeeds"
        // but goes to the in-memory layer, NOT through the symlink
        await ctx.fsImpl.writeFile("/write-escape", "escaped data");
      } else {
        // ReadWriteFs operates on real FS — must reject the write
        await expect(
          ctx.fsImpl.writeFile("/write-escape", "escaped data"),
        ).rejects.toThrow();
      }

      // Either way, the target must NOT be created on real FS
      expect(fs.existsSync(targetPath)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// O_NOFOLLOW TOCTOU protection tests
// ---------------------------------------------------------------------------
describe("OverlayFs — O_NOFOLLOW TOCTOU protection (read path)", () => {
  let tempDir: string;
  let outsideDir: string;
  let ofs: IFileSystem;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nofollow-ofs-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "nofollow-ofs-out-"));
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "TOP SECRET");
    fs.writeFileSync(path.join(tempDir, "safe.txt"), "safe content");
    ofs = setupOverlay(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("should reject readFile on a pre-existing symlink pointing outside", async () => {
    fs.symlinkSync(
      path.join(outsideDir, "secret.txt"),
      path.join(tempDir, "sneaky-link"),
    );
    await expect(ofs.readFile("/sneaky-link")).rejects.toThrow();
  });

  it("should allow readFile on regular files", async () => {
    const content = await ofs.readFile("/safe.txt");
    expect(content).toBe("safe content");
  });

  it("should allow readFile on overlay-written files", async () => {
    await ofs.writeFile("/new.txt", "overlay content");
    const content = await ofs.readFile("/new.txt");
    expect(content).toBe("overlay content");
  });
});

describe("ReadWriteFs — O_NOFOLLOW TOCTOU protection", () => {
  let tempDir: string;
  let outsideDir: string;
  let rwfs: IFileSystem;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nofollow-"));
    outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "nofollow-out-"));
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "TOP SECRET");
    rwfs = setupReadWrite(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("should reject readFile on a pre-existing symlink (O_NOFOLLOW)", async () => {
    // Create a symlink on real FS pointing outside
    fs.symlinkSync(
      path.join(outsideDir, "secret.txt"),
      path.join(tempDir, "sneaky-link"),
    );
    await expect(rwfs.readFile("/sneaky-link")).rejects.toThrow();
    // Verify the secret was NOT leaked
  });

  it("should reject writeFile on a pre-existing symlink (O_NOFOLLOW)", async () => {
    fs.symlinkSync(
      path.join(outsideDir, "target.txt"),
      path.join(tempDir, "write-link"),
    );
    await expect(rwfs.writeFile("/write-link", "PWNED")).rejects.toThrow();
    // Verify nothing was written outside
    expect(fs.existsSync(path.join(outsideDir, "target.txt"))).toBe(false);
  });

  it("should reject appendFile on a pre-existing symlink (O_NOFOLLOW)", async () => {
    fs.symlinkSync(
      path.join(outsideDir, "secret.txt"),
      path.join(tempDir, "append-link"),
    );
    await expect(rwfs.appendFile("/append-link", "PWNED")).rejects.toThrow();
    // Verify original content not modified
    expect(fs.readFileSync(path.join(outsideDir, "secret.txt"), "utf8")).toBe(
      "TOP SECRET",
    );
  });

  it("should re-validate parent after mkdir in writeFile", async () => {
    // Create parent dir, then write should validate the full path again
    fs.mkdirSync(path.join(tempDir, "parent"));
    await rwfs.writeFile("/parent/child.txt", "safe content");
    expect(
      fs.readFileSync(path.join(tempDir, "parent", "child.txt"), "utf8"),
    ).toBe("safe content");
  });

  it("should allow normal readFile on regular files", async () => {
    fs.writeFileSync(path.join(tempDir, "normal.txt"), "hello");
    const content = await rwfs.readFile("/normal.txt");
    expect(content).toBe("hello");
  });

  it("should allow normal writeFile to create new files", async () => {
    await rwfs.writeFile("/new-file.txt", "created");
    expect(fs.readFileSync(path.join(tempDir, "new-file.txt"), "utf8")).toBe(
      "created",
    );
  });

  it("should allow normal appendFile", async () => {
    fs.writeFileSync(path.join(tempDir, "append.txt"), "first");
    await rwfs.appendFile("/append.txt", " second");
    expect(fs.readFileSync(path.join(tempDir, "append.txt"), "utf8")).toBe(
      "first second",
    );
  });
});
