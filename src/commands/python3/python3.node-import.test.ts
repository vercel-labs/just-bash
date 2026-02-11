import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(__dirname, "../../../dist/bin/just-bash.js");

function withSourceMapsEnabled(): NodeJS.ProcessEnv {
  const existingNodeOptions = process.env.NODE_OPTIONS?.trim();
  const nodeOptions = existingNodeOptions
    ? `${existingNodeOptions} --enable-source-maps`
    : "--enable-source-maps";

  return {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  };
}

async function runNode(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const { stdout, stderr } = await execFileAsync("node", args, { env });
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

describe("python3 node import behavior", () => {
  it(
    "should execute python3 through just-bash with source maps enabled",
    { timeout: 60000 },
    async () => {
      const sourceMapEnv = withSourceMapsEnabled();
      const result = await runNode(
        [binPath, "--python", "-c", 'python3 -c "print(1 + 2)"'],
        sourceMapEnv,
      );

      expect(result.stdout).toBe("3\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    },
  );
});
