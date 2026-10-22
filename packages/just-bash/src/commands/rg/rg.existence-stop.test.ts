import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg existence-only searches", () => {
  it("does not truncate the match spans used for multiline inversion", async () => {
    const bash = new Bash({ files: { "/input": "x\nx\n" } });
    for (const input of [
      "rg -Uv -l x /input",
      "printf 'x\\nx\\n' | rg -Uv -q x",
    ]) {
      expect(await bash.exec(input)).toMatchObject({
        stdout: "",
        stderr: "",
        exitCode: 1,
      });
    }
  });

  it.each([
    ["-l", "/input\n", 0],
    ["-q", "", 0],
    ["-q --passthru", "", 0],
    ["-l --passthru", "/input\n", 0],
    ["--files-without-match --passthru", "", 1],
    ["-q -o", "", 0],
    ["-l -o", "/input\n", 0],
    ["--files-without-match", "", 1],
    ["-vl", "/input\n", 0],
  ])("stops matching after the answer is known for %s", async (flags, stdout, exitCode) => {
    const bash = new Bash({
      files: {
        "/input": `first\n${"match ".repeat(400)}\n${"match\n".repeat(4000)}`,
      },
      executionLimits: { maxLoopIterations: 100 },
    });
    expect(await bash.exec(`rg ${flags} match /input`)).toMatchObject({
      stdout,
      stderr: "",
      exitCode,
    });
    expect(await bash.exec(`cat /input | rg ${flags} match`)).toMatchObject({
      stdout: stdout ? "(standard input)\n" : "",
      stderr: "",
      exitCode,
    });
  });

  it("still searches through the last line and handles no match", async () => {
    const bash = new Bash({
      files: { "/a": `${"other\n".repeat(100)}match\n`, "/b": "other\n" },
    });
    expect(await bash.exec("rg -l match /a /b")).toMatchObject({
      stdout: "/a\n",
      stderr: "",
      exitCode: 0,
    });
    expect(
      await bash.exec("rg --files-without-match match /a /b"),
    ).toMatchObject({
      stdout: "/b\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.exec("rg -l -m0 match /a")).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
    expect(await bash.exec("rg -c match /a")).toMatchObject({
      stdout: "1\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
