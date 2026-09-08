import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { IFileSystem } from "../../fs/interface.js";

/**
 * A filesystem where some directories cannot be listed, the way a home
 * directory's `.Trash` or a protected `Library` folder cannot be on macOS.
 * Both readdir entry points refuse them, since `find` prefers the typed one
 * when the filesystem offers it. Each failing path maps to the message its
 * read throws with.
 */
function withUnreadableDirectories(
  fs: IFileSystem,
  failures: Record<string, string>,
): IFileSystem {
  return new Proxy(fs, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      if (prop === "readdir" || prop === "readdirWithFileTypes") {
        return async (path: string, ...rest: unknown[]) => {
          const message = failures[path];
          if (message !== undefined) {
            throw new Error(message);
          }
          return value.call(target, path, ...rest);
        };
      }
      return value.bind(target);
    },
  }) as IFileSystem;
}

const PERMISSION_DENIED = "EACCES: permission denied, scandir";

function home(
  failures: Record<string, string> = {
    "/home/user/.Trash": `${PERMISSION_DENIED} '/home/user/.Trash'`,
  },
): Bash {
  const fs = withUnreadableDirectories(
    new InMemoryFs({
      "/home/user/.Trash/old.txt": "gone",
      "/home/user/Documents/notes.md": "# notes",
      "/home/user/Documents/vault/.obsidian/app.json": "{}",
      "/home/user/Downloads/paper.pdf": "pdf",
    }),
    failures,
  );
  return new Bash({ fs });
}

describe("find over an unreadable directory", () => {
  it("names the directory it could not read and keeps going", async () => {
    const result = await home().exec("find /home/user -name '*.md'");

    expect(result.stdout).toBe("/home/user/Documents/notes.md\n");
    expect(result.stderr).toBe("find: /home/user/.Trash: Permission denied\n");
    expect(result.exitCode).toBe(1);
  });

  it("still lists the directory itself, as GNU find does", async () => {
    const result = await home().exec("find /home/user -type d -name '.*'");

    expect(result.stdout).toBe(
      "/home/user/.Trash\n/home/user/Documents/vault/.obsidian\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("keeps the results reachable through a pipeline", async () => {
    const result = await home().exec(
      "find /home/user -name 'app.json' 2>/dev/null | head -1",
    );

    expect(result.stdout).toBe(
      "/home/user/Documents/vault/.obsidian/app.json\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("does not call a directory it could not read empty", async () => {
    const result = await home().exec("find /home/user -type d -empty");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("find: /home/user/.Trash: Permission denied\n");
  });

  it("does not descend into it when it is not asked to read it", async () => {
    const result = await home().exec("find /home/user -maxdepth 1 -type d");

    expect(result.stdout).toBe(
      "/home/user\n/home/user/.Trash\n/home/user/Documents\n/home/user/Downloads\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  const TWO_UNREADABLE = {
    "/home/user/.Trash": `${PERMISSION_DENIED} '/home/user/.Trash'`,
    "/home/user/Documents/vault": `${PERMISSION_DENIED} '/home/user/Documents/vault'`,
  };
  const TWO_MESSAGES =
    "find: /home/user/.Trash: Permission denied\nfind: /home/user/Documents/vault: Permission denied\n";

  it("reports every unreadable directory in traversal order", async () => {
    const result = await home(TWO_UNREADABLE).exec("find /home/user -type d");

    expect(result.stdout).toBe(
      "/home/user\n/home/user/.Trash\n/home/user/Documents\n/home/user/Documents/vault\n/home/user/Downloads\n",
    );
    expect(result.stderr).toBe(TWO_MESSAGES);
    expect(result.exitCode).toBe(1);
  });

  it("keeps that order under -depth", async () => {
    const result = await home(TWO_UNREADABLE).exec(
      "find /home/user -depth -type d",
    );

    expect(result.stdout).toBe(
      "/home/user/.Trash\n/home/user/Documents/vault\n/home/user/Documents\n/home/user/Downloads\n/home/user\n",
    );
    expect(result.stderr).toBe(TWO_MESSAGES);
  });

  it("reports a directory below -mindepth all the same", async () => {
    const result = await home().exec(
      "find /home/user -mindepth 2 -name '*.md'",
    );

    expect(result.stdout).toBe("/home/user/Documents/notes.md\n");
    expect(result.stderr).toBe("find: /home/user/.Trash: Permission denied\n");
  });

  it("lets a failure that is not the directory's own end the search", async () => {
    const result = await home({
      "/home/user/.Trash": "ABORT_ERR: The operation was aborted",
    }).exec("find /home/user -name '*.md'");

    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("ABORT_ERR");
    expect(result.exitCode).toBe(1);
  });
});
