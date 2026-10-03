import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { ReadWriteFs } from "./read-write-fs.js";

describe("ReadWriteFs directory removal without recursive", () => {
  let sandboxDir: string;
  let bash: Bash;

  beforeEach(() => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "rwfs-rmdir-"));
    bash = new Bash({ fs: new ReadWriteFs({ root: sandboxDir }), cwd: "/" });
  });

  afterEach(() => {
    fs.rmSync(sandboxDir, { recursive: true, force: true });
  });

  it("rmdir removes an empty directory", async () => {
    const result = await bash.exec("mkdir d && rmdir d");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(sandboxDir, "d"))).toBe(false);
  });

  it("rmdir -p removes each emptied parent", async () => {
    const result = await bash.exec("mkdir -p a/b/c && rmdir -p a/b/c");

    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(sandboxDir, "a"))).toBe(false);
  });

  it("rmdir refuses a directory that is not empty", async () => {
    const result = await bash.exec("mkdir d && touch d/f && rmdir d");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "rmdir: failed to remove 'd': Directory not empty\n",
    );
    expect(result.exitCode).toBe(1);
    expect(fs.existsSync(path.join(sandboxDir, "d", "f"))).toBe(true);
  });

  it("find -delete removes an empty directory", async () => {
    const result = await bash.exec("mkdir e && find e -type d -empty -delete");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(sandboxDir, "e"))).toBe(false);
  });

  it("rm without -r still refuses a directory", async () => {
    const result = await bash.exec("mkdir d && rm d");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("rm: cannot remove 'd': Is a directory\n");
    expect(result.exitCode).toBe(1);
    expect(fs.existsSync(path.join(sandboxDir, "d"))).toBe(true);
  });
});
