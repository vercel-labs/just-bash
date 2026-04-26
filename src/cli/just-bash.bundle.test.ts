import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const binPath = resolve(__dirname, "../../dist/bin/just-bash.js");

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

describe("just-bash bundled binary", () => {
  it("should show version", async () => {
    const result = await runBin(["--version"]);
    expect(result.stdout).toContain("just-bash");
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

  it("should lazy-load commands (sqlite3 with external sql.js)", async () => {
    const result = await runBin([
      "-c",
      'sqlite3 :memory: "SELECT 1 + 2 AS result"',
    ]);
    expect(result.stdout).toBe("3\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should lazy-load commands (python3 with CPython Emscripten)", async () => {
    const result = await runBin([
      "--python",
      "-c",
      'python3 -c "print(1 + 2)"',
    ]);
    expect(result.stdout).toBe("3\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  }, 60000); // 60s timeout for first WASM load

  // Regression test for https://github.com/vercel-labs/just-bash/issues/194:
  // both python3 and js-exec workers shipped as `worker.js` in the bundle, so
  // js-exec loaded the python worker and every invocation timed out. If this
  // ever regresses, js-exec hangs at runtime instead of failing fast.
  it("should lazy-load commands (js-exec with QuickJS via worker_threads)", async () => {
    const result = await runBin([
      "--javascript",
      "-c",
      `js-exec -c "console.log(1 + 2)"`,
    ]);
    expect(result.stdout).toBe("3\n");
    expect(result.exitCode).toBe(0);
  }, 30000);
});

// Static guard against the exact filename collision in issue #194: the
// bundled chunk for js-exec must reference its own worker file, not the
// python3 worker. This catches the bug at build time without spinning up
// a worker thread.
describe("just-bash bundled worker layout", () => {
  const chunksDir = resolve(__dirname, "../../dist/bundle/chunks");

  it("ships distinct worker files for python3 and js-exec", () => {
    expect(existsSync(resolve(chunksDir, "worker.js"))).toBe(true);
    expect(existsSync(resolve(chunksDir, "js-exec-worker.js"))).toBe(true);
  });

  it("js-exec chunk references ./js-exec-worker.js (not the shared ./worker.js)", () => {
    const jsExecChunks = readdirSync(chunksDir).filter((name) =>
      /^js-exec-[A-Z0-9]+\.js$/.test(name),
    );
    expect(jsExecChunks.length).toBeGreaterThan(0);

    const offending: string[] = [];
    let foundCorrectRef = false;
    for (const name of jsExecChunks) {
      const src = readFileSync(resolve(chunksDir, name), "utf8");
      if (src.includes(`new URL("./js-exec-worker.js"`)) {
        foundCorrectRef = true;
      }
      // Any js-exec chunk that references the bare ./worker.js URL would
      // load the python worker at runtime — that's the issue #194 bug.
      if (src.includes(`new URL("./worker.js"`)) {
        offending.push(name);
      }
    }
    expect(offending).toEqual([]);
    expect(foundCorrectRef).toBe(true);
  });
});

describe("just-bash CJS bundle", () => {
  it("should be requireable and execute basic commands", async () => {
    const cjsBundlePath = resolve(__dirname, "../../dist/bundle/index.cjs");
    const require = createRequire(import.meta.url);
    const mod = require(cjsBundlePath);
    expect(mod.Bash).toBeDefined();
    const bash = new mod.Bash();
    const result = await bash.exec("echo hello from cjs");
    expect(result.stdout).toBe("hello from cjs\n");
    expect(result.exitCode).toBe(0);
  });
});
