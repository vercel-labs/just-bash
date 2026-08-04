import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

function expectResult(
  result: { stdout: string; stderr: string; exitCode: number },
  expected: { stdout: string; stderr: string; exitCode: number },
): void {
  expect({
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  }).toEqual(expected);
}

describe("grep option parsing", () => {
  it("stops parsing options after --", async () => {
    const env = new Bash({
      files: {
        "/patterns.txt": "match\n-x\n--help\n",
        "/-input.txt": "match\n",
      },
    });

    const pattern = await env.exec("grep -- match /patterns.txt");
    expectResult(pattern, {
      stdout: "match\n",
      stderr: "",
      exitCode: 0,
    });

    const dashedPattern = await env.exec("grep -- -x /patterns.txt");
    expectResult(dashedPattern, {
      stdout: "-x\n",
      stderr: "",
      exitCode: 0,
    });

    const helpPattern = await env.exec("grep -- --help /patterns.txt");
    expectResult(helpPattern, {
      stdout: "--help\n",
      stderr: "",
      exitCode: 0,
    });

    const dashedFile = await env.exec("grep match -- -input.txt");
    expectResult(dashedFile, {
      stdout: "match\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("allows option-like values as option arguments", async () => {
    const env = new Bash({
      files: {
        "/patterns.txt": "--\nmatch\n",
      },
    });

    const result = await env.exec("grep -e -- /patterns.txt");
    expectResult(result, {
      stdout: "--\n",
      stderr: "",
      exitCode: 0,
    });

    const helpPattern = await env.exec("grep -e --help /patterns.txt");
    expectResult(helpPattern, {
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
  });
});
