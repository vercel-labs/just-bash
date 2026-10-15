import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { OverlayFs } from "./overlay-fs.js";

describe("OverlayFs shared file entries", () => {
  let root: string;
  let overlay: OverlayFs;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-linked-entry-"));
    overlay = new OverlayFs({ root, mountPoint: "/", maxMemoryBytes: 8 });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([
    "memory",
    "backing",
  ])("shares writes and metadata for a %s file", async (source) => {
    if (source === "backing")
      fs.writeFileSync(path.join(root, "file"), "12345678");
    else await overlay.writeFile("/file", "12345678");
    await overlay.link("/file", "/alias");
    const original = await overlay.stat("/file");
    expect(await overlay.stat("/alias")).toEqual(original);

    await overlay.chmod("/alias", 0o600);
    await overlay.writeFile("/file", "ab");
    expect(await overlay.readFile("/alias")).toBe("ab");
    await overlay.appendFile("/alias", "cd");
    expect(await overlay.readFile("/file")).toBe("abcd");
    expect(await overlay.stat("/alias")).toEqual(await overlay.stat("/file"));

    overlay.writeFileSync("/alias", "12345678");
    expect(await overlay.readFile("/file")).toBe("12345678");
    await expect(overlay.appendFile("/file", "x")).rejects.toThrow("ENOSPC");
    expect(await overlay.readFile("/alias")).toBe("12345678");
    await overlay.rm("/file");
    await expect(overlay.writeFile("/other", "x")).rejects.toThrow("ENOSPC");
    await overlay.writeFile("/alias", "1234");
    await overlay.appendFile("/alias", "5678");
    expect(await overlay.stat("/alias")).toMatchObject({
      ino: original.ino,
      mode: 0o600,
      size: 8,
    });
    await overlay.rm("/alias");
    await expect(
      overlay.writeFile("/other", "12345678"),
    ).resolves.toBeUndefined();
    if (source === "backing")
      expect(fs.readFileSync(path.join(root, "file"), "utf8")).toBe("12345678");
  });

  it("supports shell inode comparisons and writes through either name", async () => {
    const bash = new Bash({
      fs: new OverlayFs({ root, mountPoint: "/" }),
      cwd: "/",
    });
    const result = await bash.exec(
      "printf a > a; ln a b; test a -ef b; echo $?; printf b > b; cat a; printf c >> a; cat b",
    );
    expect(result.stdout).toBe("0\nbbc");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps rename onto an alias as a no-op", async () => {
    await overlay.writeFile("/file", "12345678");
    await overlay.link("/file", "/alias");
    const before = await overlay.stat("/file");
    await overlay.mv("/file", "/alias");
    expect(await overlay.stat("/file")).toEqual(before);
    expect(await overlay.stat("/alias")).toEqual(before);
  });

  it("moves a tree with shared entries at the quota limit", async () => {
    await overlay.writeFile("/tree/a", "12345678");
    await overlay.link("/tree/a", "/tree/b");
    await overlay.link("/tree/a", "/outside");
    const before = await overlay.stat("/outside");
    await overlay.mv("/tree", "/moved");
    expect(await overlay.stat("/moved/a")).toEqual(before);
    expect(await overlay.stat("/moved/b")).toEqual(before);
    await expect(overlay.lstat("/tree/a")).rejects.toThrow("ENOENT");
    await overlay.rm("/moved", { recursive: true });
    await expect(overlay.writeFile("/extra", "x")).rejects.toThrow("ENOSPC");
    await overlay.rm("/outside");
    await expect(
      overlay.writeFile("/extra", "12345678"),
    ).resolves.toBeUndefined();
  });

  it("does not release a destination body retained by another alias", async () => {
    fs.writeFileSync(path.join(root, "source"), "x");
    await overlay.writeFile("/destination", "12345678");
    await overlay.link("/destination", "/alias");
    const reads = vi.spyOn(overlay, "readFileBuffer");
    await expect(overlay.mv("/source", "/destination")).rejects.toThrow(
      "ENOSPC",
    );
    expect(reads).not.toHaveBeenCalled();
    expect(await overlay.readFile("/destination")).toBe("12345678");
    expect(await overlay.readFile("/source")).toBe("x");
    await overlay.rm("/alias");
    await overlay.mv("/source", "/destination");
    expect(await overlay.readFile("/destination")).toBe("x");
    await overlay.writeFile("/extra", "1234567");
    await expect(overlay.writeFile("/overflow", "x")).rejects.toThrow("ENOSPC");
  });

  it("rejects a backing hard link before reading an oversized body", async () => {
    fs.writeFileSync(path.join(root, "source"), "123456789");
    const reads = vi.spyOn(overlay, "readFileBuffer");
    await expect(overlay.link("/source", "/alias")).rejects.toThrow("ENOSPC");
    expect(reads).not.toHaveBeenCalled();
    await expect(overlay.lstat("/alias")).rejects.toThrow("ENOENT");
  });
});
