import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OverlayFs } from "./overlay-fs.js";

describe("OverlayFs file permissions", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-fs-permissions-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("enforces owner bits on memory-layer files and symlink reads", async () => {
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      allowSymlinks: true,
    });
    await overlay.writeFile("/data", "original");
    await overlay.chmod("/data", 0o444);
    await overlay.symlink("/data", "/link");

    await expect(overlay.writeFile("/data", "replacement")).rejects.toThrow(
      "EACCES: permission denied, open '/data'",
    );
    await expect(overlay.appendFile("/data", " appended")).rejects.toThrow(
      "EACCES: permission denied, open '/data'",
    );
    await overlay.chmod("/data", 0o000);
    await expect(overlay.readFileBuffer("/link")).rejects.toThrow(
      "EACCES: permission denied, open '/link'",
    );

    await overlay.chmod("/data", 0o644);
    expect(await overlay.readFile("/data")).toBe("original");
    await overlay.writeFile("/data", "updated");
    expect(await overlay.readFile("/data")).toBe("updated");
  });

  it("checks read permission from real-file lstat before opening", async () => {
    const realPath = path.join(tempDir, "secret");
    fs.writeFileSync(realPath, "hidden");
    fs.chmodSync(realPath, 0o000);
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      allowSymlinks: true,
    });

    await expect(overlay.readFileBuffer("/secret")).rejects.toThrow(
      "EACCES: permission denied, open '/secret'",
    );
    fs.chmodSync(realPath, 0o600);
    expect(fs.readFileSync(realPath, "utf8")).toBe("hidden");
  });

  it("preserves a real file when append cannot read its host contents", async () => {
    const realPath = path.join(tempDir, "append-only");
    fs.writeFileSync(realPath, "original");
    fs.chmodSync(realPath, 0o200);
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      allowSymlinks: true,
    });

    await expect(
      overlay.appendFile("/append-only", " appended"),
    ).rejects.toThrow("EACCES: permission denied, open '/append-only'");
    expect((await overlay.stat("/append-only")).mode & 0o7777).toBe(0o200);

    fs.chmodSync(realPath, 0o644);
    expect(await overlay.readFile("/append-only")).toBe("original");
  });

  it("preserves content when chmod changes permissions on a real file", async () => {
    const realPath = path.join(tempDir, "chmod-real");
    fs.writeFileSync(realPath, "original");
    fs.chmodSync(realPath, 0o644);
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      allowSymlinks: true,
    });

    await overlay.chmod("/chmod-real", 0o000);
    await expect(overlay.readFile("/chmod-real")).rejects.toThrow(
      "EACCES: permission denied, open '/chmod-real'",
    );
    await overlay.chmod("/chmod-real", 0o644);

    expect(await overlay.readFile("/chmod-real")).toBe("original");
    expect(fs.readFileSync(realPath, "utf8")).toBe("original");
  });

  it("preserves a real file's mode when overwriting it", async () => {
    const realPath = path.join(tempDir, "write-real");
    fs.writeFileSync(realPath, "original");
    fs.chmodSync(realPath, 0o600);
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      allowSymlinks: true,
    });

    await overlay.writeFile("/write-real", "replacement");

    expect((await overlay.stat("/write-real")).mode & 0o7777).toBe(0o600);
    expect(await overlay.readFile("/write-real")).toBe("replacement");
    expect(fs.readFileSync(realPath, "utf8")).toBe("original");
  });

  it("enforces overlay chmod on real files without changing disk content", async () => {
    const realPath = path.join(tempDir, "data");
    fs.writeFileSync(realPath, "original");
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      allowSymlinks: true,
    });

    await overlay.chmod("/data", 0o444);
    await expect(overlay.writeFile("/data", "replacement")).rejects.toThrow(
      "EACCES: permission denied, open '/data'",
    );
    await expect(overlay.appendFile("/data", " appended")).rejects.toThrow(
      "EACCES: permission denied, open '/data'",
    );
    expect(fs.readFileSync(realPath, "utf8")).toBe("original");

    await overlay.chmod("/data", 0o644);
    await overlay.writeFile("/data", "updated");
    expect(await overlay.readFile("/data")).toBe("updated");
    expect(fs.readFileSync(realPath, "utf8")).toBe("original");
  });

  it("moves unreadable files over read-only files and preserves their mode", async () => {
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      allowSymlinks: true,
    });
    await overlay.writeFile("/source", "hidden");
    await overlay.writeFile("/destination", "old");
    await overlay.chmod("/source", 0o000);
    await overlay.chmod("/destination", 0o444);

    await overlay.mv("/source", "/destination");

    expect((await overlay.stat("/destination")).mode & 0o7777).toBe(0o000);
    await expect(overlay.readFile("/destination")).rejects.toThrow("EACCES");
    await expect(overlay.stat("/source")).rejects.toThrow("ENOENT");
  });
});
