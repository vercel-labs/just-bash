import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function runIsolatedDistScenario<T>(scenario: string): T {
  const isolatedRoot = mkdtempSync(join(repoRoot, ".tmp-rwfs-overlap-guard-"));

  try {
    cpSync(join(repoRoot, "dist"), join(isolatedRoot, "dist"), {
      recursive: true,
    });

    const childScript = `
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Bash } from "./dist/Bash.js";
import { ReadWriteFs } from "./dist/fs/read-write-fs/read-write-fs.js";

const root = process.cwd();

${scenario}
`;
    const childScriptPath = join(isolatedRoot, "scenario.mjs");
    writeFileSync(childScriptPath, childScript);

    const child = spawnSync(process.execPath, [childScriptPath], {
      cwd: isolatedRoot,
      encoding: "utf8",
      timeout: 30000,
    });

    if (child.status !== 0) {
      throw new Error(
        [
          "isolated ReadWriteFs guardrail child failed",
          `status=${String(child.status)}`,
          `stdout=${child.stdout}`,
          `stderr=${child.stderr}`,
        ].join("\n"),
      );
    }

    return JSON.parse(child.stdout.trim()) as T;
  } finally {
    rmSync(isolatedRoot, { recursive: true, force: true });
  }
}

describe("ReadWriteFs unsafe embedding guardrail", () => {
  it("rejects roots that overlap the just-bash installation", () => {
    const output = runIsolatedDistScenario<{ error: string }>(`
let error = "";

try {
  new Bash({
    fs: new ReadWriteFs({ root }),
    cwd: "/",
  });
} catch (e) {
  error = e instanceof Error ? e.message : String(e);
}

console.log(JSON.stringify({ error }));
`);

    expect(output.error).toBe(
      "ReadWriteFs root overlaps the just-bash installation; choose a writable root outside the package/runtime tree",
    );
  });

  it("still allows writable roots outside the package/runtime tree", () => {
    const output = runIsolatedDistScenario<{
      result: { stdout: string; stderr: string; exitCode: number };
    }>(`
const workspaceRoot = join(root, "workspace");
mkdirSync(workspaceRoot);

const env = new Bash({
  fs: new ReadWriteFs({ root: workspaceRoot }),
  cwd: "/",
});
const result = await env.exec("echo safe-root");

console.log(JSON.stringify({ result }));
`);

    expect(output.result.stdout).toBe("safe-root\n");
    expect(output.result.stderr).toBe("");
    expect(output.result.exitCode).toBe(0);
  });
});
