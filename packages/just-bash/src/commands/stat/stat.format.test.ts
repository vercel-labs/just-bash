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

  it("truncates %y with a precision under an output limit the result fits", async () => {
    const env = new Bash({
      files: { "/test.txt": { content: "hello world", mtime: MTIME } },
      executionLimits: { maxOutputSize: 3 },
    });
    const result = await env.exec("stat -c '%.2y' /test.txt");
    expect(result.stdout).toBe("20\n");
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

// Expected values below were recorded from GNU coreutils 9.12 `stat` on a
// file with the same size, mode and mtime, with the path written as /test.txt.
describe("stat -c flags and precision", () => {
  it.each([
    ["%#a", "0644"],
    ["%#f", "0x81a4"],
    ["[%#5a]", "[ 0644]"],
    ["[%-#8a]", "[0644    ]"],
    ["[%+5s]", "[   11]"],
    ["[% 5s]", "[   11]"],
    ["[%'s]", "[11]"],
    ["[%.4s]", "[0011]"],
    ["[%10.4n]", "[      /tes]"],
    ["[%.2n]", "[/t]"],
    ["[%012n]", "[   /test.txt]"],
    ["[%.2y]", "[20]"],
    ["[%-25.10y]", "[2024-01-15               ]"],
    ["[%5q]", "[?]"],
  ])("formats %s", async (format, expected) => {
    const result = await envWithFile().exec(`stat -c "${format}" /test.txt`);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["[%.3Y]", "[1705310234.764]"],
    ["[%.Y]", "[1705310234.764000000]"],
    ["[%.12Y]", "[1705310234.764000000000]"],
    ["[%.0Y]", "[1705310234]"],
    ["[%+.1Y]", "[+1705310234.7]"],
    ["[%+5Y]", "[+1705310234]"],
    ["[%15.3Y]", "[ 1705310234.764]"],
    ["[%-15.3Y]", "[1705310234.764 ]"],
    ["[%015.3Y]", "[01705310234.764]"],
    ["[%4.3Y]", "[1705310234.764]"],
    ["[%.3W]", "[0.000]"],
    ["[%5.3W]", "[0.000]"],
    ["[%6.3W]", "[ 0.000]"],
  ])("formats seconds since the epoch as %s", async (format, expected) => {
    const result = await envWithFile().exec(`stat -c "${format}" /test.txt`);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["a%5%b", "a", "%5%"],
    ["x%-", "x", "%-"],
    ["x%5", "x", "%5"],
    ["x%.%", "x", "%.%"],
  ])("rejects %s as an invalid directive", async (format, stdout, directive) => {
    const result = await envWithFile().exec(`stat -c "${format}" /test.txt`);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe(`stat: '${directive}': invalid directive\n`);
    expect(result.exitCode).toBe(1);
  });

  it("prints %% after a bare percent and a trailing percent as itself", async () => {
    const result = await envWithFile().exec("stat -c '%%%' /test.txt");
    expect(result.stdout).toBe("%%\n");
    expect(result.exitCode).toBe(0);
  });
});

// Expected values from GNU coreutils 9.12 `gstat`.
describe("stat -c on edge values", () => {
  it.each([
    ["[%.1Y]", "[-1.0]"],
    ["[%.2Y]", "[-1.00]"],
    ["[%.3Y]", "[-0.001]"],
    ["[%Y]", "[-1]"],
  ])("formats a mtime 1ms before the epoch as %s", async (format, expected) => {
    const env = new Bash({
      files: { "/f": { content: "", mtime: new Date(-1) } },
    });
    const result = await env.exec(`stat -c "${format}" /f`);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.exitCode).toBe(0);
  });

  // GNU's `%.1n` prints the first byte of `é` alone; a string cannot hold
  // half a character, so the character is dropped.
  it.each([
    ["[%3n]", "[ é]"],
    ["[%5n]", "[   é]"],
    ["[%-4n]", "[é  ]"],
    ["[%.2n]", "[é]"],
    ["[%.1n]", "[]"],
  ])("counts %s in bytes for a multibyte name", async (format, expected) => {
    const env = new Bash({ cwd: "/", files: { "/é": "" } });
    const result = await env.exec(`stat -c "${format}" é`);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.exitCode).toBe(0);
  });

  it("escapes a single quote in %N", async () => {
    const env = new Bash({ cwd: "/", files: { "/a';id;'b": "" } });
    const result = await env.exec(`stat -c '%N' "a';id;'b"`);
    expect(result.stdout).toBe("'a'\\'';id;'\\''b'\n");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    [":America/New_York", "2024-01-15 04:17:14.764000000 -0500"],
    [":EST5", "2024-01-15 09:17:14.764000000 +0000"],
    [":", "2024-01-15 09:17:14.764000000 +0000"],
  ])("reads TZ=%s as a zone name", async (tz, expected) => {
    const env = new Bash({
      files: {
        "/f": { content: "", mtime: new Date("2024-01-15T09:17:14.764Z") },
      },
      env: { TZ: tz },
    });
    const result = await env.exec("stat -c '%y' /f");
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.exitCode).toBe(0);
  });
});

