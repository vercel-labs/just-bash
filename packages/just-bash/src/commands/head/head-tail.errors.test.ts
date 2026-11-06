import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";

function failingFs(method: "stat" | "readFileBytes", error: unknown) {
  const fs = new InMemoryFs({ "/data.csv": "region\nAPAC\n", "/good": "ok\n" });
  return new Proxy(fs, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      if (prop === method) {
        return async (path: string) => {
          if (path === "/data.csv") throw error;
          return value.call(target, path);
        };
      }
      return value.bind(target);
    },
  });
}

describe.each(["head", "tail"])("%s filesystem errors", (command) => {
  it.each([
    "stat",
    "readFileBytes",
  ] as const)("reports I/O errors from %s", async (method) => {
    const fs = failingFs(
      method,
      new Error("EIO: read failed at /private/host/file"),
    );
    const result = await new Bash({ fs }).exec(`${command} /data.csv`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${command}: /data.csv: Input/output error\n`);
    expect(result.exitCode).toBe(1);
  });

  it.each([
    ["EACCES", "Permission denied"],
    ["EPERM", "Operation not permitted"],
    ["ENOTDIR", "Not a directory"],
    ["ELOOP", "Too many levels of symbolic links"],
  ])("reports structured %s without exposing host messages", async (code, reason) => {
    const error = new Error("private filesystem details");
    Object.defineProperty(error, "code", { value: code });
    const result = await new Bash({ fs: failingFs("stat", error) }).exec(
      `${command} /data.csv`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${command}: /data.csv: ${reason}\n`);
    expect(result.exitCode).toBe(1);
  });

  it("keeps actual missing files distinct", async () => {
    const result = await new Bash().exec(`${command} /missing`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `${command}: /missing: No such file or directory\n`,
    );
    expect(result.exitCode).toBe(1);
  });

  it("reports directories accurately", async () => {
    const result = await new Bash({ files: { "/dir/file": "x" } }).exec(
      `${command} /dir`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${command}: /dir: Is a directory\n`);
    expect(result.exitCode).toBe(1);
  });

  it.each([
    new Error("private transport details"),
    null,
    "unexpected",
  ])("does not invent a missing file for unknown errors", async (error) => {
    const result = await new Bash({ fs: failingFs("stat", error) }).exec(
      `${command} /data.csv`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${command}: /data.csv: Input/output error\n`);
    expect(result.exitCode).toBe(1);
  });

  it("continues with later operands while retaining failure", async () => {
    const result = await new Bash({
      fs: failingFs("readFileBytes", new Error("EIO: remote read")),
    }).exec(`${command} -q /data.csv /good`);
    expect(result.stdout).toBe("ok\n");
    expect(result.stderr).toBe(`${command}: /data.csv: Input/output error\n`);
    expect(result.exitCode).toBe(1);
  });

  it("does not swallow execution limits or continue the script", async () => {
    const error = new ExecutionLimitError(
      "fixture input limit",
      "string_length",
    );
    const result = await new Bash({
      fs: failingFs("readFileBytes", error),
    }).exec(`${command} /data.csv; echo must-not-run`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: fixture input limit\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it.each([
    false,
    true,
  ])("preserves pipeline exit semantics with pipefail=%s", async (pipefail) => {
    const prefix = pipefail ? "set -o pipefail; " : "";
    const result = await new Bash({
      fs: failingFs("readFileBytes", new Error("EIO: remote read")),
    }).exec(`${prefix}${command} /data.csv | cat`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`${command}: /data.csv: Input/output error\n`);
    expect(result.exitCode).toBe(pipefail ? 1 : 0);
  });
});
