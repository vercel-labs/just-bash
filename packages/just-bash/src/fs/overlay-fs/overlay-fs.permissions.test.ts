import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { MountableFs } from "../mountable-fs/mountable-fs.js";
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
    try {
      const overlay = new OverlayFs({
        root: tempDir,
        mountPoint: "/",
        allowSymlinks: true,
      });
      let hostReadable = true;
      try {
        fs.readFileSync(realPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EACCES") throw error;
        hostReadable = false;
      }

      if (hostReadable) {
        await overlay.appendFile("/append-only", " appended");
        expect((await overlay.stat("/append-only")).mode & 0o7777).toBe(0o200);
        fs.chmodSync(realPath, 0o644);
        await overlay.chmod("/append-only", 0o600);
        expect(await overlay.readFile("/append-only")).toBe(
          "original appended",
        );
      } else {
        await expect(
          overlay.appendFile("/append-only", " appended"),
        ).rejects.toThrow("EACCES: permission denied, open '/append-only'");
        expect((await overlay.stat("/append-only")).mode & 0o7777).toBe(0o200);
        fs.chmodSync(realPath, 0o644);
        expect(await overlay.readFile("/append-only")).toBe("original");
      }
      expect(fs.readFileSync(realPath, "utf8")).toBe("original");
    } finally {
      fs.chmodSync(realPath, 0o600);
    }
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

  it("edits a real-backed file without charging twice for the replacement", async () => {
    fs.writeFileSync(path.join(tempDir, "data"), "a\n");
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      maxMemoryBytes: 2,
    });
    const mounted = new MountableFs();
    mounted.mount("/project", overlay);
    const bash = new Bash({ fs: mounted, cwd: "/project" });

    const result = await bash.exec("sed -i 's/a/b/' data");

    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await overlay.readFile("/data")).toBe("b\n");
    expect(fs.readFileSync(path.join(tempDir, "data"), "utf8")).toBe("a\n");
    await expect(overlay.writeFile("/extra", "x")).rejects.toThrow("ENOSPC");
    await overlay.rm("/data");
    await expect(overlay.writeFile("/extra", "xy")).resolves.toBeUndefined();
  });

  it("moves a shadowed real file at capacity without exposing its backing file", async () => {
    fs.writeFileSync(path.join(tempDir, "source"), "real");
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      maxMemoryBytes: 4,
    });
    await overlay.writeFile("/source", "abcd");
    await overlay.mv("/source", "/destination");

    expect(await overlay.exists("/source")).toBe(false);
    expect(await overlay.readFile("/destination")).toBe("abcd");
    await expect(overlay.writeFile("/extra", "x")).rejects.toThrow("ENOSPC");
    expect(fs.readFileSync(path.join(tempDir, "source"), "utf8")).toBe("real");
  });

  it("keeps source files intact if a directory move runs out of memory", async () => {
    fs.mkdirSync(path.join(tempDir, "source"));
    fs.writeFileSync(path.join(tempDir, "source/b"), "real");
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      maxMemoryBytes: 4,
    });
    await overlay.writeFile("/source/a", "ab");

    await expect(overlay.mv("/source", "/destination")).rejects.toThrow(
      "ENOSPC",
    );
    expect(await overlay.readFile("/source/a")).toBe("ab");
    expect(await overlay.readFile("/source/b")).toBe("real");
  });

  it("keeps a missing same-path move as an error", async () => {
    const overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });

    await expect(overlay.mv("/missing", "/missing")).rejects.toThrow("ENOENT");
  });

  it("does not remove a real-backed destination parent on a same-path move", async () => {
    fs.mkdirSync(path.join(tempDir, "dir"));
    fs.writeFileSync(path.join(tempDir, "dir/source"), "old");
    const overlay = new OverlayFs({
      root: tempDir,
      mountPoint: "/",
      maxMemoryBytes: 4,
    });
    await overlay.writeFile("/dir/source", "data");

    await overlay.mv("/dir/source", "/dir/source");

    expect(await overlay.readFile("/dir/source")).toBe("data");
  });
});
