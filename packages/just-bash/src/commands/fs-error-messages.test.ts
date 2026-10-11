import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { InMemoryFs } from "../fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "../fs/interface.js";

/**
 * A filesystem that refuses every operation on one path with the given error,
 * the way a host filesystem refuses a file its permissions keep closed.
 */
function refusing(fs: IFileSystem, path: string, error: Error): IFileSystem {
  return new Proxy(fs, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      return (...args: unknown[]) => {
        if (args[0] === path) {
          return Promise.reject(error);
        }
        return value.apply(target, args);
      };
    },
  }) as IFileSystem;
}

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function shell(error: Error): Bash {
  const fs = refusing(
    new InMemoryFs({
      "/home/user/private/notes.txt": "secret\n",
      "/home/user/open.txt": "hello\n",
    }),
    "/home/user/private/notes.txt",
    error,
  );
  return new Bash({ fs, cwd: "/home/user" });
}

describe("a failed file operation is reported by its errno", () => {
  const denied = withCode("refused", "EACCES");

  it.each([
    ["cat private/notes.txt", "cat: private/notes.txt: Permission denied\n"],
    ["head private/notes.txt", "head: private/notes.txt: Permission denied\n"],
    ["tail private/notes.txt", "tail: private/notes.txt: Permission denied\n"],
    ["wc private/notes.txt", "wc: private/notes.txt: Permission denied\n"],
    ["sort private/notes.txt", "sort: private/notes.txt: Permission denied\n"],
    [
      "grep secret private/notes.txt",
      "grep: private/notes.txt: Permission denied\n",
    ],
    [
      "stat private/notes.txt",
      "stat: cannot stat 'private/notes.txt': Permission denied\n",
    ],
    ["ls private/notes.txt", "ls: private/notes.txt: Permission denied\n"],
    [
      "ls -d private/notes.txt",
      "ls: cannot access 'private/notes.txt': Permission denied\n",
    ],
    ["tree private/notes.txt", "tree: private/notes.txt: Permission denied\n"],
  ])("%s", async (command, stderr) => {
    const result = await shell(denied).exec(command);
    expect(result.stderr).toBe(stderr);
    expect(result.exitCode).not.toBe(0);
  });

  it("reads the errno off the message when the error has no code", async () => {
    const result = await shell(
      new Error(
        "EACCES: permission denied, open '/home/user/private/notes.txt'",
      ),
    ).exec("cat private/notes.txt open.txt");
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("cat: private/notes.txt: Permission denied\n");
  });

  it.each([
    ["ENOTDIR", "Not a directory"],
    ["EIO", "Input/output error"],
    ["EPERM", "Operation not permitted"],
  ])("prints %s as %s", async (code, message) => {
    const result = await shell(withCode("failed", code)).exec(
      "cat private/notes.txt",
    );
    expect(result.stderr).toBe(`cat: private/notes.txt: ${message}\n`);
  });

  it("still calls an error with no errno a missing file", async () => {
    const result = await shell(new Error("something else")).exec(
      "cat private/notes.txt",
    );
    expect(result.stderr).toBe(
      "cat: private/notes.txt: No such file or directory\n",
    );
  });

  it("keeps the message for a file that is not there", async () => {
    const result = await shell(denied).exec("cat missing.txt; ls missing.txt");
    expect(result.stderr).toBe(
      "cat: missing.txt: No such file or directory\nls: missing.txt: No such file or directory\n",
    );
  });
});
