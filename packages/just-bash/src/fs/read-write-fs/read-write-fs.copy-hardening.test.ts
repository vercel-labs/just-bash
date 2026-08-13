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
