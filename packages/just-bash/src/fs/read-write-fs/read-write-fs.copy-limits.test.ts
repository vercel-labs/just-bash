import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs copy limits and permissions", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-copy-limits-"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "does not replace a read-only destination in a writable directory",
    async () => {
      const source = path.join(root, "source.txt");
      const destination = path.join(root, "destination.txt");
      fs.writeFileSync(source, "new");
      fs.writeFileSync(destination, "old");
      fs.chmodSync(destination, 0o444);
      const rwfs = new ReadWriteFs({ root });

      try {
        await expect(
          rwfs.cp("/source.txt", "/destination.txt"),
        ).rejects.toThrow();
        expect(fs.readFileSync(destination, "utf8")).toBe("old");
      } finally {
        fs.chmodSync(destination, 0o600);
      }
    },
  );

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "documents replacement requiring a writable destination parent",
    async () => {
      const directory = path.join(root, "locked-parent");
      const source = path.join(root, "source.txt");
      const destination = path.join(directory, "destination.txt");
      fs.mkdirSync(directory);
      fs.writeFileSync(source, "new");
      fs.writeFileSync(destination, "old");
      fs.chmodSync(destination, 0o600);
      fs.chmodSync(directory, 0o500);
      const rwfs = new ReadWriteFs({ root });

      try {
        await expect(
          rwfs.cp("/source.txt", "/locked-parent/destination.txt"),
        ).rejects.toThrow();
        expect(fs.readFileSync(destination, "utf8")).toBe("old");
      } finally {
        fs.chmodSync(directory, 0o700);
      }
    },
  );

  it("keeps ordinary copies unlimited by default", async () => {
    const source = path.join(root, "source.txt");
    fs.writeFileSync(source, "content");
    const canonicalSource = fs.realpathSync(source);
    const actualLstat = fs.promises.lstat.bind(fs.promises);
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (target) => {
      const stat = await actualLstat(target);
      if (target !== canonicalSource) return stat;
      const largeStat = Object.create(stat) as fs.Stats;
      Object.defineProperties(largeStat, {
        blocks: { value: 300_000 },
        size: { value: 101 * 1024 * 1024 },
      });
      return largeStat;
    });

    await new ReadWriteFs({ root }).cp("/source.txt", "/copy.txt");

    expect(fs.readFileSync(path.join(root, "copy.txt"), "utf8")).toBe(
      "content",
    );
  });

  it("honors a configured explicit copy limit", async () => {
    fs.writeFileSync(path.join(root, "source.txt"), "content");
    const rwfs = new ReadWriteFs({ root, maxCopySize: 4 });

    await expect(rwfs.cp("/source.txt", "/copy.txt")).rejects.toThrow(
      "file too large to copy '/source.txt' (7 bytes, max 4)",
    );
    expect(fs.existsSync(path.join(root, "copy.txt"))).toBe(false);
  });

  it("opens copy sources without blocking on a file-type race", async () => {
    const source = path.join(root, "source.txt");
    fs.writeFileSync(source, "content");
    const canonicalSource = fs.realpathSync(source);
    const attemptedFlags: number[] = [];
    const originalOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementation(
      async (filePath, flags, mode) => {
        if (filePath === canonicalSource && typeof flags === "number") {
          attemptedFlags.push(flags);
        }
        return originalOpen(filePath, flags, mode);
      },
    );

    await new ReadWriteFs({ root }).cp("/source.txt", "/copy.txt");

    expect(attemptedFlags.length).toBeGreaterThan(0);
    expect(
      attemptedFlags.every((flags) => (flags & fs.constants.O_NONBLOCK) !== 0),
    ).toBe(true);
  });

  it.skipIf(fs.constants.O_NOATIME !== undefined)(
    "does not synthesize an O_NOATIME flag absent from the runtime",
    async () => {
      const source = path.join(root, "source.txt");
      fs.writeFileSync(source, "content");
      const canonicalSource = fs.realpathSync(source);
      const attemptedFlags: number[] = [];
      const originalOpen = fs.promises.open.bind(fs.promises);
      vi.spyOn(fs.promises, "open").mockImplementation(
        async (filePath, flags, mode) => {
          if (filePath === canonicalSource && typeof flags === "number") {
            attemptedFlags.push(flags);
          }
          return originalOpen(filePath, flags, mode);
        },
      );

      await new ReadWriteFs({ root }).cp("/source.txt", "/copy.txt");

      expect(attemptedFlags).toEqual([
        fs.constants.O_RDONLY |
          fs.constants.O_NONBLOCK |
          fs.constants.O_NOFOLLOW,
      ]);
    },
  );

  it.skipIf(
    process.platform !== "linux" || fs.constants.O_NOATIME === undefined,
  )("uses a runtime O_NOATIME flag and retries after EPERM", async () => {
    const source = path.join(root, "source.txt");
    fs.writeFileSync(source, "content");
    const canonicalSource = fs.realpathSync(source);
    const noAtime = fs.constants.O_NOATIME as number;
    const attemptedFlags: number[] = [];
    const originalOpen = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementation(
      async (filePath, flags, mode) => {
        if (filePath === canonicalSource && typeof flags === "number") {
          attemptedFlags.push(flags);
          if ((flags & noAtime) !== 0) {
            throw Object.assign(new Error("not inode owner"), {
              code: "EPERM",
            });
          }
        }
        return originalOpen(filePath, flags, mode);
      },
    );

    await new ReadWriteFs({ root }).cp("/source.txt", "/copy.txt");

    expect(attemptedFlags).toHaveLength(2);
    expect(attemptedFlags[0] & noAtime).toBe(noAtime);
    expect(attemptedFlags[1] & noAtime).toBe(0);
  });
});
