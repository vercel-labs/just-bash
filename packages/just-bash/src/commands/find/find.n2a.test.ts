// Automa N2a: adapted from vercel-labs/just-bash#555, checked against GNU find 4.10.0.
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";

describe("find N2a time predicates and quit", () => {
  const now = Date.UTC(2026, 0, 2, 12);
  for (const [predicate, stdout] of [
    ["-mmin 1", "/p/fresh\n"],
    ["-mmin 2", "/p/recent\n"],
    ["-mmin -2", "/p/fresh\n/p/recent\n"],
    ["-mmin +2", "/p/old\n"],
    ["-mtime 0", "/p/fresh\n/p/recent\n"],
    ["-mtime +1", ""],
    ["-mtime 1", "/p/old\n"],
  ]) {
    it(predicate, async () => {
      const bash = new Bash({
        files: {
          "/p/fresh": { content: "", mtime: new Date(now - 30_000) },
          "/p/recent": { content: "", mtime: new Date(now - 90_000) },
          "/p/old": { content: "", mtime: new Date(now - 36 * 3600_000) },
        },
      });
      const clock = vi.spyOn(Date, "now").mockReturnValue(now);
      try {
        expect(
          await bash.exec(`find /p -type f ${predicate} | sort`),
        ).toMatchObject({ stdout, stderr: "", exitCode: 0 });
      } finally {
        clock.mockRestore();
      }
    });
  }

  it("quits before reading directory contents", async () => {
    const bash = new Bash({ files: { "/p/f": "" } });
    const read = vi
      .spyOn(bash.fs, "readdirWithFileTypes")
      .mockRejectedValue(new Error("must not read"));
    expect(await bash.exec("find /p -quit -print")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects invalid newermt before any actions", async () => {
    const bash = new Bash({ files: { "/p/f": "keep" } });
    const result = await bash.exec("find /p -newermt 2026-02-31 -delete");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("cannot figure out");
    expect(await bash.fs.readFile("/p/f")).toBe("keep");
  });

  it("fails visibly for a missing newer reference", async () => {
    const result = await new Bash({ files: { "/p/f": "" } }).exec(
      "find /p -newer /missing",
    );
    expect(result).toMatchObject({
      stdout: "",
      stderr: "find: /missing: Unable to inspect reference file\n",
      exitCode: 1,
    });
  });

  it("does not suppress cancellation while reading a newer reference", async () => {
    const bash = new Bash({ files: { "/p/f": "" } });
    const stat = bash.fs.stat.bind(bash.fs);
    vi.spyOn(bash.fs, "stat").mockImplementation(async (path) => {
      if (path === "/ref") throw new ExecutionAbortedError();
      return stat(path);
    });
    const result = await bash.exec("find /p -newer /ref");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("Unable to inspect");
  });
});
