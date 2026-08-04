import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadWriteFs } from "./read-write-fs.js";

function errno(code: string, hostPath: string): NodeJS.ErrnoException {
  const error = new Error(
    `${code}: host failure, '${hostPath}'`,
  ) as NodeJS.ErrnoException;
  error.code = code;
  error.path = hostPath;
  return error;
}

describe("ReadWriteFs mv transaction", () => {
  let root: string;
  let adapter: ReadWriteFs;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-mv-transaction-"));
    adapter = new ReadWriteFs({ root, allowSymlinks: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("sanitizes an initial source lstat failure for direct consumers", async () => {
    const canary = `${root}/HOST_ROOT_CANARY/source`;
    const actual = fs.promises.lstat.bind(fs.promises);
    vi.spyOn(fs.promises, "lstat").mockImplementation(async (target) => {
      if (String(target).endsWith("source")) throw errno("EIO", canary);
      return actual(target);
    });

    const error = await adapter.mv("/source", "/dest").catch((value) => value);

    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toBe("Error: EIO: mv '/source'");
    expect(JSON.stringify(error)).not.toContain("HOST_ROOT_CANARY");
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
  });

  it("commits an EXDEV move through hidden sibling staging", async () => {
    fs.mkdirSync(path.join(root, "source"));
    fs.writeFileSync(path.join(root, "source", "new.txt"), "new");
    fs.mkdirSync(path.join(root, "dest"));
    fs.writeFileSync(path.join(root, "dest", "old.txt"), "old");
    const actualRename = fs.promises.rename.bind(fs.promises);
    let first = true;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      if (first) {
        first = false;
        throw errno("EXDEV", String(from));
      }
      return actualRename(from, to);
    });

    await adapter.mv("/source", "/dest");

    expect(fs.existsSync(path.join(root, "source"))).toBe(false);
    expect(fs.readFileSync(path.join(root, "dest", "new.txt"), "utf8")).toBe(
      "new",
    );
    expect(fs.existsSync(path.join(root, "dest", "old.txt"))).toBe(false);
    expect(fs.readdirSync(root)).toEqual(["dest"]);
  });

  it("restores source and destination when staged source deletion fails", async () => {
    fs.mkdirSync(path.join(root, "source"));
    fs.writeFileSync(path.join(root, "source", "new.txt"), "new");
    fs.mkdirSync(path.join(root, "dest"));
    fs.writeFileSync(path.join(root, "dest", "old.txt"), "old");
    const actualRename = fs.promises.rename.bind(fs.promises);
    const actualRm = fs.promises.rm.bind(fs.promises);
    let first = true;
    vi.spyOn(fs.promises, "rename").mockImplementation(async (from, to) => {
      if (first) {
        first = false;
        throw errno("EXDEV", String(from));
      }
      return actualRename(from, to);
    });
    vi.spyOn(fs.promises, "rm").mockImplementation(async (target, options) => {
      if (String(target).includes(".just-bash-mv-source-")) {
        throw errno("EIO", String(target));
      }
      return actualRm(target, options);
    });

    await expect(adapter.mv("/source", "/dest")).rejects.toThrow(
      "EIO: mv '/source'",
    );
    expect(fs.readFileSync(path.join(root, "source", "new.txt"), "utf8")).toBe(
      "new",
    );
    expect(fs.readFileSync(path.join(root, "dest", "old.txt"), "utf8")).toBe(
      "old",
    );
    expect(fs.readdirSync(root).sort()).toEqual(["dest", "source"]);
  });

  it("rejects a symlink-spelled descendant using canonical identity", async () => {
    fs.mkdirSync(path.join(root, "source"));
    fs.writeFileSync(path.join(root, "source", "keep.txt"), "keep");
    fs.symlinkSync(path.join(root, "source"), path.join(root, "alias"));

    await expect(adapter.mv("/source", "/alias/child")).rejects.toThrow(
      "cannot move '/source' into itself",
    );
    expect(fs.readFileSync(path.join(root, "source", "keep.txt"), "utf8")).toBe(
      "keep",
    );
  });
});
