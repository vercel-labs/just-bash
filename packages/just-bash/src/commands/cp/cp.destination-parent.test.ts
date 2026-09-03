import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("cp destination parents", () => {
  it("rejects a missing destination parent without creating it", async () => {
    const env = new Bash({
      files: { "/work/source.txt": "content" },
      cwd: "/work",
    });

    const result = await env.exec("cp source.txt missing/copied.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "cp: cannot create regular file 'missing/copied.txt': No such file or directory\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await env.readFile("/work/source.txt")).toBe("content");
    expect((await env.exec("test -e /work/missing")).exitCode).toBe(1);
  });

  it("rejects a missing destination parent for recursive copies", async () => {
    const env = new Bash({
      files: { "/work/source/file.txt": "content" },
      cwd: "/work",
    });

    const result = await env.exec("cp -r source missing/copied");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "cp: cannot create directory 'missing/copied': No such file or directory\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await env.readFile("/work/source/file.txt")).toBe("content");
    expect((await env.exec("test -e /work/missing")).exitCode).toBe(1);
  });

  it("rejects a destination parent that is not a directory", async () => {
    const env = new Bash({
      files: {
        "/work/source.txt": "content",
        "/work/not-a-directory": "content",
      },
      cwd: "/work",
    });

    const result = await env.exec("cp source.txt not-a-directory/copied.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "cp: cannot create regular file 'not-a-directory/copied.txt': Not a directory\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await env.readFile("/work/source.txt")).toBe("content");
  });

  it("rejects a nested destination ancestor that is not a directory", async () => {
    const env = new Bash({
      files: {
        "/work/source.txt": "content",
        "/work/not-a-directory": "content",
      },
      cwd: "/work",
    });

    const result = await env.exec(
      "cp source.txt not-a-directory/nested/copied.txt",
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "cp: cannot create regular file 'not-a-directory/nested/copied.txt': Not a directory\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await env.readFile("/work/source.txt")).toBe("content");
  });
});
