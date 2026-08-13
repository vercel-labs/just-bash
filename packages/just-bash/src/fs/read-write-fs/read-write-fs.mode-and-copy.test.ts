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

  it.skipIf(process.platform === "win32")(
    "overwrites a private writable file in a non-writable directory",
    async () => {
      const directory = path.join(root, "locked-parent");
      const target = path.join(directory, "target.txt");
      fs.mkdirSync(directory);
      fs.writeFileSync(target, "old");
      fs.chmodSync(target, 0o600);
      fs.chmodSync(directory, 0o500);

      try {
        await rwfs.writeFile("/locked-parent/target.txt", "new");
        expect(fs.readFileSync(target, "utf8")).toBe("new");
      } finally {
        fs.chmodSync(directory, 0o700);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "appends to a private write-only regular file",
    async () => {
      const target = path.join(root, "write-only.log");
      fs.writeFileSync(target, "before");
      fs.chmodSync(target, 0o200);

      try {
        await rwfs.appendFile("/write-only.log", "-after");
        fs.chmodSync(target, 0o600);
        expect(fs.readFileSync(target, "utf8")).toBe("before-after");
      } finally {
        fs.chmodSync(target, 0o600);
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "changes metadata on a private mode-000 regular file",
    async () => {
      const target = path.join(root, "private.txt");
      const changed = new Date("2020-09-01T00:00:00.000Z");
      fs.writeFileSync(target, "content");
      fs.chmodSync(target, 0o000);

      await rwfs.utimes("/private.txt", changed, changed);
      await rwfs.chmod("/private.txt", 0o640);

      const stat = fs.statSync(target);
      expect(stat.mode & 0o777).toBe(0o640);
      expect(stat.mtimeMs).toBe(changed.getTime());
    },
  );

  it("bounds implicit copies of multiply-linked files", async () => {
    const target = path.join(root, "shared.txt");
    const alias = path.join(root, "shared-alias.txt");
    fs.writeFileSync(target, "content");
    fs.linkSync(target, alias);
    const limited = new ReadWriteFs({ root, maxCopyOnWriteSize: 4 });
    const changed = new Date("2020-10-01T00:00:00.000Z");

    await expect(limited.appendFile("/shared.txt", "tail")).rejects.toThrow(
      "file too large for copy-on-write append '/shared.txt' (7 bytes, max 4)",
    );
    await expect(limited.chmod("/shared.txt", 0o600)).rejects.toThrow(
      "file too large for copy-on-write chmod '/shared.txt' (7 bytes, max 4)",
    );
    await expect(
      limited.utimes("/shared.txt", changed, changed),
    ).rejects.toThrow(
      "file too large for copy-on-write utimes '/shared.txt' (7 bytes, max 4)",
    );

    expect(fs.readFileSync(target, "utf8")).toBe("content");
    expect(fs.readFileSync(alias, "utf8")).toBe("content");
  });

  it("allows overwrite without copying a multiply-linked source", async () => {
    const target = path.join(root, "shared.txt");
    const alias = path.join(root, "shared-alias.txt");
    fs.writeFileSync(target, "content");
    fs.linkSync(target, alias);
    const limited = new ReadWriteFs({ root, maxCopyOnWriteSize: 1 });

    await limited.writeFile("/shared.txt", "replacement");

    expect(fs.readFileSync(target, "utf8")).toBe("replacement");
    expect(fs.readFileSync(alias, "utf8")).toBe("content");
  });
});
