import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import type { FsStat, IFileSystem } from "../../fs/interface.js";

describe("ls -l uid/gid and mode display", () => {
  it("should use real mode from stat instead of hardcoding", async () => {
    const env = new Bash({
      files: {
        "/dir/script.sh": { content: "#!/bin/bash", mode: 0o755 },
        "/dir/secret.txt": { content: "top secret", mode: 0o600 },
      },
    });
    const result = await env.exec("ls -l /dir");
    const lines = result.stdout.split("\n").filter((l) => l);
    expect(lines[0]).toBe("total 2");
    expect(lines[1]).toMatch(/^-rwxr-xr-x 1 user group\s+11 .+ script\.sh$/);
    expect(lines[2]).toMatch(/^-rw------- 1 user group\s+10 .+ secret\.txt$/);
    expect(result.exitCode).toBe(0);
  });

  it("should resolve uid/gid names via callbacks", async () => {
    const env = new Bash({
      files: { "/dir/file.txt": "content" },
      uidToName: (uid) => (uid === 0 ? "root" : "alice"),
      gidToName: (gid) => (gid === 0 ? "root" : "staff"),
    });
    const result = await env.exec("ls -l /dir");
    const lines = result.stdout.split("\n").filter((l) => l);
    expect(lines[1]).toMatch(/^-rw-r--r-- 1 alice staff\s+7 .+ file\.txt$/);
    expect(result.exitCode).toBe(0);
  });

  it("should fall back to user/group without callbacks", async () => {
    const env = new Bash({
      files: { "/dir/file.txt": "data" },
    });
    const result = await env.exec("ls -l /dir");
    const lines = result.stdout.split("\n").filter((l) => l);
    expect(lines[1]).toMatch(/^-rw-r--r-- 1 user group\s+4 .+ file\.txt$/);
    expect(result.exitCode).toBe(0);
  });

  it("should resolve names for . and .. in ls -la", async () => {
    const env = new Bash({
      files: { "/dir/file.txt": "x" },
      uidToName: () => "bob",
      gidToName: () => "devs",
    });
    const result = await env.exec("ls -la /dir");
    const lines = result.stdout.split("\n").filter((l) => l);
    expect(lines[1]).toMatch(/^drwxr-xr-x 1 bob devs\s+0 .+ \.$/);
    expect(lines[2]).toMatch(/^drwxr-xr-x 1 bob devs\s+0 .+ \.\.$/);
    expect(result.exitCode).toBe(0);
  });

  it("should use uid/gid from custom IFileSystem with name resolution", async () => {
    const inner = new Bash({
      files: { "/dir/owned.txt": "test" },
    });
    const wrappedFs = new Proxy(inner.fs, {
      get(target, prop, receiver) {
        if (prop === "stat") {
          return async (path: string): Promise<FsStat> => {
            const s = await target.stat(path);
            return { ...s, uid: 0, gid: 42 };
          };
        }
        if (prop === "lstat") {
          return async (path: string): Promise<FsStat> => {
            const s = await target.lstat(path);
            return { ...s, uid: 0, gid: 42 };
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as IFileSystem;

    const env = new Bash({
      fs: wrappedFs,
      uidToName: (uid) => (uid === 0 ? "root" : `user${uid}`),
      gidToName: (gid) => (gid === 42 ? "staff" : `group${gid}`),
    });
    const result = await env.exec("ls -l /dir");
    const lines = result.stdout.split("\n").filter((l) => l);
    expect(lines[1]).toMatch(/^-rw-r--r-- 1 root staff\s+4 .+ owned\.txt$/);
    expect(result.exitCode).toBe(0);
  });
});
