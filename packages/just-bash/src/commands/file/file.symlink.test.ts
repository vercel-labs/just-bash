import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("file symlink handling", () => {
  it("reports the link by default and follows only with -L", async () => {
    const bash = new Bash({ files: { "/target": "plain text\n" } });
    await bash.fs.symlink("/target", "/link");

    const link = await bash.exec("file /link");
    expect(link.stdout).toBe("/link: symbolic link to /target\n");
    expect(link.stderr).toBe("");
    expect(link.exitCode).toBe(0);

    const target = await bash.exec("file -L /link");
    expect(target.stdout).toBe("/link: ASCII text\n");
    expect(target.stderr).toBe("");
    expect(target.exitCode).toBe(0);
  });

  it("reports dangling links without dereferencing them", async () => {
    const bash = new Bash();
    await bash.fs.symlink("/missing", "/dangling");

    const link = await bash.exec("file -i /dangling");
    expect(link.stdout).toBe("/dangling: inode/symlink\n");
    expect(link.stderr).toBe("");
    expect(link.exitCode).toBe(0);

    const followed = await bash.exec("file -L /dangling");
    expect(followed.stdout).toBe(
      "/dangling: cannot open (No such file or directory)\n",
    );
    expect(followed.stderr).toBe("");
    expect(followed.exitCode).toBe(1);
  });
});
