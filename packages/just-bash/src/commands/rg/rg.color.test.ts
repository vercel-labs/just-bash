import { describe, expect, it } from "vitest";
import { Bash } from "../../index.js";

describe("rg color control", () => {
  it("accepts the color option and option terminator used by sandbox clients", async () => {
    const bash = new Bash({
      cwd: "/workspace",
      files: { "/workspace/input.ts": "const needle = true;\n" },
    });

    const result = await bash.exec(
      "rg --line-number --heading --color never -- needle input.ts",
    );

    expect({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }).toEqual({
      stdout: "1:const needle = true;\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("accepts the equals form for disabling color", async () => {
    const bash = new Bash({
      cwd: "/workspace",
      files: { "/workspace/input.ts": "const needle = true;\n" },
    });

    const result = await bash.exec("rg --color=never needle input.ts");

    expect({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }).toEqual({
      stdout: "const needle = true;\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("treats arguments after the option terminator as positional", async () => {
    const bash = new Bash({
      cwd: "/workspace",
      files: { "/workspace/input.txt": "-needle\nother\n" },
    });

    const result = await bash.exec("rg -- -needle input.txt");

    expect({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }).toEqual({
      stdout: "-needle\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("rejects unknown color modes", async () => {
    const bash = new Bash({
      cwd: "/workspace",
      files: { "/workspace/input.ts": "const needle = true;\n" },
    });

    const result = await bash.exec("rg --color ultraviolet needle input.ts");

    expect({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }).toEqual({
      stdout: "",
      stderr:
        "rg: error parsing flag --color: choice 'ultraviolet' is unrecognized\n",
      exitCode: 2,
    });
  });
});
