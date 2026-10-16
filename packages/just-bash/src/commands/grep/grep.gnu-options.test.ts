import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const setup = () =>
  new Bash({
    files: { "/w/a.txt": "alpha\ngamma\n", "/w/b.bin": "alpha\0\n" },
  });

describe("grep GNU options", () => {
  it("accepts attached and bundled values and long value options", async () => {
    const result = await setup().exec(
      "grep -m -1 --color=tty -nA1 alpha /w/a.txt; grep --max-count=-1 --color=yes --context=1 --regexp=alpha /w/a.txt; grep -rnealpha --include '*.txt' --exclude '*.bin' /w",
    );
    expect(result).toMatchObject({
      stdout: "1:alpha\n2-gamma\nalpha\ngamma\n/w/a.txt:1:alpha\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("supports binary skipping, filename controls and quiet file errors", async () => {
    const result = await setup().exec(
      "grep -rIlZ alpha /w; grep -HnZ --color=never --line-buffered --binary-files=text alpha /w/a.txt; grep -as alpha /missing",
    );
    expect(result).toMatchObject({
      stdout: "/w/a.txt\0/w/a.txt\x001:alpha\n",
      stderr: "",
      exitCode: 2,
    });
  });

  it("uses status 2 for unknown, missing and invalid option values", async () => {
    const bash = setup();
    for (const [script, stderr] of [
      ["grep --wat alpha", "grep: unrecognized option '--wat'\n"],
      ["grep -nA", "grep: option requires an argument -- 'A'\n"],
      ["grep -nAwrong alpha", "grep: invalid context length argument: wrong\n"],
      ["grep -s alpha /w", ""],
      [
        "grep -s -f /missing /w/a.txt",
        "grep: /missing: No such file or directory\n",
      ],
      ["grep -s -f '' /w/a.txt", "grep: : No such file or directory\n"],
    ]) {
      expect(await bash.exec(script)).toMatchObject({
        stdout: "",
        stderr,
        exitCode: 2,
      });
    }
  });
});
