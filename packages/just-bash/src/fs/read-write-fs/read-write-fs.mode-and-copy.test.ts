import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs replacement mode and copy behavior", () => {
  let root: string;
  let rwfs: ReadWriteFs;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-mode-copy-"));
    rwfs = new ReadWriteFs({ root });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("clears set-user-ID and set-group-ID bits on overwrite", async () => {
    const target = path.join(root, "overwrite.sh");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o6755);

    await rwfs.writeFile("/overwrite.sh", "new");

    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.statSync(target).mode & 0o7777).toBe(0o755);
  });

  it("clears set-user-ID and set-group-ID bits on append", async () => {
    const target = path.join(root, "append.sh");
    fs.writeFileSync(target, "old");
    fs.chmodSync(target, 0o6755);

    await rwfs.appendFile("/append.sh", "new");

    expect(fs.readFileSync(target, "utf8")).toBe("oldnew");
    expect(fs.statSync(target).mode & 0o7777).toBe(0o755);
  });

  it("does not propagate special mode bits from a copied source", async () => {
    const source = path.join(root, "source.sh");
    const destination = path.join(root, "destination.sh");
    fs.writeFileSync(source, "content");
    fs.chmodSync(source, 0o6755);

    await rwfs.cp("/source.sh", "/destination.sh");

    expect(fs.statSync(source).mode & 0o7777).toBe(0o6755);
    expect(fs.statSync(destination).mode & 0o7777).toBe(0o755);
  });

  it("preserves special mode bits during metadata-only utimes", async () => {
    const target = path.join(root, "metadata.sh");
    const changed = new Date("2020-06-01T00:00:00.000Z");
    fs.writeFileSync(target, "content");
    fs.chmodSync(target, 0o4755);

    await rwfs.utimes("/metadata.sh", changed, changed);

    expect(fs.statSync(target).mode & 0o7777).toBe(0o4755);
    expect(fs.statSync(target).mtimeMs).toBe(changed.getTime());
  });

  it.skipIf(process.platform !== "linux")(
    "retries without O_NOATIME when the kernel returns EPERM",
    async () => {
      const source = path.join(root, "source.txt");
      fs.writeFileSync(source, "content");
      const originalOpen = fs.promises.open.bind(fs.promises);
      const attemptedFlags: number[] = [];
      vi.spyOn(fs.promises, "open").mockImplementation(
        async (filePath, flags, mode) => {
          if (filePath === source && typeof flags === "number") {
            attemptedFlags.push(flags);
            if ((flags & 0o1000000) !== 0) {
              throw Object.assign(new Error("not inode owner"), {
                code: "EPERM",
              });
            }
          }
          return originalOpen(filePath, flags, mode);
        },
      );

      await rwfs.cp("/source.txt", "/destination.txt");

      expect(fs.readFileSync(path.join(root, "destination.txt"), "utf8")).toBe(
        "content",
      );
      expect(attemptedFlags).toHaveLength(2);
      expect(attemptedFlags[0] & 0o1000000).toBe(0o1000000);
      expect(attemptedFlags[1] & 0o1000000).toBe(0);
    },
  );

  it("appends beyond the default read-size limit", async () => {
    const target = path.join(root, "large.log");
    const originalSize = 10 * 1024 * 1024 + 1;
    fs.writeFileSync(target, "");
    fs.truncateSync(target, originalSize);

    await rwfs.appendFile("/large.log", "tail");

    expect(fs.statSync(target).size).toBe(originalSize + 4);
    const fh = fs.openSync(target, "r");
    try {
      const tail = Buffer.alloc(4);
      fs.readSync(fh, tail, 0, tail.length, originalSize);
      expect(tail.toString()).toBe("tail");
    } finally {
      fs.closeSync(fh);
    }
  });
});
