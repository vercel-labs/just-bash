import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("mv destination parents", () => {
  it("rejects a missing destination parent without moving the source", async () => {
    const env = new Bash({
      files: { "/worldbanc/public/key.txt": "secret" },
      cwd: "/worldbanc/public",
    });

    const result = await env.exec("mv key.txt worldbanc/key.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "mv: cannot move 'key.txt' to 'worldbanc/key.txt': No such file or directory\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await env.readFile("/worldbanc/public/key.txt")).toBe("secret");
    expect(
      (await env.exec("test -e /worldbanc/public/worldbanc")).exitCode,
    ).toBe(1);
  });

  it("rejects a missing destination parent for directory moves", async () => {
    const env = new Bash({
      files: { "/work/source/file.txt": "content" },
      cwd: "/work",
    });

    const result = await env.exec("mv source missing/moved");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "mv: cannot move 'source' to 'missing/moved': No such file or directory\n",
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

    const result = await env.exec("mv source.txt not-a-directory/moved.txt");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "mv: cannot move 'source.txt' to 'not-a-directory/moved.txt': Not a directory\n",
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
      "mv source.txt not-a-directory/nested/moved.txt",
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "mv: cannot move 'source.txt' to 'not-a-directory/nested/moved.txt': Not a directory\n",
    );
    expect(result.exitCode).toBe(1);
    expect(await env.readFile("/work/source.txt")).toBe("content");
  });
});
