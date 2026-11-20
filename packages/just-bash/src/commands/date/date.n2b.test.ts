// Automa N2b: explicit host timezone defaults never create a TZ environment entry.
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";

describe("date N2b reference and host timezone", () => {
  it("uses the supplied timezone without exporting TZ, including nested shells", async () => {
    const bash = new Bash({
      environmentInfo: { timeZone: "Asia/Shanghai", arch: "aarch64" },
    });
    const result = await bash.exec(
      "date -d 2020-01-01 +%s; bash -c 'date -d @0 -Iseconds'; echo ${TZ-unset}",
    );
    expect(result).toMatchObject({
      stdout: "1577808000\n1970-01-01T08:00:00+08:00\nunset\n",
      stderr: "",
      exitCode: 0,
    });
    expect(result.env).not.toHaveProperty("TZ");
  });
  it.each([
    "TZ=UTC",
    "TZ=",
    "TZ=Invalid/Zone",
  ])("honors explicit %s over the host default", async (prefix) => {
    const result = await new Bash({
      environmentInfo: { timeZone: "Asia/Shanghai" },
    }).exec(`${prefix} date -d @0 -Iseconds`);
    expect(result).toMatchObject({
      stdout: "1970-01-01T00:00:00+00:00\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("-u takes precedence for parsing as well as display", async () => {
    const result = await new Bash({ env: { TZ: "Asia/Shanghai" } }).exec(
      "date -u -d 2020-01-01 +%s",
    );
    expect(result.stdout).toBe("1577836800\n");
  });
  it("reads mtime through the filesystem and keeps subsecond precision", async () => {
    const bash = new Bash({
      files: { "/file": "x" },
      environmentInfo: { timeZone: "Asia/Shanghai" },
    });
    const at = new Date("2020-01-01T00:00:00.125Z");
    await bash.fs.utimes("/file", at, at);
    const result = await bash.exec("date -r /file '+%Y-%m-%d %H:%M:%S.%N %z'");
    expect(result.stdout).toBe("2020-01-01 08:00:00.125000000 +0800\n");
  });
  it("does not turn cancellation into a missing-file error", async () => {
    const bash = new Bash();
    vi.spyOn(bash.fs, "stat").mockRejectedValue(new ExecutionAbortedError());
    const result = await bash.exec("date -r /file");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("No such file");
  });
  it("reserves the ISO separator and trailing newline in the output budget", async () => {
    const result = await new Bash({
      executionLimits: { maxOutputSize: 25 },
    }).exec("date -u -d @0 -Iseconds");
    expect(result.exitCode).toBe(126);
    expect(result.stderr).toContain("output size limit exceeded");
  });
  it("rejects normalized invalid dates and nonexistent DST wall times", async () => {
    const bash = new Bash();
    for (const command of [
      "TZ=UTC date -d 2020-02-30",
      "TZ=America/New_York date -d '2024-03-10 02:30:00'",
    ]) {
      const result = await bash.exec(command);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("invalid date");
    }
  });
});
