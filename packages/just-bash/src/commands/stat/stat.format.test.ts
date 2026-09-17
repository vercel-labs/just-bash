import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const MTIME = new Date("2024-01-15T09:17:14.764Z");

function envWithFile(): Bash {
  return new Bash({
    files: { "/test.txt": { content: "hello world", mtime: MTIME } },
  });
}

describe("stat -c timestamps", () => {
  it("renders %y as a wall clock, nanoseconds and offset", async () => {
    const result = await envWithFile().exec("stat -c '%y' /test.txt");
    expect(result.stdout).toBe("2024-01-15 09:17:14.764000000 +0000\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("renders %Y as whole seconds since the epoch", async () => {
    const result = await envWithFile().exec("stat -c '%Y' /test.txt");
    expect(result.stdout).toBe("1705310234\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("leaves access and change times unanswered", async () => {
    const result = await envWithFile().exec("stat -c '%x %X %z %Z' /test.txt");
    expect(result.stdout).toBe("? ? ? ?\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reports birth time as unrecorded", async () => {
    const result = await envWithFile().exec("stat -c '[%w] [%W]' /test.txt");
    expect(result.stdout).toBe("[-] [0]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("shows the timestamp in $TZ", async () => {
    const result = await envWithFile().exec(
      "export TZ=America/New_York && stat -c '%y' /test.txt",
    );
    expect(result.stdout).toBe("2024-01-15 04:17:14.764000000 -0500\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("falls back to UTC when $TZ is not a zone", async () => {
    const result = await envWithFile().exec(
      "export TZ=Not/AZone && stat -c '%y' /test.txt",
    );
    expect(result.stdout).toBe("2024-01-15 09:17:14.764000000 +0000\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("stat -c directives", () => {
  it("prints %a as permission bits without the file type", async () => {
    const env = new Bash({
      files: { "/test.txt": "hello", "/mydir/file.txt": "hello" },
    });
    const result = await env.exec("stat -c '%a' /test.txt /mydir");
    expect(result.stdout).toBe("644\n755\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints ? for a directive it cannot answer", async () => {
    const result = await envWithFile().exec(
      "stat -c 'i=[%i] q=[%q]' /test.txt",
    );
    expect(result.stdout).toBe("i=[?] q=[?]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints %f as the raw mode in hexadecimal", async () => {
    const result = await envWithFile().exec("stat -c '%f' /test.txt");
    expect(result.stdout).toBe("81a4\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("formats no wall clock for a FORMAT that names none", async () => {
    const env = new Bash({
      files: { "/test.txt": { content: "hello world", mtime: MTIME } },
      executionLimits: { maxOutputSize: 12 },
    });
    const result = await env.exec("stat -c '%s' /test.txt");
    expect(result.stdout).toBe("11\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints %% as a literal percent", async () => {
    const result = await envWithFile().exec("stat -c '100%%' /test.txt");
    expect(result.stdout).toBe("100%\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints a percent that runs off the end of FORMAT as itself", async () => {
    const result = await envWithFile().exec("stat -c 'size %s %' /test.txt");
    expect(result.stdout).toBe("size 11 %\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("pads a directive to a width, on either side", async () => {
    const result = await envWithFile().exec(
      "stat -c '[%5s][%-5s][%05s]' /test.txt",
    );
    expect(result.stdout).toBe("[   11][11   ][00011]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("bounds a width that would outgrow the output limit", async () => {
    const env = new Bash({
      files: { "/test.txt": "hello" },
      executionLimits: { maxOutputSize: 32 },
    });
    const result = await env.exec("stat -c '%999999999s' /test.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("output size limit exceeded");
    expect(result.exitCode).toBe(126);
  });
});