describe("stat -c POSIX TZ strings", () => {
  it.each([
    [
      "EST5EDT,M3.2.0,M11.1.0",
      "2024-01-15T09:17:14.764Z",
      "2024-01-15 04:17:14.764000000 -0500",
    ],
    [
      "EST5EDT,M3.2.0,M11.1.0",
      "2024-07-15T09:17:14.764Z",
      "2024-07-15 05:17:14.764000000 -0400",
    ],
    [
      "EST5EDT,M3.2.0,M11.1.0",
      "2024-03-10T06:59:59Z",
      "2024-03-10 01:59:59.000000000 -0500",
    ],
    [
      "EST5EDT,M3.2.0,M11.1.0",
      "2024-03-10T07:00:00Z",
      "2024-03-10 03:00:00.000000000 -0400",
    ],
    [
      "EST5EDT,M3.2.0,M11.1.0",
      "2024-11-03T05:59:59Z",
      "2024-11-03 01:59:59.000000000 -0400",
    ],
    [
      "EST5EDT,M3.2.0,M11.1.0",
      "2024-11-03T06:00:00Z",
      "2024-11-03 01:00:00.000000000 -0500",
    ],
    [
      "AEST-10AEDT,M10.1.0,M4.1.0/3",
      "2024-01-15T09:17:14.764Z",
      "2024-01-15 20:17:14.764000000 +1100",
    ],
    [
      "AEST-10AEDT,M10.1.0,M4.1.0/3",
      "2024-07-15T09:17:14.764Z",
      "2024-07-15 19:17:14.764000000 +1000",
    ],
    ["EST5", "2024-07-15T09:17:14.764Z", "2024-07-15 04:17:14.764000000 -0500"],
    [
      "<+0530>-5:30",
      "2024-01-15T09:17:14.764Z",
      "2024-01-15 14:47:14.764000000 +0530",
    ],
    [
      "<XST>-0:00:30",
      "2024-01-15T09:17:14.764Z",
      "2024-01-15 09:17:44.764000000 +0000",
    ],
    [
      "<XST>0:00:30",
      "2024-01-15T09:17:14.764Z",
      "2024-01-15 09:16:44.764000000 -0000",
    ],
    [
      "<+053030>-5:30:30",
      "2024-01-15T09:17:14.764Z",
      "2024-01-15 14:47:44.764000000 +0530",
    ],
    [
      "<-053030>5:30:30",
      "2024-01-15T09:17:14.764Z",
      "2024-01-15 03:46:44.764000000 -0530",
    ],
    [
      "XST-24",
      "2024-01-15T09:17:14.764Z",
      "2024-01-16 09:17:14.764000000 +2400",
    ],
  ])("reads TZ=%s at %s", async (tz, mtime, expected) => {
    const env = new Bash({
      files: { "/f": { content: "", mtime: new Date(mtime) } },
      env: { TZ: tz },
    });
    const result = await env.exec("stat -c '%y' /f");
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("stat -c work limits", () => {
  it("charges the FORMAT scan against the loop limit", async () => {
    const env = new Bash({
      files: { "/test.txt": "hello" },
      executionLimits: { maxLoopIterations: 100 },
    });
    const result = await env.exec(`stat -c "%${"-".repeat(200)}s" /test.txt`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("stat: format work limit exceeded (100)");
    expect(result.exitCode).toBe(126);
  });
});
