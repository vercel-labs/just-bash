/**
 * Unit tests for shared real-fs-utils.
 *
 * These validate security-critical path logic in isolation,
 * independent of any particular filesystem implementation.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isPathWithinRoot,
  normalizePath,
  sanitizeSymlinkTarget,
  validatePath,
  validateRealPath,
  validateRootDirectory,
} from "./real-fs-utils.js";

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------
describe("normalizePath", () => {
  it("returns / for empty string", () => {
    expect(normalizePath("")).toBe("/");
  });

  it("returns / for /", () => {
    expect(normalizePath("/")).toBe("/");
  });

  it("strips trailing slash", () => {
    expect(normalizePath("/foo/")).toBe("/foo");
  });

  it("resolves . segments", () => {
    expect(normalizePath("/./foo/./bar/.")).toBe("/foo/bar");
  });

  it("resolves .. segments", () => {
    expect(normalizePath("/a/b/../c")).toBe("/a/c");
  });

  it("clamps .. at root", () => {
    expect(normalizePath("/../../..")).toBe("/");
  });

  it("handles multiple consecutive slashes", () => {
    expect(normalizePath("///a///b///")).toBe("/a/b");
  });

  it("adds leading / if missing", () => {
    expect(normalizePath("foo/bar")).toBe("/foo/bar");
  });

  it("handles deeply nested .. that resolves back to root", () => {
    expect(normalizePath("/a/b/c/d/../../../../")).toBe("/");
  });

  it("handles alternating . and .. segments", () => {
    expect(normalizePath("/a/./b/../c/./d/../e")).toBe("/a/c/e");
  });

  it("handles path with only dots and slashes", () => {
    expect(normalizePath("/././././..")).toBe("/");
  });

  it("preserves valid segments that look like dots", () => {
    expect(normalizePath("/...")).toBe("/...");
    expect(normalizePath("/..foo")).toBe("/..foo");
    expect(normalizePath("/foo..")).toBe("/foo..");
    expect(normalizePath("/a..b")).toBe("/a..b");
  });

  it("handles very long path", () => {
    const segments = Array(200).fill("a").join("/");
    const result = normalizePath(`/${segments}`);
    expect(result.split("/").length - 1).toBe(200);
  });

  it("handles path that is just slashes", () => {
    expect(normalizePath("////")).toBe("/");
  });
});

// ---------------------------------------------------------------------------
// isPathWithinRoot — boundary-safe prefix check
// ---------------------------------------------------------------------------
describe("isPathWithinRoot", () => {
  it("returns true for exact match", () => {
    expect(isPathWithinRoot("/sandbox", "/sandbox")).toBe(true);
  });

  it("returns true for child path", () => {
    expect(isPathWithinRoot("/sandbox/file.txt", "/sandbox")).toBe(true);
  });

  it("returns true for deeply nested child", () => {
    expect(isPathWithinRoot("/sandbox/a/b/c/d", "/sandbox")).toBe(true);
  });

  it("returns false for sibling with same prefix (boundary attack)", () => {
    // This is THE critical boundary check — /sandbox should NOT match /sandboxes
    expect(isPathWithinRoot("/sandboxes", "/sandbox")).toBe(false);
    expect(isPathWithinRoot("/sandbox-evil", "/sandbox")).toBe(false);
    expect(isPathWithinRoot("/sandboxfoo", "/sandbox")).toBe(false);
  });

  it("returns false for parent of root", () => {
    expect(isPathWithinRoot("/", "/sandbox")).toBe(false);
  });

  it("returns false for completely different path", () => {
    expect(isPathWithinRoot("/etc/passwd", "/sandbox")).toBe(false);
  });

  it("returns true when root is / (exact match)", () => {
    expect(isPathWithinRoot("/", "/")).toBe(true);
  });

  it("root=/ child check requires startsWith(//), so /anything is false", () => {
    // This is a known edge case: isPathWithinRoot is a low-level primitive
    // that checks `startsWith(root + "/")`. When root="/", the check becomes
    // `startsWith("//")`, which is intentionally strict. Callers that mount
    // at "/" handle this separately (OverlayFs uses getRelativeToMount).
    expect(isPathWithinRoot("/anything", "/")).toBe(false);
  });

  it("handles root with trailing component match", () => {
    // /tmp/data should not match path /tmp/datastore
    expect(isPathWithinRoot("/tmp/datastore", "/tmp/data")).toBe(false);
    expect(isPathWithinRoot("/tmp/data/file", "/tmp/data")).toBe(true);
  });

  it("handles Windows backslash separators", () => {
    expect(isPathWithinRoot("D:\\project\\file.txt", "D:\\project")).toBe(true);
    expect(isPathWithinRoot("D:\\project\\a\\b", "D:\\project")).toBe(true);
    expect(isPathWithinRoot("D:\\project", "D:\\project")).toBe(true);
    // boundary attack with backslash
    expect(isPathWithinRoot("D:\\projects", "D:\\project")).toBe(false);
    expect(isPathWithinRoot("D:\\project-evil", "D:\\project")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRealPath
// ---------------------------------------------------------------------------
describe("validateRealPath", () => {
  let tempDir: string;
  let canonicalRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vrp-"));
    canonicalRoot = fs.realpathSync(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns true for root itself", () => {
    expect(validateRealPath(tempDir, canonicalRoot)).toBe(true);
  });

  it("returns true for existing file inside root", () => {
    fs.writeFileSync(path.join(tempDir, "file.txt"), "ok");
    expect(
      validateRealPath(path.join(tempDir, "file.txt"), canonicalRoot),
    ).toBe(true);
  });

  it("returns true for non-existent file whose parent is inside root", () => {
    // Parent walk: non-existent file, parent exists and is inside root
    expect(
      validateRealPath(path.join(tempDir, "nonexistent.txt"), canonicalRoot),
    ).toBe(true);
  });

  it("returns true for deeply non-existent path inside root", () => {
    expect(
      validateRealPath(
        path.join(tempDir, "a", "b", "c", "d.txt"),
        canonicalRoot,
      ),
    ).toBe(true);
  });

  it("returns false for path outside root", () => {
    expect(validateRealPath("/etc/passwd", canonicalRoot)).toBe(false);
  });

  it("returns false for sibling directory (boundary attack)", () => {
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), "vrp-sibling-"));
    try {
      expect(validateRealPath(sibling, canonicalRoot)).toBe(false);
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it("returns false for root with same prefix but different dir", () => {
    // Create /tmp/vrp-XXXX and /tmp/vrp-XXXXextra to test boundary
    const evil = `${tempDir}extra`;
    fs.mkdirSync(evil);
    try {
      expect(validateRealPath(evil, canonicalRoot)).toBe(false);
    } finally {
      fs.rmSync(evil, { recursive: true, force: true });
    }
  });

  it("detects escape via real symlink to outside", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "vrp-outside-"));
    const link = path.join(tempDir, "escape-link");
    try {
      fs.symlinkSync(outside, link);
    } catch {
      fs.rmSync(outside, { recursive: true, force: true });
      return;
    }
    try {
      expect(validateRealPath(link, canonicalRoot)).toBe(false);
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("accepts internal symlink that stays within root", () => {
    fs.writeFileSync(path.join(tempDir, "target.txt"), "ok");
    const link = path.join(tempDir, "internal-link");
    try {
      fs.symlinkSync(path.join(tempDir, "target.txt"), link);
    } catch {
      return;
    }
    expect(validateRealPath(link, canonicalRoot)).toBe(true);
  });

  it("returns false for filesystem root /", () => {
    expect(validateRealPath("/", canonicalRoot)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateRootDirectory
// ---------------------------------------------------------------------------
describe("validateRootDirectory", () => {
  it("succeeds for existing directory", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vrd-"));
    try {
      expect(() => validateRootDirectory(tmp, "TestFs")).not.toThrow();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws for non-existent path", () => {
    expect(() =>
      validateRootDirectory("/nonexistent-abc-xyz-123", "TestFs"),
    ).toThrow("TestFs root does not exist");
  });

  it("throws for file instead of directory", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vrd-"));
    const file = path.join(tmp, "file.txt");
    fs.writeFileSync(file, "not a dir");
    try {
      expect(() => validateRootDirectory(file, "TestFs")).toThrow(
        "TestFs root is not a directory",
      );
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("includes fsName in error message", () => {
    expect(() =>
      validateRootDirectory("/no-such-path-xyzzy", "MyCustomFs"),
    ).toThrow("MyCustomFs");
  });
});

// ---------------------------------------------------------------------------
// validatePath — null-byte rejection
// ---------------------------------------------------------------------------
describe("validatePath", () => {
  it("passes for normal paths", () => {
    expect(() => validatePath("/foo/bar.txt", "open")).not.toThrow();
    expect(() => validatePath("/a/b/c", "stat")).not.toThrow();
    expect(() => validatePath("/", "readdir")).not.toThrow();
  });

  it("throws for null byte at start", () => {
    expect(() => validatePath("\x00/etc/passwd", "open")).toThrow("null byte");
  });

  it("throws for null byte in middle", () => {
    expect(() => validatePath("/etc\x00/passwd", "open")).toThrow("null byte");
  });

  it("throws for null byte at end", () => {
    expect(() => validatePath("/etc/passwd\x00", "open")).toThrow("null byte");
  });

  it("includes operation name in error message", () => {
    expect(() => validatePath("/bad\x00path", "chmod")).toThrow("chmod");
  });

  it("includes path in error message", () => {
    expect(() => validatePath("/a\x00b", "open")).toThrow("/a");
  });
});

// ---------------------------------------------------------------------------
// sanitizeSymlinkTarget
// ---------------------------------------------------------------------------
describe("sanitizeSymlinkTarget", () => {
  let tempDir: string;
  let canonicalRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sst-"));
    canonicalRoot = fs.realpathSync(tempDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns relative target as within-root", () => {
    const result = sanitizeSymlinkTarget("../foo.txt", canonicalRoot);
    expect(result.withinRoot).toBe(true);
    if (result.withinRoot) {
      expect(result.relativePath).toBe("../foo.txt");
    }
  });

  it("returns absolute target within root as within-root with relative path", () => {
    fs.writeFileSync(path.join(tempDir, "file.txt"), "ok");
    const result = sanitizeSymlinkTarget(
      path.join(tempDir, "file.txt"),
      canonicalRoot,
    );
    expect(result.withinRoot).toBe(true);
    if (result.withinRoot) {
      expect(result.relativePath).toBe("/file.txt");
    }
  });

  it("returns absolute target to root itself as within-root", () => {
    const result = sanitizeSymlinkTarget(tempDir, canonicalRoot);
    expect(result.withinRoot).toBe(true);
    if (result.withinRoot) {
      expect(result.relativePath).toBe("/");
    }
  });

  it("returns absolute outside target as not within root, with basename", () => {
    const result = sanitizeSymlinkTarget("/etc/passwd", canonicalRoot);
    expect(result.withinRoot).toBe(false);
    if (!result.withinRoot) {
      expect(result.safeName).toBe("passwd");
    }
  });

  it("returns basename for absolute outside target (no path leakage)", () => {
    const result = sanitizeSymlinkTarget(
      "/very/deep/secret/path/to/file.txt",
      canonicalRoot,
    );
    expect(result.withinRoot).toBe(false);
    if (!result.withinRoot) {
      expect(result.safeName).toBe("file.txt");
      // Must NOT leak the full path
      expect(result.safeName).not.toContain("/very/deep");
    }
  });

  it("handles symlink target to non-existent file within root", () => {
    // realpathSync fails for non-existent files, so sanitizeSymlinkTarget
    // falls back to path.resolve() which may not match canonicalRoot on
    // systems with symlinked tmp dirs (e.g. macOS /tmp -> /private/tmp).
    // The function correctly fails closed (reports outside) in that case.
    const result = sanitizeSymlinkTarget(
      path.join(tempDir, "nonexistent.txt"),
      canonicalRoot,
    );
    // On macOS: tempDir="/tmp/..." but canonicalRoot="/private/tmp/..."
    // so resolve(tempDir+"/nonexistent.txt") != canonicalRoot prefix
    if (tempDir !== canonicalRoot) {
      expect(result.withinRoot).toBe(false);
    } else {
      expect(result.withinRoot).toBe(true);
    }
  });

  it("handles boundary confusion (root prefix attack)", () => {
    // Ensure /tmp/sst-XXXXextra does not match /tmp/sst-XXXX
    const evil = `${tempDir}evil/file.txt`;
    const result = sanitizeSymlinkTarget(evil, canonicalRoot);
    expect(result.withinRoot).toBe(false);
  });
});
