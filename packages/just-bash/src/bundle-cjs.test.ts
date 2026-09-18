/**
 * The CJS entry point has no runtime coverage: the suite runs against the
 * source tree, so anything that only breaks under `--format=cjs` ships
 * unnoticed. These tests load `dist/bundle/index.cjs` in a child process, the
 * way a `require("just-bash")` consumer does.
 */

import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const bundlePath = resolve(__dirname, "../dist/bundle/index.cjs");

async function runInCjs(
  options: string,
  command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const script = `
    const { Bash } = require(${JSON.stringify(bundlePath)});
    (async () => {
      const bash = new Bash(${options});
      const result = await bash.exec(${JSON.stringify(command)});
      process.stdout.write(JSON.stringify(result));
    })().catch((error) => {
      process.stdout.write(JSON.stringify({ stdout: "", stderr: String(error && error.message), exitCode: -1 }));
    });
  `;

  const { stdout } = await execFileAsync("node", ["-e", script], {
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(stdout) as {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
}

describe("published CommonJS export", () => {
  it("runs a plain command", async () => {
    const result = await runInCjs("{}", "echo hello");

    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);
  });

  it("runs python3 — the worker path must resolve without import.meta", async () => {
    const result = await runInCjs(
      "{ python: true }",
      'python3 -c "print(1 + 1)"',
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("2\n");
    expect(result.exitCode).toBe(0);
  }, 60_000);
});
