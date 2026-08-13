import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs recursive copy and append hardening", () => {
  let parentDir: string;
  let sandboxDir: string;
  let outsideDir: string;

  beforeEach(() => {
    parentDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-copy-hardening-"));
    sandboxDir = path.join(parentDir, "sandbox");
    outsideDir = path.join(parentDir, "outside");
    fs.mkdirSync(sandboxDir);
    fs.mkdirSync(outsideDir);
  });

  afterEach(() => {
    fs.rmSync(parentDir, { recursive: true, force: true });
  });

  it("copies safe nested symlinks when symlinks are enabled", async () => {
    const sourceDir = path.join(sandboxDir, "source");
    fs.mkdirSync(sourceDir);
    fs.writeFileSync(path.join(sourceDir, "target.txt"), "content");
    fs.symlinkSync("target.txt", path.join(sourceDir, "link.txt"));
    const rwfs = new ReadWriteFs({ root: sandboxDir, allowSymlinks: true });

    await rwfs.cp("/source", "/destination", { recursive: true });

    const copiedLink = path.join(sandboxDir, "destination", "link.txt");
    expect(fs.lstatSync(copiedLink).isSymbolicLink()).toBe(true);
    expect(await rwfs.readlink("/destination/link.txt")).toBe("target.txt");
    expect(fs.readFileSync(copiedLink, "utf8")).toBe("content");
  });

  it("preserves an absolute virtual symlink target at a different depth", async () => {
    fs.mkdirSync(path.join(sandboxDir, "source"));
    fs.writeFileSync(path.join(sandboxDir, "target.txt"), "content");
    const rwfs = new ReadWriteFs({ root: sandboxDir, allowSymlinks: true });
    await rwfs.symlink("/target.txt", "/source/link.txt");

    await rwfs.cp("/source/link.txt", "/deep/nested/link.txt");

    expect(fs.readlinkSync(path.join(sandboxDir, "deep/nested/link.txt"))).toBe(
      path.join(fs.realpathSync(sandboxDir), "target.txt"),
    );
    expect(await rwfs.readlink("/deep/nested/link.txt")).toBe(
      "../../target.txt",
    );
    expect(
      fs.readFileSync(path.join(sandboxDir, "deep/nested/link.txt"), "utf8"),
    ).toBe("content");
  });

  it("copies an absolute symlink through a symlink-spelled root", async () => {
    const realRoot = path.join(parentDir, "real-root");
    const rootAlias = path.join(parentDir, "root-alias");
    fs.mkdirSync(realRoot);
    fs.symlinkSync(realRoot, rootAlias, "dir");
    fs.mkdirSync(path.join(realRoot, "source"));
    fs.writeFileSync(path.join(realRoot, "target.txt"), "content");
    fs.symlinkSync(
      path.join(rootAlias, "target.txt"),
      path.join(realRoot, "source/link.txt"),
    );
    const rwfs = new ReadWriteFs({ root: rootAlias, allowSymlinks: true });

    await rwfs.cp("/source/link.txt", "/copied/link.txt");

    const copied = path.join(realRoot, "copied/link.txt");
    expect(fs.readlinkSync(copied)).toBe(
      path.join(fs.realpathSync(realRoot), "target.txt"),
    );
    expect(fs.readFileSync(copied, "utf8")).toBe("content");
  });

  it("preserves a relative symlink target when copying to a missing parent", async () => {
    fs.mkdirSync(path.join(sandboxDir, "source"));
    fs.writeFileSync(path.join(sandboxDir, "source/target.txt"), "content");
    fs.symlinkSync("target.txt", path.join(sandboxDir, "source/link.txt"));
    const rwfs = new ReadWriteFs({ root: sandboxDir, allowSymlinks: true });

    await rwfs.cp("/source/link.txt", "/missing/parent/link.txt");

    expect(
      fs.readlinkSync(path.join(sandboxDir, "missing/parent/link.txt")),
    ).toBe("target.txt");
    expect(
      fs
        .lstatSync(path.join(sandboxDir, "missing/parent/link.txt"))
        .isSymbolicLink(),
    ).toBe(true);
  });

  it("keeps a deep relative symlink inside the root when copied shallower", async () => {
    const sourceDir = path.join(sandboxDir, "deep/nested/source");
    const outsideCanary = path.join(outsideDir, "canary.txt");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(path.join(sandboxDir, "inside.txt"), "inside");
    fs.writeFileSync(outsideCanary, "outside");
    fs.symlinkSync("../../../inside.txt", path.join(sourceDir, "link.txt"));
    const rwfs = new ReadWriteFs({ root: sandboxDir, allowSymlinks: true });

    await rwfs.cp("/deep/nested/source/link.txt", "/copied-link.txt");

    const copiedLink = path.join(sandboxDir, "copied-link.txt");
    const rawTarget = fs.readlinkSync(copiedLink);
    const resolvedTarget = fs.realpathSync(copiedLink);
    const canonicalRoot = fs.realpathSync(sandboxDir);
    expect(rawTarget).toBe("inside.txt");
    expect(resolvedTarget).toBe(path.join(canonicalRoot, "inside.txt"));
    expect(
      resolvedTarget === canonicalRoot ||
        resolvedTarget.startsWith(`${canonicalRoot}${path.sep}`),
    ).toBe(true);
    expect(fs.readFileSync(copiedLink, "utf8")).toBe("inside");
    expect(fs.readFileSync(outsideCanary, "utf8")).toBe("outside");
  });

  it("rejects a regular file copied onto the same path", async () => {
    const source = path.join(sandboxDir, "same.txt");
    fs.writeFileSync(source, "content");
    const originalStat = fs.statSync(source);
    const rwfs = new ReadWriteFs({ root: sandboxDir });

    await expect(rwfs.cp("/same.txt", "/same.txt")).rejects.toThrow(
      "cannot copy '/same.txt' onto itself",
    );

    expect(fs.readFileSync(source, "utf8")).toBe("content");
    expect(fs.statSync(source).ino).toBe(originalStat.ino);
  });

  it("rejects a regular file copied onto a hard-link alias", async () => {
    const source = path.join(sandboxDir, "source.txt");
    const alias = path.join(sandboxDir, "alias.txt");
    fs.writeFileSync(source, "content");
    fs.linkSync(source, alias);
    const rwfs = new ReadWriteFs({ root: sandboxDir });

    await expect(rwfs.cp("/source.txt", "/alias.txt")).rejects.toThrow(
      "cannot copy '/source.txt' onto itself",
    );

    expect(fs.statSync(source).ino).toBe(fs.statSync(alias).ino);
  });

  it("rejects a symlink copied onto itself", async () => {
    fs.writeFileSync(path.join(sandboxDir, "target.txt"), "content");
    fs.symlinkSync("target.txt", path.join(sandboxDir, "link.txt"));
    const rwfs = new ReadWriteFs({ root: sandboxDir, allowSymlinks: true });

    await expect(rwfs.cp("/link.txt", "/link.txt")).rejects.toThrow(
      "cannot copy '/link.txt' onto itself",
    );

    expect(fs.readlinkSync(path.join(sandboxDir, "link.txt"))).toBe(
      "target.txt",
    );
  });

  it("rejects a nested destination directory symlink that escapes the root", async () => {
    fs.mkdirSync(path.join(sandboxDir, "source", "nested"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(sandboxDir, "source", "nested", "payload.txt"),
      "sandbox",
    );
    fs.mkdirSync(path.join(sandboxDir, "destination"));
    fs.symlinkSync(outsideDir, path.join(sandboxDir, "destination", "nested"));
    const rwfs = new ReadWriteFs({ root: sandboxDir });

    await expect(
      rwfs.cp("/source", "/destination", { recursive: true }),
    ).rejects.toThrow("resolves outside sandbox");

    expect(fs.existsSync(path.join(outsideDir, "payload.txt"))).toBe(false);
  });

  it("serializes appends through aliases of the same canonical file", async () => {
    fs.writeFileSync(path.join(sandboxDir, "target.txt"), "start");
    fs.symlinkSync("target.txt", path.join(sandboxDir, "first.txt"));
    fs.symlinkSync("target.txt", path.join(sandboxDir, "second.txt"));
    const rwfs = new ReadWriteFs({ root: sandboxDir, allowSymlinks: true });
    const appends = Array.from({ length: 20 }, (_, index) => `|${index}`);

    await Promise.all(
      appends.map((content, index) =>
        rwfs.appendFile(
          index % 2 === 0 ? "/first.txt" : "/second.txt",
          content,
        ),
      ),
    );

    const parts = fs
      .readFileSync(path.join(sandboxDir, "target.txt"), "utf8")
      .split("|");
    expect(parts[0]).toBe("start");
    expect(parts.slice(1).sort((a, b) => Number(a) - Number(b))).toEqual(
      appends.map((content) => content.slice(1)),
    );
  });

  it("fails closed if a shared append source changes before copying", async () => {
    const target = path.join(sandboxDir, "shared.txt");
    const alias = path.join(sandboxDir, "shared-alias.txt");
    const substituted = path.join(sandboxDir, "substituted.txt");
    fs.writeFileSync(target, "original");
    fs.linkSync(target, alias);
    fs.writeFileSync(substituted, "substituted");
    const canonicalTarget = fs.realpathSync(target);
    const originalOpen = fs.promises.open.bind(fs.promises);
    const openSpy = vi
      .spyOn(fs.promises, "open")
      .mockImplementation(async (filePath, flags, mode) => {
        if (
          filePath === canonicalTarget &&
          typeof flags === "number" &&
          (flags & 0b11) === fs.constants.O_RDONLY
        ) {
          return originalOpen(substituted, fs.constants.O_RDONLY);
        }
        return originalOpen(filePath, flags, mode);
      });
    const rwfs = new ReadWriteFs({ root: sandboxDir });

    try {
      await expect(rwfs.appendFile("/shared.txt", "-append")).rejects.toThrow(
        "file identity changed",
      );
    } finally {
      openSpy.mockRestore();
    }

    expect(fs.readFileSync(target, "utf8")).toBe("original");
    expect(fs.readFileSync(alias, "utf8")).toBe("original");
    expect(fs.readFileSync(substituted, "utf8")).toBe("substituted");
  });

  it("holds parent-changing mutations until a replacement write commits", async () => {
    fs.mkdirSync(path.join(sandboxDir, "parent"));
    const writer = new ReadWriteFs({ root: sandboxDir });
    const replacer = new ReadWriteFs({ root: sandboxDir });
    const originalOpen = fs.promises.open.bind(fs.promises);
    let releaseStaging!: () => void;
    const stagingGate = new Promise<void>((resolve) => {
      releaseStaging = resolve;
    });
    let stagingReached!: () => void;
    const reachedStaging = new Promise<void>((resolve) => {
      stagingReached = resolve;
    });
    const openSpy = vi
      .spyOn(fs.promises, "open")
      .mockImplementation(async (filePath, flags, mode) => {
        if (String(filePath).includes(".just-bash-write-")) {
          stagingReached();
          await stagingGate;
        }
        return originalOpen(filePath, flags, mode);
      });

    try {
      const write = writer.writeFile("/parent/victim.txt", "sandbox");
      await reachedStaging;
      let removalFinished = false;
      const removeParent = replacer
        .rm("/parent", { recursive: true })
        .then(() => {
          removalFinished = true;
        });

      await Promise.resolve();
      expect(removalFinished).toBe(false);

      releaseStaging();
      await Promise.all([write, removeParent]);
      expect(fs.existsSync(path.join(sandboxDir, "parent"))).toBe(false);
    } finally {
      releaseStaging();
      openSpy.mockRestore();
    }
  });

  it("allows mutations in unrelated roots to proceed independently", async () => {
    const otherRoot = path.join(parentDir, "other-sandbox");
    fs.mkdirSync(otherRoot);
    const canonicalSandboxDir = fs.realpathSync(sandboxDir);
    const writer = new ReadWriteFs({ root: sandboxDir });
    const unrelated = new ReadWriteFs({ root: otherRoot });
    const originalOpen = fs.promises.open.bind(fs.promises);
    let releaseStaging!: () => void;
    const stagingGate = new Promise<void>((resolve) => {
      releaseStaging = resolve;
    });
    let stagingReached!: () => void;
    const reachedStaging = new Promise<void>((resolve) => {
      stagingReached = resolve;
    });
    const openSpy = vi
      .spyOn(fs.promises, "open")
      .mockImplementation(async (filePath, flags, mode) => {
        if (
          String(filePath).startsWith(canonicalSandboxDir) &&
          String(filePath).includes(".just-bash-write-")
        ) {
          stagingReached();
          await stagingGate;
        }
        return originalOpen(filePath, flags, mode);
      });

    try {
      const blockedWrite = writer.writeFile("/blocked.txt", "blocked");
      await reachedStaging;

      await unrelated.writeFile("/independent.txt", "completed");
      expect(
        fs.readFileSync(path.join(otherRoot, "independent.txt"), "utf8"),
      ).toBe("completed");

      releaseStaging();
      await blockedWrite;
    } finally {
      releaseStaging();
      openSpy.mockRestore();
    }
  });

  it("serializes mutations in nested overlapping roots", async () => {
    const nestedRoot = path.join(sandboxDir, "nested");
    fs.mkdirSync(nestedRoot);
    const outer = new ReadWriteFs({ root: sandboxDir });
    const nested = new ReadWriteFs({ root: nestedRoot });
    const originalOpen = fs.promises.open.bind(fs.promises);
    let releaseStaging!: () => void;
    const stagingGate = new Promise<void>((resolve) => {
      releaseStaging = resolve;
    });
    let stagingReached!: () => void;
    const reachedStaging = new Promise<void>((resolve) => {
      stagingReached = resolve;
    });
    const openSpy = vi
      .spyOn(fs.promises, "open")
      .mockImplementation(async (filePath, flags, mode) => {
        if (String(filePath).includes(".just-bash-write-")) {
          stagingReached();
          await stagingGate;
        }
        return originalOpen(filePath, flags, mode);
      });

    try {
      const outerWrite = outer.writeFile("/outer.txt", "outer");
      await reachedStaging;
      let nestedFinished = false;
      const nestedWrite = nested.writeFile("/nested.txt", "nested").then(() => {
        nestedFinished = true;
      });

      await Promise.resolve();
      expect(nestedFinished).toBe(false);

      releaseStaging();
      await Promise.all([outerWrite, nestedWrite]);
      expect(fs.readFileSync(path.join(nestedRoot, "nested.txt"), "utf8")).toBe(
        "nested",
      );
    } finally {
      releaseStaging();
      openSpy.mockRestore();
    }
  });
});
