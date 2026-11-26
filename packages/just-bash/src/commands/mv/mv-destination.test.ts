import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// rename(2) resolves against the destination's parent directory, so mv must
// fail instead of creating missing parent directories (issue #690).
describe("mv destination parent", () => {
  it("should error when the destination parent directory does not exist", async () => {
    const env = new Bash({
      files: { "/abc.txt": "content" },
    });
    const result = await env.exec("mv /abc.txt /def/abc.txt");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "mv: cannot move '/abc.txt' to '/def/abc.txt': No such file or directory\n",
    );
    expect(await env.readFile("/abc.txt")).toBe("content");
    const ls = await env.exec("ls /def");
    expect(ls.exitCode).not.toBe(0);
  });

  it("should error with relative paths and cwd", async () => {
    const env = new Bash({
      files: { "/home/user/abc.txt": "content" },
      cwd: "/home/user",
    });
    const result = await env.exec("mv abc.txt def/abc.txt");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "mv: cannot move 'abc.txt' to 'def/abc.txt': No such file or directory\n",
    );
    expect(await env.readFile("/home/user/abc.txt")).toBe("content");
  });

  it("should error when several destination parents are missing", async () => {
    const env = new Bash({
      files: { "/f.txt": "" },
    });
    const result = await env.exec("mv /f.txt /x/y/z/f.txt");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "mv: cannot move '/f.txt' to '/x/y/z/f.txt': No such file or directory\n",
    );
    const ls = await env.exec("ls /x");
    expect(ls.exitCode).not.toBe(0);
  });

  it("should error when moving a directory to a missing parent", async () => {
    const env = new Bash({
      files: { "/srcdir/file.txt": "content" },
    });
    const result = await env.exec("mv /srcdir /a/dstdir");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "mv: cannot move '/srcdir' to '/a/dstdir': No such file or directory\n",
    );
    expect(await env.readFile("/srcdir/file.txt")).toBe("content");
  });

  it("should error when the destination parent is a file", async () => {
    const env = new Bash({
      files: {
        "/f.txt": "",
        "/b": "content",
      },
    });
    const result = await env.exec("mv /f.txt /b/c");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("mv: cannot stat '/b/c': Not a directory\n");
  });

  it("should still move to a new file inside an existing directory", async () => {
    const env = new Bash({
      files: {
        "/old.txt": "content",
        "/dir/.keep": "",
      },
    });
    const result = await env.exec("mv /old.txt /dir/new.txt");
    expect(result.exitCode).toBe(0);
    expect(await env.readFile("/dir/new.txt")).toBe("content");
  });
});

it("should report an intermediate file as Not a directory, not a missing one", async () => {
  const env = new Bash({
    files: {
      "/f.txt": "content",
      "/blocker": "not a dir",
    },
  });
  const result = await env.exec("mv /f.txt /blocker/child/dest.txt");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toBe(
    "mv: cannot move '/f.txt' to '/blocker/child/dest.txt': Not a directory\n",
  );
  expect(await env.readFile("/f.txt")).toBe("content");
});

it("should report a symlink loop as too many levels, not a missing directory", async () => {
  const env = new Bash({
    files: { "/f.txt": "content", "/loop/.keep": "" },
  });
  await env.exec("ln -s /loop/back /loop/back");
  const result = await env.exec("mv /f.txt /loop/back/f.txt");
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Too many levels of symbolic links");
  expect(await env.readFile("/f.txt")).toBe("content");
});
