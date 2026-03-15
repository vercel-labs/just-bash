import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import type { FsStat, IFileSystem } from "../../fs/interface.js";

describe("stat uid/gid format specifiers", () => {
  it("should return 1000/user/1000/group by default", async () => {
    const env = new Bash({
      files: { "/test.txt": "hello" },
    });
    const result = await env.exec('stat -c "%u %U %g %G" /test.txt');
    expect(result.stdout).toBe("1000 user 1000 group\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should resolve names via uidToName/gidToName callbacks", async () => {
    const env = new Bash({
      files: { "/test.txt": "hello" },
      uidToName: (uid) => (uid === 0 ? "root" : "alice"),
      gidToName: (gid) => (gid === 0 ? "root" : "staff"),
    });
    const result = await env.exec(
      'stat -c "%n owned by %U:%G (uid=%u, gid=%g)" /test.txt',
    );
    expect(result.stdout).toBe(
      "/test.txt owned by alice:staff (uid=1000, gid=1000)\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should use uid/gid from custom IFileSystem", async () => {
    const inner = new Bash({
      files: {
        "/alice.txt": "alice file",
        "/bob.txt": "bob file",
      },
    });
    const wrappedFs = new Proxy(inner.fs, {
      get(target, prop, receiver) {
        if (prop === "stat") {
          return async (path: string): Promise<FsStat> => {
            const s = await target.stat(path);
            if (path === "/alice.txt") return { ...s, uid: 1001, gid: 100 };
            if (path === "/bob.txt") return { ...s, uid: 1002, gid: 200 };
            return s;
          };
        }
        if (prop === "lstat") {
          return async (path: string): Promise<FsStat> => {
            const s = await target.lstat(path);
            if (path === "/alice.txt") return { ...s, uid: 1001, gid: 100 };
            if (path === "/bob.txt") return { ...s, uid: 1002, gid: 200 };
            return s;
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as IFileSystem;

    const env = new Bash({
      fs: wrappedFs,
      uidToName: (uid) => {
        if (uid === 1001) return "alice";
        if (uid === 1002) return "bob";
        return `uid${uid}`;
      },
      gidToName: (gid) => {
        if (gid === 100) return "users";
        if (gid === 200) return "devs";
        return `gid${gid}`;
      },
    });

    const alice = await env.exec('stat -c "%u %U %g %G" /alice.txt');
    expect(alice.stdout).toBe("1001 alice 100 users\n");
    expect(alice.exitCode).toBe(0);

    const bob = await env.exec('stat -c "%u %U %g %G" /bob.txt');
    expect(bob.stdout).toBe("1002 bob 200 devs\n");
    expect(bob.exitCode).toBe(0);
  });
});
