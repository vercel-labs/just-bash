import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OverlayFs } from "./overlay-fs.js";

describe("OverlayFs moves", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), "just-bash-overlay-move-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("moves a directory without copying file bodies or resetting its mode", async () => {
    await fs.mkdir(join(root, "source"));
    await fs.writeFile(join(root, "source/b"), "real");
    const overlay = new OverlayFs({ root, mountPoint: "/", maxMemoryBytes: 4 });
    await overlay.writeFile("/source/a", "ab");
    await overlay.chmod("/source", 0o700);

    await overlay.mv("/source", "/destination");

    expect((await overlay.stat("/destination")).mode & 0o777).toBe(0o700);
    expect(await overlay.readFile("/destination/a")).toBe("ab");
    expect(await overlay.readFile("/destination/b")).toBe("real");
    expect(await overlay.exists("/source/a")).toBe(false);
    expect(await overlay.exists("/source/b")).toBe(false);
    expect(await fs.readFile(join(root, "source/b"), "utf8")).toBe("real");
  });

  it("moves a host file beyond the read limit without raising that limit", async () => {
    await fs.writeFile(join(root, "source"), "large");
    const overlay = new OverlayFs({
      root,
      mountPoint: "/",
      maxFileReadSize: 2,
    });

    await overlay.mv("/source", "/destination");

    expect(await overlay.exists("/source")).toBe(false);
    expect((await overlay.stat("/destination")).size).toBe(5);
    await expect(overlay.readFile("/destination")).rejects.toThrow(
      "EFBIG: file too large, read '/destination' (5 bytes, max 2)",
    );
  });

  it("moves a host file with mode 000 without reading it", async () => {
    await fs.writeFile(join(root, "source"), "data", { mode: 0o000 });
    const overlay = new OverlayFs({ root, mountPoint: "/", maxMemoryBytes: 0 });

    await overlay.mv("/source", "/destination");

    expect(await overlay.exists("/source")).toBe(false);
    expect((await overlay.stat("/destination")).mode).toBe(0o000);
    await expect(overlay.readFile("/destination")).rejects.toThrow(
      "EACCES: permission denied, open '/destination'",
    );
  });
});
