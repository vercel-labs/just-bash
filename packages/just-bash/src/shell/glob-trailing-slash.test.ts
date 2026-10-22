import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const files = {
  "/w/a/b/file.txt": "x",
  "/w/a/c/file.txt": "x",
  "/w/d/file.txt": "x",
  "/w/top.txt": "x",
};

describe("glob with a trailing slash and globstar", () => {
  it("lists every directory recursively for **/", async () => {
    const bash = new Bash({ files, cwd: "/w" });
    const result = await bash.exec("shopt -s globstar; echo **/");
    expect(result.stdout).toBe("a/ a/b/ a/c/ d/\n");
    expect(result.stderr).toBe("");
  });

  it("lists directories below a prefix for dir/**/", async () => {
    const bash = new Bash({ files, cwd: "/w" });
    const result = await bash.exec("shopt -s globstar; echo a/**/");
    expect(result.stdout).toBe("a/ a/b/ a/c/\n");
  });

  it("matches only directories for **/b*/", async () => {
    const bash = new Bash({ files, cwd: "/w" });
    const result = await bash.exec("shopt -s globstar; echo **/b*/");
    expect(result.stdout).toBe("a/b/\n");
  });

  it("returns the pattern unchanged when the prefix of dir/**/ is missing or a file", async () => {
    const bash = new Bash({ files, cwd: "/w" });
    const result = await bash.exec(
      "shopt -s globstar; echo missing/**/ top.txt/**/",
    );
    expect(result.stdout).toBe("missing/**/ top.txt/**/\n");
  });

  it("skips . and .. for .*/ and keeps hidden directories", async () => {
    const bash = new Bash({
      files: { "/w/.hid/f": "x", "/w/vis/f": "x", "/w/.file": "x" },
      cwd: "/w",
    });
    const result = await bash.exec("echo .*/");
    expect(result.stdout).toBe(".hid/\n");
  });

  it("matches a symlink to a directory but not one to a file for */", async () => {
    const bash = new Bash({
      files: { "/w/dir/f": "x", "/w/file.txt": "x" },
      cwd: "/w",
    });
    await bash.exec("ln -s dir linkdir; ln -s file.txt linkfile");
    const result = await bash.exec("echo */");
    expect(result.stdout).toBe("dir/ linkdir/\n");
  });

  it("counts the stats of directory symlinks against the glob operation limit", async () => {
    const bash = new Bash({
      files: { "/w/dir/f": "x" },
      cwd: "/w",
      executionLimits: { maxGlobOperations: 4 },
    });
    await bash.exec("for i in 1 2 3 4 5 6; do ln -s dir link$i; done");
    const result = await bash.exec("echo */");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("Glob operation limit exceeded");
  });
});
