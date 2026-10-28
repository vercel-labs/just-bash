import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";

describe("awk program files", () => {
  it.each([
    "-F",
    "-v",
  ])("rejects a missing %s argument with a program file", async (flag) => {
    const bash = new Bash({ files: { "/p.awk": "BEGIN {print 7}" } });
    expect(await bash.exec(`awk -f /p.awk ${flag}`)).toMatchObject({
      stdout: "",
      stderr: `awk: ${flag} requires an argument\n`,
      exitCode: 1,
    });
  });

  it.each([
    "-f /p.awk",
    "-f/p.awk",
  ])("executes %s with ordinary options and data operands", async (flag) => {
    const bash = new Bash({
      files: {
        "/p.awk": "{print prefix, $2}",
        "/data": "one,two\nthree,four\n",
      },
    });
    expect(await bash.exec(`awk ${flag} -F, -v prefix=x /data`)).toMatchObject({
      stdout: "x two\nx four\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("joins repeated program files with newlines and reads data from stdin", async () => {
    const bash = new Bash({
      files: {
        "/first.awk": "BEGIN {print 1} # comment",
        "/second.awk": "{print $1}",
      },
    });
    expect(
      await bash.exec(
        "printf 'hello world\\n' | awk -f /first.awk -f /second.awk",
      ),
    ).toMatchObject({ stdout: "1\nhello\n", stderr: "", exitCode: 0 });
  });

  it("can read the program from stdin without reusing it as data", async () => {
    const bash = new Bash();
    expect(
      await bash.exec("echo 'BEGIN {print 1} {print 2}' | awk -f -"),
    ).toMatchObject({ stdout: "1\n", stderr: "", exitCode: 0 });
  });

  it.each([
    ["awk -f", "awk: -f requires a filename\n"],
    ["awk -f /missing", "awk: /missing: No such file or directory\n"],
  ])("reports unavailable program input: %s", async (command, stderr) => {
    expect(await new Bash().exec(command)).toMatchObject({
      stdout: "",
      stderr,
      exitCode: 1,
    });
  });

  it("applies input limits to program files", async () => {
    const bash = new Bash({
      files: { "/p.awk": 'BEGIN {print "long program"}' },
      executionLimits: { maxInputBytes: 8 },
    });
    const result = await bash.exec("awk -f /p.awk");
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("input size limit exceeded");
  });
  it("rejects a program file before reading beyond the remaining source budget", async () => {
    const bash = new Bash({
      files: { "/a.awk": "#".repeat(140), "/b.awk": "#".repeat(140) },
      executionLimits: { maxStringLength: 200, maxInputBytes: 1000 },
    });
    const read = vi.spyOn(bash.fs, "readFile");
    const result = await bash.exec("awk -f /a.awk -f /b.awk");
    expect(result.stdout).toBe("");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toBe(
      "bash: awk: output size limit exceeded (200 bytes)\n",
    );
    expect(read.mock.calls.map(([path]) => path)).toEqual(["/a.awk"]);
  });
});
