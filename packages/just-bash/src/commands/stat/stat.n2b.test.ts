// Automa N2b: virtual display metadata and bounded formatting.
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";

describe("stat N2b", () => {
  it("uses explicit virtual identities and directory size", async () => {
    const bash = new Bash({
      files: { "/dir/file": "x" },
      virtualFileMetadata: {
        uid: 42,
        gid: 43,
        user: "alice",
        group: "staff",
        nlink: 1,
        directorySize: 4096,
        allocationBlockSize: 4096,
      },
    });
    const result = await bash.exec("stat -c '%u:%g %U:%G %h %i %s' /dir");
    expect(result).toMatchObject({
      stdout: "42:43 alice:staff 1 0 4096\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("uses a backend inode when one exists", async () => {
    const bash = new Bash({ files: { "/file": "x" } });
    const stat = await bash.fs.lstat("/file");
    vi.spyOn(bash.fs, "lstat").mockResolvedValue({ ...stat, ino: 12345n });
    expect((await bash.exec("stat -c %i /file")).stdout).toBe("12345\n");
  });
  it("shows timestamp milliseconds in the host timezone without exporting it", async () => {
    const bash = new Bash({
      files: { "/file": "x" },
      environmentInfo: { timeZone: "Asia/Shanghai" },
    });
    const at = new Date("2020-01-01T00:00:00.125Z");
    await bash.fs.utimes("/file", at, at);
    const result = await bash.exec(
      "stat --printf='%Y|%y\\n' /file; echo ${TZ-unset}",
    );
    expect(result.stdout).toBe(
      "1577836800|2020-01-01 08:00:00.125000000 +0800\nunset\n",
    );
  });
  it("keeps binary printf escapes as bytes", async () => {
    const result = await new Bash({ files: { "/file": "x" } }).exec(
      "stat --printf='\\377\\0%n' /file | od -An -t x1",
    );
    expect(result.stdout.trim()).toBe("ff 00 2f 66 69 6c 65");
  });
  it("counts formatting work and does not swallow a resource failure", async () => {
    const result = await new Bash({
      files: { "/file": "x" },
      executionLimits: { maxLoopIterations: 2 },
    }).exec("stat -c '%n%n%n' /file");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("iteration limit exceeded");
  });
  it("does not turn cancellation into a stat diagnostic", async () => {
    const bash = new Bash();
    vi.spyOn(bash.fs, "lstat").mockRejectedValue(new ExecutionAbortedError());
    const result = await bash.exec("stat /file");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("cannot stat");
  });
});
