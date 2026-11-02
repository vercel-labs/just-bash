// Automa modification: GNU missing-operand diagnostics.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "../../fs/interface.js";

class FailingReaddirFs extends InMemoryFs {
  override async readdir(path: string): Promise<string[]> {
    if (this.resolvePath("/", path) === "/root/bad") {
      throw new Error("injected child failure");
    }
    return super.readdir(path);
  }
}

describe("ls path and recursive error boundaries", () => {
  it("does not classify a prefix-sharing sibling as inside cwd", async () => {
    const bash = new Bash({
      cwd: "/foo",
      files: { "/foo/bar-safe": "", "/foobar/secret": "" },
    });
    const result = await bash.exec("ls bar*");
    expect(result.stdout).toBe("bar-safe\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("cannot reach a prefix-sharing sibling through an unexpanded pattern", async () => {
    const bash = new Bash({
      cwd: "/foo",
      files: { "/foo/bar-safe": "", "/foobar/secret": "" },
    });
    const result = await bash.exec("ls 'bar*'");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "ls: cannot access 'bar*': No such file or directory\n",
    );
    expect(result.exitCode).toBe(2);
  });

  it("retains recursive child errors and a nonzero aggregate status", async () => {
    const fs = new FailingReaddirFs({
      "/root/bad/file": "bad",
      "/root/good/file": "good",
    });
    const bash = new Bash({ fs, cwd: "/" });
    const result = await bash.exec("ls -R /root");
    expect(result.stdout).toBe("/root:\nbad\ngood\n\n\n/root/good:\nfile\n");
    expect(result.stderr).toBe(
      "ls: cannot access '/root/bad': No such file or directory\n",
    );
    expect(result.exitCode).toBe(2);
  });
  it("does not recurse through symlinks without typed directory enumeration", async () => {
    const memory = new InMemoryFs({ "/root/file": "data" });
    const enumerate = memory.readdirWithFileTypes.bind(memory);
    const fs: IFileSystem = memory;
    fs.readdir = async (path) =>
      (await enumerate(path)).map((entry) => entry.name);
    fs.readdirWithFileTypes = undefined;
    await fs.symlink(".", "/root/loop");
    const result = await new Bash({ fs }).exec("ls -R /root");
    expect(result).toMatchObject({
      stdout: "/root:\nfile\nloop\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
