import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * `ls` operands are literal paths, never patterns.
 *
 * Pathname expansion belongs to the shell, so by the time `ls` runs, an
 * operand holding `*`, `?` or `[` is either a filename that genuinely
 * contains those characters or a pattern that matched nothing and was passed
 * through unchanged. Re-matching it inside `ls` breaks both cases: a file
 * named `report [2].pdf` fails to match itself, because `[2]` reads as a
 * character class.
 *
 * Measured against GNU coreutils ls 9.2, cross-checked against BSD ls
 * (macOS 15). Both list a bracketed name when handed it literally, and both
 * report an unmatched pattern as a missing file. They differ only in the exit
 * status for the missing case (GNU 2, BSD 1) and in the wording of the
 * diagnostic; just-bash follows GNU on the status and keeps its own existing
 * `ls: NAME: No such file or directory` wording.
 */

const BRACKET_NAME = "report [ ref:!00D2 ].pdf";

describe("ls treats operands as literal paths", () => {
  it("lists a name containing bracket characters", async () => {
    const bash = new Bash({
      cwd: "/w",
      files: { [`/w/${BRACKET_NAME}`]: "body\n" },
    });
    const result = await bash.exec(`ls -l '${BRACKET_NAME}'`);
    expect(result.stdout).toContain(BRACKET_NAME);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("lists bracketed names reached through shell expansion", async () => {
    const bash = new Bash({
      cwd: "/w",
      files: { [`/w/${BRACKET_NAME}`]: "body\n", "/w/plain.pdf": "body\n" },
    });
    const result = await bash.exec("ls -l *.pdf");
    expect(result.stdout).toContain(BRACKET_NAME);
    expect(result.stdout).toContain("plain.pdf");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["question mark", "q?mark.txt"],
    ["asterisk", "star*x.txt"],
    ["bracket", BRACKET_NAME],
  ])("echoes an absolute operand back for a %s name", async (_label, name) => {
    const bash = new Bash({ cwd: "/", files: { [`/w/${name}`]: "body\n" } });
    const result = await bash.exec(`ls -l '/w/${name}'`);
    expect(result.stdout.startsWith("-rw-r--r-- 1 user user     5 ")).toBe(
      true,
    );
    expect(result.stdout.endsWith(` /w/${name}\n`)).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("reports an unmatched pattern as a missing file", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/a.txt": "" } });
    const result = await bash.exec("ls 'nope*'");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("ls: nope*: No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("does not let an operand match outside the directory it names", async () => {
    const bash = new Bash({
      cwd: "/w",
      files: { "/w/sub/deep.txt": "", "/w/top.txt": "" },
    });
    const result = await bash.exec("ls 'sub/*'");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("ls: sub/*: No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });
});
