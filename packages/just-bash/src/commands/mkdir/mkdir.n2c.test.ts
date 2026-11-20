import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";

describe("mkdir N2c", () => {
  it("rejects invalid modes before creating any path", async () => {
    const bash = new Bash();
    const result = await bash.exec("mkdir -m invalid /new");
    expect(result.exitCode).toBe(1);
    expect(await bash.fs.exists("/new")).toBe(false);
  });
  it("never changes an existing directory mode with -p", async () => {
    const bash = new Bash({ files: { "/d/f": "x" } });
    await bash.fs.chmod("/d", 0o750);
    const result = await bash.exec("mkdir -pv -m700 /d");
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect((await bash.fs.stat("/d")).mode).toBe(0o750);
  });
  it("keeps cancellation fatal", async () => {
    const bash = new Bash();
    vi.spyOn(bash.fs, "mkdir").mockRejectedValue(new ExecutionAbortedError());
    expect((await bash.exec("mkdir /new")).exitCode).not.toBe(0);
  });
});
