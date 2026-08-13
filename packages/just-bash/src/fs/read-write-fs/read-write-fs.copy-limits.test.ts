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

  it("rejects a sparse source above the default copy limit", async () => {
    const source = path.join(root, "sparse.img");
    fs.writeFileSync(source, "");
    fs.truncateSync(source, 100 * 1024 * 1024 + 1);
    const rwfs = new ReadWriteFs({ root });

    await expect(rwfs.cp("/sparse.img", "/copy.img")).rejects.toThrow(
      "sparse file too large to copy '/sparse.img'",
    );

    expect(fs.existsSync(path.join(root, "copy.img"))).toBe(false);
  });

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

  it("honors a configured sparse copy limit", async () => {
    const source = path.join(root, "sparse.img");
    fs.writeFileSync(source, "");
    fs.truncateSync(source, 8192);
    const rwfs = new ReadWriteFs({ root, maxSparseCopySize: 4 });

    await expect(rwfs.cp("/sparse.img", "/copy.img")).rejects.toThrow(
      "sparse file too large to copy '/sparse.img' (8192 bytes, max 4)",
    );
    expect(fs.existsSync(path.join(root, "copy.img"))).toBe(false);
  });

  it("honors a configured explicit copy limit", async () => {
    fs.writeFileSync(path.join(root, "source.txt"), "content");
    const rwfs = new ReadWriteFs({ root, maxCopySize: 4 });

    await expect(rwfs.cp("/source.txt", "/copy.txt")).rejects.toThrow(
      "file too large to copy '/source.txt' (7 bytes, max 4)",
    );
    expect(fs.existsSync(path.join(root, "copy.txt"))).toBe(false);
  });

  it("does not synthesize an O_NOATIME flag absent from the runtime", async () => {
    const source = path.join(root, "source.txt");
    fs.writeFileSync(source, "content");
    const canonicalSource = fs.realpathSync(source);
    const descriptor = Object.getOwnPropertyDescriptor(
      fs.constants,
      "O_NOATIME",
    );
    Object.defineProperty(fs.constants, "O_NOATIME", {
      configurable: true,
      value: undefined,
    });
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

    try {
      await new ReadWriteFs({ root }).cp("/source.txt", "/copy.txt");
    } finally {
      if (descriptor) {
        Object.defineProperty(fs.constants, "O_NOATIME", descriptor);
      } else {
        delete (fs.constants as { O_NOATIME?: number }).O_NOATIME;
      }
    }

    expect(attemptedFlags).toEqual([
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    ]);
  });

  it.skipIf(process.platform !== "linux")(
    "uses a runtime O_NOATIME flag and retries after EPERM",
    async () => {
      const source = path.join(root, "source.txt");
      fs.writeFileSync(source, "content");
      const canonicalSource = fs.realpathSync(source);
      const descriptor = Object.getOwnPropertyDescriptor(
        fs.constants,
        "O_NOATIME",
      );
      const noAtime = 0x20000000;
      Object.defineProperty(fs.constants, "O_NOATIME", {
        configurable: true,
        value: noAtime,
      });
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

      try {
        await new ReadWriteFs({ root }).cp("/source.txt", "/copy.txt");
      } finally {
        if (descriptor) {
          Object.defineProperty(fs.constants, "O_NOATIME", descriptor);
        } else {
          delete (fs.constants as { O_NOATIME?: number }).O_NOATIME;
        }
      }

      expect(attemptedFlags).toHaveLength(2);
      expect(attemptedFlags[0] & noAtime).toBe(noAtime);
      expect(attemptedFlags[1] & noAtime).toBe(0);
    },
  );
});
