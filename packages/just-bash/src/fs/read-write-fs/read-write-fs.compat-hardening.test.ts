import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs compatibility hardening", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-compat-hardening-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("preserves an absolute symlink's immediate in-root target", async () => {
    fs.writeFileSync(path.join(root, "first.txt"), "first");
    fs.writeFileSync(path.join(root, "second.txt"), "second");
    const rwfs = new ReadWriteFs({ root, allowSymlinks: true });
    await rwfs.symlink("/first.txt", "/intermediate");
    await rwfs.symlink("/intermediate", "/source-link");

    await rwfs.cp("/source-link", "/copied-link");

    const sourceTarget = fs.readlinkSync(path.join(root, "source-link"));
    expect(fs.readlinkSync(path.join(root, "copied-link"))).toBe(sourceTarget);
    await rwfs.rm("/intermediate");
    await rwfs.symlink("/second.txt", "/intermediate");
    expect(fs.readFileSync(path.join(root, "copied-link"), "utf8")).toBe(
      "second",
    );
  });

  it("preserves an existing copy destination's permission bits", async () => {
    fs.writeFileSync(path.join(root, "source.txt"), "new");
    fs.chmodSync(path.join(root, "source.txt"), 0o755);
    fs.writeFileSync(path.join(root, "destination.txt"), "old");
    fs.chmodSync(path.join(root, "destination.txt"), 0o600);
    const rwfs = new ReadWriteFs({ root });

    await rwfs.cp("/source.txt", "/destination.txt");

    expect(fs.readFileSync(path.join(root, "destination.txt"), "utf8")).toBe(
      "new",
    );
    expect(fs.statSync(path.join(root, "destination.txt")).mode & 0o777).toBe(
      0o600,
    );
  });

  it("does not follow a dangling symlink when creating a directory", async () => {
    fs.symlinkSync("created-through-link", path.join(root, "dangling"));
    const rwfs = new ReadWriteFs({ root, allowSymlinks: true });

    await expect(rwfs.mkdir("/dangling")).rejects.toThrow("EEXIST");

    expect(fs.lstatSync(path.join(root, "dangling")).isSymbolicLink()).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, "created-through-link"))).toBe(false);
  });

  it("retains EEXIST when creating the root directory", async () => {
    const rwfs = new ReadWriteFs({ root, allowSymlinks: true });

    await expect(rwfs.mkdir("/")).rejects.toThrow("EEXIST");
  });

  it("does not follow a dangling symlink used as a hard-link name", async () => {
    fs.writeFileSync(path.join(root, "source.txt"), "content");
    fs.symlinkSync("created-through-link", path.join(root, "dangling"));
    const rwfs = new ReadWriteFs({ root, allowSymlinks: true });

    await expect(rwfs.link("/source.txt", "/dangling")).rejects.toThrow(
      "EEXIST",
    );

    expect(fs.lstatSync(path.join(root, "dangling")).isSymbolicLink()).toBe(
      true,
    );
    expect(fs.existsSync(path.join(root, "created-through-link"))).toBe(false);
  });

  it("ignores predictable staging-name collisions", async () => {
    const target = path.join(root, "shared.txt");
    fs.writeFileSync(target, "old");
    fs.linkSync(target, path.join(root, "shared-alias.txt"));
    for (let index = 0; index < 100; index++) {
      fs.writeFileSync(path.join(root, `.just-bash-write-${index}`), "host");
    }
    const rwfs = new ReadWriteFs({ root });

    await rwfs.writeFile("/shared.txt", "new");

    expect(fs.readFileSync(target, "utf8")).toBe("new");
    expect(fs.readFileSync(path.join(root, "shared-alias.txt"), "utf8")).toBe(
      "old",
    );
  });
});
