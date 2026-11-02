import { afterEach, describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import type { FsStat } from "../../fs/interface.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";
import { allocatedFileBytes } from "../file-metadata.js";

const a12 = {
  user: "user",
  group: "user",
  nlink: 1,
  directorySize: 4096,
  allocationBlockSize: 4096,
};
const stamp = new Date("2000-01-02T03:04:05.123Z");
afterEach(() => vi.restoreAllMocks());

describe("ls long format", () => {
  it("only applies directory size and identity overrides when injected", async () => {
    for (const metadata of [
      undefined,
      { ...a12, user: "owner", group: "team", nlink: 3 },
    ]) {
      const bash = new Bash({
        files: { "/d/file": "17 bytes of text!" },
        virtualFileMetadata: metadata,
      });
      const result = await bash.exec("ls -ld --time-style=+STAMP /d");
      expect(result.stdout).toBe(
        metadata
          ? "drwxr-xr-x 3 owner team 4096 STAMP /d\n"
          : "drwxr-xr-x 1 user user 0 STAMP /d\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    }
  });

  it("keeps actual size/mode and aligns one operand block", async () => {
    const bash = new Bash({
      files: { "/a": { content: "x", mode: 0o4751 }, "/b": "y".repeat(1025) },
      virtualFileMetadata: a12,
    });
    const result = await bash.exec("ls -l --time-style=+STAMP /a /b");
    expect(result.stdout).toBe(
      "-rwsr-x--x 1 user user    1 STAMP /a\n-rw-r--r-- 1 user user 1025 STAMP /b\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("uses the injected timezone and lets explicit TZ override it", async () => {
    const bash = new Bash({
      files: { "/a": { content: "x", mtime: stamp } },
      environmentInfo: { timeZone: "Asia/Shanghai" },
    });
    const result = await bash.exec(
      "ls -l --time-style=long-iso /a; TZ=UTC ls -l --time-style=full-iso /a",
    );
    expect(result.stdout).toBe(
      "-rw-r--r-- 1 user user 1 2000-01-02 11:04 /a\n-rw-r--r-- 1 user user 1 2000-01-02 03:04:05.123000000 +0000 /a\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("shows years for old or future files and time only within half a year", async () => {
    const now = Date.parse("2026-07-01T12:00:00Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const bash = new Bash({
      files: {
        "/future": { content: "", mtime: new Date(now + 1000) },
        "/old": { content: "", mtime: stamp },
        "/recent": { content: "", mtime: new Date(now - 1000) },
      },
      environmentInfo: { timeZone: "UTC" },
    });
    const result = await bash.exec("ls -l /future /old /recent");
    expect(result.stdout).toBe(
      "-rw-r--r-- 1 user user 0 Jul  1  2026 /future\n-rw-r--r-- 1 user user 0 Jan  2  2000 /old\n-rw-r--r-- 1 user user 0 Jul  1 11:59 /recent\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    "--time-style=unknown",
    "--color=always",
    "--color",
    "--unsupported",
  ])("rejects unsupported options: %s", async (flag) => {
    const result = await new Bash().exec(`ls -l ${flag}`);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
    expect(result.exitCode).toBe(2);
  });

  it("counts allocated-size estimates, not file count or native disk blocks", async () => {
    const bash = new Bash({
      files: {
        "/d/empty": "",
        "/d/one": "x",
        "/d/large": "x".repeat(4097),
        "/d/sub/empty": "",
      },
      virtualFileMetadata: a12,
    });
    const result = await bash.exec("ls -l --time-style=+STAMP /d");
    expect(result.stdout).toBe(
      "total 16\n-rw-r--r-- 1 user user    0 STAMP empty\n-rw-r--r-- 1 user user 4097 STAMP large\n-rw-r--r-- 1 user user    1 STAMP one\ndrwxr-xr-x 1 user user 4096 STAMP sub\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const file = {
      isFile: true,
      isDirectory: false,
      isSymbolicLink: false,
      size: 4097,
      mtime: stamp,
      mode: 0o644,
    };
    expect(allocatedFileBytes(file, a12)).toBe(8192);
    expect(allocatedFileBytes({ ...file, isSymbolicLink: true }, a12)).toBe(0);
    expect(
      allocatedFileBytes({
        ...file,
        isFile: false,
        isDirectory: true,
        size: 0,
      }),
    ).toBe(0);
  });

  it("does not convert cancellation into a fabricated file listing", async () => {
    class AbortedFs extends InMemoryFs {
      override async lstat(path: string): Promise<FsStat> {
        if (path === "/d/file") throw new ExecutionAbortedError();
        return super.lstat(path);
      }
    }
    const result = await new Bash({
      fs: new AbortedFs({ "/d/file": "x" }),
    }).exec("ls -l /d");
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("No such file");
    expect(result.exitCode).not.toBe(0);
  });
});
