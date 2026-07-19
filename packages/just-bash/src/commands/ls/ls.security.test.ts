import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

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
    const result = await bash.exec("ls 'bar*'");
    expect(result.stdout).toBe("bar-safe\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("retains recursive child errors and a nonzero aggregate status", async () => {
    const fs = new FailingReaddirFs({
      "/root/bad/file": "bad",
      "/root/good/file": "good",
    });
    const bash = new Bash({ fs, cwd: "/" });
    const result = await bash.exec("ls -R /root");
    expect(result.stdout).toBe("/root:\nbad\ngood\n\n\n/root/good:\nfile\n");
    expect(result.stderr).toBe("ls: /root/bad: No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });
});
