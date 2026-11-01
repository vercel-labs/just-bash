// Automa modifications: N00b regressions migrated from shell-flags and parallel-output suites.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("Automa xargs adapters", () => {
  it.each([
    [
      "printf ' a b\\nc d\\n' | xargs -I{} printf '<%s>\\n' '{}'",
      "<a b>\n<c d>\n",
    ],
    ["printf 'a b\\nc d\\ne\\n' | xargs -n2 echo", "a b\nc d\ne\n"],
    ["printf 'a b\\nc d\\ne\\n' | xargs -L2 echo", "a b c d\ne\n"],
    ["printf 'a \\nb\\n\\nc\\n' | xargs -L1 echo", "a b\nc\n"],
    ["printf 'x\\n' | xargs -n1 printf '%s:%s\\n' -n1", "-n1:x\n"],
    ["printf 'a,b,c' | xargs -d, -n2 echo", "a b\nc\n"],
    ["printf 'a\\0b\\0' | xargs -0 -n1 echo", "a\nb\n"],
    ["printf 'a\\nb\\n' | xargs -P2 -n1 echo", "a\nb\n"],
  ])("handles %s", async (command, stdout) => {
    expect(await new Bash().exec(command)).toMatchObject({
      stdout,
      stderr: "",
      exitCode: 0,
    });
  });
  it.each([
    "-L0",
    "-Lno",
    "-L",
    "-n0",
  ])("rejects invalid counts %s", async (flag) => {
    const result = await new Bash().exec(`printf 'a\\nb\\n' | xargs ${flag}`);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toBe("");
    expect(result.exitCode).not.toBe(0);
  });
  it("isolates concurrent output sinks without duplication or missing chunks", async () => {
    const chunks: string[] = [];
    const result = await new Bash().exec(
      "seq 4 | xargs -P2 -n1 bash -c 'echo start$0;echo err$0 >&2;echo end$0'",
      {
        onOutput: (text) => {
          chunks.push(text);
        },
      },
    );
    const expected = Array.from(
      { length: 4 },
      (_, i) => `start${i + 1}\nerr${i + 1}\nend${i + 1}\n`,
    ).join("");
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(expected);
    expect(chunks.join("")).toBe(expected);
  });
});
