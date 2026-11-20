import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";

describe("cp N2c metadata and preflight", () => {
  it("copies file and directory mode and mtime under archive", async () => {
    const bash = new Bash({ files: { "/src/f": "x" } });
    const at = new Date("2020-01-01T00:00:00Z");
    await bash.fs.chmod("/src", 0o750);
    await bash.fs.chmod("/src/f", 0o640);
    await bash.fs.utimes("/src", at, at);
    await bash.fs.utimes("/src/f", at, at);
    const result = await bash.exec("cp -a /src /copy");
    expect(result.exitCode).toBe(0);
    expect(await bash.fs.stat("/copy")).toMatchObject({
      mode: 0o750,
      mtime: at,
    });
    expect(await bash.fs.stat("/copy/f")).toMatchObject({
      mode: 0o640,
      mtime: at,
    });
  });
  it("does not change a link target to fake preservation of link metadata", async () => {
    const bash = new Bash({ files: { "/target": "x" } });
    await bash.fs.symlink("/target", "/link");
    const before = await bash.fs.stat("/target");
    const result = await bash.exec("cp -a /link /copy");
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ENOTSUP");
    expect(await bash.fs.readlink("/copy")).toBe("/target");
    expect(await bash.fs.stat("/target")).toEqual(before);
  });
  it("does not hide cancellation in destination probes", async () => {
    const bash = new Bash({ files: { "/src": "x" } });
    vi.spyOn(bash.fs, "stat").mockRejectedValue(new ExecutionAbortedError());
    const result = await bash.exec("cp /src /copy");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("cannot stat");
  });
  it("bounds the retained plan before creating destinations", async () => {
    const bash = new Bash({
      files: { "/src/f": "x" },
      executionLimits: { maxLiveBytes: 300 },
    });
    const result = await bash.exec("cp -r /src /copy");
    expect(result.exitCode).toBe(126);
    expect(await bash.fs.exists("/copy")).toBe(false);
  });
  it("rejects aliases with the same backend identity", async () => {
    const bash = new Bash({ files: { "/src": "x", "/target": "old" } });
    const originalStat = bash.fs.stat.bind(bash.fs);
    vi.spyOn(bash.fs, "stat").mockImplementation(async (path) => ({
      ...(await originalStat(path)),
      identity: "same-backend-file",
    }));
    const copy = vi.spyOn(bash.fs, "cp");
    const result = await bash.exec("cp /src /target");
    expect(result.exitCode).toBe(1);
    expect(copy).not.toHaveBeenCalled();
  });
  it("keeps skipped files under no-clobber and does not change their mode", async () => {
    const bash = new Bash({ files: { "/src/f": "new", "/dst/f": "old" } });
    await bash.fs.chmod("/dst/f", 0o600);
    expect((await bash.exec("cp -anT /src /dst")).exitCode).toBe(0);
    expect(await bash.fs.readFile("/dst/f")).toBe("old");
    expect((await bash.fs.stat("/dst/f")).mode).toBe(0o600);
  });
});
