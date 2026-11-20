// Automa modifications: N00b C locale, per-key ordering and unique regressions.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("Automa sort and uniq compatibility", () => {
  it.each([
    "C",
    "C.UTF-8",
    "C.utf8",
    "POSIX",
  ])("orders Unicode scalars in %s", async (locale) => {
    const shell = new Bash({ env: { LC_ALL: locale } });
    expect(
      await shell.exec("printf 'z\\nZ\\né\\n😀\\n一\\n' | sort"),
    ).toMatchObject({ stdout: "Z\nz\né\n一\n😀\n", stderr: "", exitCode: 0 });
  });
  it.each([
    ["printf 'b\\nA\\nB\\na\\n' | sort -f", "A\na\nB\nb\n"],
    [
      "printf '2 second\\n1 first\\n1 other\\n' | sort -nu",
      "1 first\n2 second\n",
    ],
    ["printf 'b 1\\na 1\\na 2\\n' | sort -u -k1,1 -k2,2n", "a 1\na 2\nb 1\n"],
    ["printf 'a 10\\nb 2\\n' | sort -n -k2,2r", "b 2\na 10\n"],
    ["printf 'a 10\\nb 2\\n' | sort -n -k2,2", "b 2\na 10\n"],
    ["printf 'a\\na\\nb\\n' | uniq -c", "      2 a\n      1 b\n"],
  ])("matches ordering for %s", async (command, stdout) => {
    expect(
      await new Bash({ env: { LC_ALL: "C" } }).exec(command),
    ).toMatchObject({ stdout, stderr: "", exitCode: 0 });
  });
  it("rejects equivalent adjacent keys under -cu", async () => {
    expect(
      await new Bash({ env: { LC_ALL: "C" } }).exec(
        "printf '1 a\\n1 b\\n' | sort -ncu",
      ),
    ).toMatchObject({
      stdout: "",
      stderr: "sort: -:2: disorder: 1 b\n",
      exitCode: 1,
    });
  });
});
