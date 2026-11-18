import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { FileSystemPolicyError } from "../../fs/traversal.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";

class UnreadableFs extends InMemoryFs {
  constructor(
    private readonly failure: Error = new Error(
      "EACCES: permission denied, scandir '/data/locked'",
    ),
  ) {
    super({
      "/data/docs/notes.txt": "x".repeat(1024),
      "/data/locked/secret.txt": "secret",
      "/data/z-after/notes.txt": "x".repeat(2048),
      "/other/file.txt": "x".repeat(1024),
    });
  }

  override async readdir(path: string): Promise<string[]> {
    if (path === "/data/locked") throw this.failure;
    return super.readdir(path);
  }
}

describe("du over an unreadable directory", () => {
  it("retains earlier output and visits later siblings and operands", async () => {
    const result = await new Bash({ fs: new UnreadableFs(), cwd: "/" }).exec(
      "du data other",
    );
    expect(result).toMatchObject({
      stdout:
        "1\tdata/docs\n1\tdata/locked\n2\tdata/z-after\n3\tdata\n1\tother\n",
      stderr: "du: cannot read directory 'data/locked': Permission denied\n",
      exitCode: 1,
    });
  });

  it.each([
    "-s",
    "--max-depth=0",
  ])("keeps the accessible total with %s and -c", async (flag) => {
    const result = await new Bash({ fs: new UnreadableFs(), cwd: "/" }).exec(
      `du ${flag} -c data`,
    );
    expect(result).toMatchObject({
      stdout: "3\tdata\n3\ttotal\n",
      stderr: "du: cannot read directory 'data/locked': Permission denied\n",
      exitCode: 1,
    });
  });

  it.each([
    ["/", "/data/locked"],
    ["data/", "data/locked"],
  ])("does not duplicate separators for operand %s", async (operand, failedPath) => {
    const result = await new Bash({ fs: new UnreadableFs(), cwd: "/" }).exec(
      `du -s ${operand} >/dev/null`,
    );
    expect(result).toMatchObject({
      stdout: "",
      stderr: `du: cannot read directory '${failedPath}': Permission denied\n`,
      exitCode: 1,
    });
  });

  it("uses a native errno without exposing the backend message", async () => {
    const error = new Error("host-specific diagnostic");
    Object.defineProperty(error, "code", { value: "EACCES" });
    const result = await new Bash({
      fs: new UnreadableFs(error),
      cwd: "/",
    }).exec("du -s data");
    expect(result).toMatchObject({
      stdout: "3\tdata\n",
      stderr: "du: cannot read directory 'data/locked': Permission denied\n",
      exitCode: 1,
    });
  });

  it.each([
    new ExecutionAbortedError(),
    new ExecutionLimitError("test traversal limit", "iterations"),
    new FileSystemPolicyError("readdir", "/data/locked", "refused"),
  ])("does not continue after a non-filesystem failure: %s", async (error) => {
    const result = await new Bash({
      fs: new UnreadableFs(error),
      cwd: "/",
    }).exec("du data");
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});
