import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const setup = () =>
  new Bash({
    cwd: "/w",
    files: {
      "/w/a.txt": "alpha\n",
      "/w/.hidden.ts": "alpha\n",
      "/w/real/s.txt": "alpha\n",
    },
  });

describe("grep recursive operands", () => {
  it("defaults to cwd, includes hidden files, and preserves an explicit ./", async () => {
    const bash = setup();
    const result = await bash.exec(
      "grep -rn alpha | sort; grep -rn alpha . | sort",
    );
    expect(result).toMatchObject({
      stdout:
        ".hidden.ts:1:alpha\na.txt:1:alpha\nreal/s.txt:1:alpha\n./.hidden.ts:1:alpha\n./a.txt:1:alpha\n./real/s.txt:1:alpha\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("reports missing recursive operands even when another operand matches", async () => {
    for (const quiet of [false, true]) {
      const result = await setup().exec(
        `grep -r${quiet ? "q" : ""} alpha /nonexist a.txt`,
      );
      expect(result).toMatchObject({
        stdout: quiet ? "" : "a.txt:alpha\n",
        stderr: "grep: /nonexist: No such file or directory\n",
        exitCode: quiet ? 0 : 2,
      });
    }
  });

  it("follows only operand symlinks with -r and all symlinks with -R", async () => {
    const bash = setup();
    const result = await bash.exec(
      "ln -s /w/real /w/link; grep -rl alpha . | sort; grep -rl alpha link; grep -Rrl alpha . | sort",
    );
    expect(result).toMatchObject({
      stdout:
        "./.hidden.ts\n./a.txt\n./real/s.txt\nlink/s.txt\n./.hidden.ts\n./a.txt\n./link/s.txt\n./real/s.txt\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
