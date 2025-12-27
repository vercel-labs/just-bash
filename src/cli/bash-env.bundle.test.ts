import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(__dirname, "../../dist/bin/bash-env.js");

async function runBin(
  args: string[],
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", [binPath, ...args]);
    return { stdout, stderr, exitCode: 0 };
  } catch (error: unknown) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      exitCode: e.code ?? 1,
    };
  }
}

describe("bash-env bundled binary", () => {
  it("should show version", async () => {
    const result = await runBin(["--version"]);
    expect(result.stdout).toContain("bash-env");
    expect(result.exitCode).toBe(0);
  });

  it("should show help", async () => {
    const result = await runBin(["--help"]);
    expect(result.stdout).toContain("Usage:");
    expect(result.exitCode).toBe(0);
  });

  it("should execute echo command", async () => {
    const result = await runBin(["-c", "echo hello world"]);
    expect(result.stdout).toBe("hello world\n");
    expect(result.exitCode).toBe(0);
  });

  it("should execute pipes", async () => {
    const result = await runBin(["-c", 'echo "line1\nline2\nline3" | wc -l']);
    expect(result.stdout.trim()).toBe("3");
    expect(result.exitCode).toBe(0);
  });

  it("should handle file operations with --allow-write", async () => {
    const result = await runBin([
      "-c",
      'echo "test" > /tmp/test.txt && cat /tmp/test.txt',
      "--allow-write",
    ]);
    expect(result.stdout).toBe("test\n");
    expect(result.exitCode).toBe(0);
  });

  it("should support JSON output", async () => {
    const result = await runBin(["-c", "echo hello", "--json"]);
    const json = JSON.parse(result.stdout);
    expect(json.stdout).toBe("hello\n");
    expect(json.stderr).toBe("");
    expect(json.exitCode).toBe(0);
  });

  it("should lazy-load commands (grep)", async () => {
    const result = await runBin([
      "-c",
      'echo -e "foo\\nbar\\nbaz" | grep ba',
      "--allow-write",
    ]);
    expect(result.stdout).toContain("bar");
    expect(result.stdout).toContain("baz");
    expect(result.exitCode).toBe(0);
  });

  it("should lazy-load commands (sed)", async () => {
    const result = await runBin(["-c", "echo hello | sed 's/hello/world/'"]);
    expect(result.stdout).toBe("world\n");
    expect(result.exitCode).toBe(0);
  });

  it("should lazy-load commands (awk)", async () => {
    const result = await runBin(["-c", "echo 'a b c' | awk '{print $2}'"]);
    expect(result.stdout).toBe("b\n");
    expect(result.exitCode).toBe(0);
  });

  it("should handle errexit mode", async () => {
    const result = await runBin(["-e", "-c", "false; echo should not print"]);
    expect(result.stdout).not.toContain("should not print");
    expect(result.exitCode).toBe(1);
  });
});
