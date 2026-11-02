// Automa N2a argument-file behavior adapted from vercel-labs/just-bash#714.
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";

describe("xargs N2a argument files and bounded execution", () => {
  it.each([
    "-a /args",
    "-a/args",
    "--arg-file /args",
    "--arg-file=/args",
  ])("reads UTF-8 with %s", async (flag) => {
    const result = await new Bash({ files: { "/args": "café\n東京\n" } }).exec(
      `printf ignored | xargs ${flag} -n1 echo`,
    );
    expect(result).toMatchObject({
      stdout: "café\n東京\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("charges argument-file reads across command invocations", async () => {
    const bash = new Bash({
      files: { "/args": "abc\n" },
      executionLimits: { maxInputBytes: 6 },
    });
    const result = await bash.exec("xargs -a /args echo; xargs -a /args echo");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("input size limit exceeded");
  });
  it("reserves argument-file bytes before reading", async () => {
    const bash = new Bash({
      files: { "/args": "abc\n" },
      executionLimits: { maxLiveBytes: 4 },
    });
    const read = vi.spyOn(bash.fs, "readFile");
    const result = await bash.exec("xargs -a /args echo");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("live byte limit exceeded");
    expect(read).not.toHaveBeenCalled();
  });
  it("preserves cancellation instead of a file diagnostic", async () => {
    const bash = new Bash({ files: { "/args": "abc\n" } });
    vi.spyOn(bash.fs, "stat").mockRejectedValue(new ExecutionAbortedError());
    const result = await bash.exec("xargs -a /args echo");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("Unable to read argument");
  });
  it("does not run batches after exit 255", async () => {
    const result = await new Bash().exec(
      "printf 'first second' | xargs -n1 bash -c 'echo $0; exit 255'",
    );
    expect(result).toMatchObject({
      stdout: "first\n",
      stderr: "xargs: bash: exited with status 255; aborting\n",
      exitCode: 124,
    });
  });
  it("keeps a child --help argument intact", async () => {
    const result = await new Bash().exec("printf item | xargs echo --help");
    expect(result).toMatchObject({
      stdout: "--help item\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it.each([
    "ab",
    "é",
  ])("rejects a multi-byte delimiter %s", async (delimiter) => {
    const result = await new Bash().exec(
      `printf item | xargs -d '${delimiter}' echo`,
    );
    expect(result).toMatchObject({
      stdout: "",
      stderr: "xargs: delimiter must be one byte\n",
      exitCode: 1,
    });
  });
});
