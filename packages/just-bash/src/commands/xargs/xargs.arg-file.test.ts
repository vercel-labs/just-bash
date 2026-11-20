import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";

describe("xargs argument files", () => {
  it.each([
    "-a args",
    "-aargs",
    "--arg-file args",
    "--arg-file=args",
  ])("reads arguments with %s", async (flag) => {
    const bash = new Bash({
      cwd: "/work",
      files: { "/work/args": "café\n東京\n" },
    });
    const result = await bash.exec(`printf ignored | xargs ${flag} -n 1 echo`);
    expect(result).toMatchObject({
      stdout: "café\n東京\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("preserves standard input for the invoked command", async () => {
    const bash = new Bash({ files: { "/args": "-\n" } });
    const result = await bash.exec(
      "printf 'café payload' | xargs -a /args cat",
    );
    expect(result).toMatchObject({
      stdout: "café payload",
      stderr: "",
      exitCode: 0,
    });
  });
  it("uses the existing null-delimited parser", async () => {
    const bash = new Bash({ files: { "/args": "a b\0c\0" } });
    const result = await bash.exec("xargs -0 -a /args -n 1 echo");
    expect(result).toMatchObject({
      stdout: "a b\nc\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it.each(["-a -", "--arg-file=-"])("reads stdin with %s", async (flag) => {
    const result = await new Bash().exec(
      `printf 'café\\n' | xargs ${flag} echo`,
    );
    expect(result).toMatchObject({ stdout: "café\n", stderr: "", exitCode: 0 });
  });
  it("charges repeated argument-file reads to the shared input budget", async () => {
    const bash = new Bash({
      files: { "/args": "café\n" },
      executionLimits: { maxInputBytes: 10 },
    });
    const result = await bash.exec("xargs -a /args true; xargs -a /args true");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(
      "xargs: aggregate input size limit exceeded (10 bytes)",
    );
  });
  it("consumes --help as an argument-file operand", async () => {
    const bash = new Bash({
      cwd: "/work",
      files: { "/work/--help": "one two" },
    });
    expect(await bash.exec("xargs -a --help echo")).toMatchObject({
      stdout: "one two\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("does not recover from an aborted argument-file read", async () => {
    const bash = new Bash({ files: { "/args": "one" } });
    vi.spyOn(bash.fs, "readFileBytes").mockRejectedValue(
      new ExecutionAbortedError(),
    );
    const result = await bash.exec("xargs -a /args echo; echo continued");
    expect(result.stdout).toBe("");
    expect(result.exitCode).not.toBe(0);
  });
  it("keeps host filesystem errors out of argument-file diagnostics", async () => {
    const bash = new Bash();
    vi.spyOn(bash.fs, "readFileBytes").mockRejectedValue(
      new Error("ENOENT: open '/home/host/secret'"),
    );
    expect(await bash.exec("xargs -a /missing echo")).toMatchObject({
      stdout: "",
      stderr: "xargs: /missing: No such file or directory\n",
      exitCode: 1,
    });
  });
  it("reports a missing argument file", async () => {
    const result = await new Bash().exec("xargs -a /missing echo");
    expect(result).toMatchObject({
      stdout: "",
      stderr: "xargs: /missing: No such file or directory\n",
      exitCode: 1,
    });
  });
  it.each([
    "-a",
    "--arg-file",
  ])("reports a missing operand for %s", async (flag) => {
    const result = await new Bash().exec(`xargs ${flag}`);
    expect(result).toMatchObject({
      stdout: "",
      stderr: `xargs: option '${flag}' requires an argument\n`,
      exitCode: 1,
    });
  });
});
