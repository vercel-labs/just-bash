import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import fc from "fast-check";
import { expect, it, vi } from "vitest";
import { Bash } from "../src/Bash.js";
import {
  createFcOptions,
  createFuzzConfig,
} from "../src/security/fuzzing/config.js";
import { FuzzRunner } from "../src/security/fuzzing/runners/fuzz-runner.js";

const execute = promisify(execFile);
const packageRoot = resolve(import.meta.dirname, "..");
const script = "printf '%s' '\"quoted\"\n\t\u0000雪😀'";

type DiagnosticRecord = {
  type?: string;
  event?: string;
  caseId?: number;
  errors?: unknown[];
  memory?: NodeJS.MemoryUsage;
  [key: string]: unknown;
};

async function records(directory: string) {
  const files = await readdir(directory);
  return Promise.all(
    files.map(async (file) => ({
      file,
      entries: (await readFile(join(directory, file), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as DiagnosticRecord),
    })),
  );
}

async function runFixture(config: string, diagnostics: string, crash: boolean) {
  try {
    const completed = await execute(
      process.execPath,
      [
        join(packageRoot, "node_modules/vitest/vitest.mjs"),
        "run",
        "--config",
        config,
      ],
      {
        cwd: packageRoot,
        env: {
          ...process.env,
          TEST_DIAGNOSTICS_DIR: diagnostics,
          FUZZ_SEED: "0",
          FUZZ_FIXTURE_CRASH: String(crash),
        },
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    );
    return { exitCode: 0, output: completed.stdout + completed.stderr };
  } catch (error) {
    const failure = error as Error & {
      code: number;
      stdout: string;
      stderr: string;
      killed: boolean;
    };
    // Nonzero Vitest exits are evidence; timeouts and spawn failures are fixture errors.
    if (typeof failure.code !== "number" || failure.killed) throw error;
    return { exitCode: failure.code, output: failure.stdout + failure.stderr };
  }
}

it("preserves seeds and exact inputs across independent completed runners", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fuzz-diagnostics-"));
  try {
    for (const seed of [0, -2147483648, 2147483647]) {
      vi.stubEnv("FUZZ_SEED", String(seed));
      const config = createFuzzConfig({ numRuns: 1, verbose: false });
      const result = fc.check(
        fc.property(fc.constant(true), (value) => value),
        createFcOptions(config),
      );
      expect(result.seed).toBe(seed);
    }
    for (const seed of [
      "",
      "1.5",
      "2147483648",
      "-2147483649",
      "abc",
      " 0",
      "1e2",
    ]) {
      vi.stubEnv("FUZZ_SEED", seed);
      expect(() => createFuzzConfig()).toThrow(
        "FUZZ_SEED must be a signed 32-bit decimal integer",
      );
    }
    vi.stubEnv("FUZZ_SEED", "0");
    vi.stubEnv("TEST_DIAGNOSTICS_DIR", directory);
    const config = createFuzzConfig({
      scriptLogFile: "roundtrip",
      failureLogFile: "assertions",
      numRuns: 1,
      verbose: false,
    });
    const runners = [new FuzzRunner(config), new FuzzRunner(config)];
    const results = await Promise.all(
      runners.map((runner) => runner.run(script, "serialization")),
    );
    const logs = await records(directory);
    expect(logs).toHaveLength(2);
    for (const { entries } of logs) {
      expect(entries.map((entry) => entry.type)).toStrictEqual([
        "metadata",
        "start",
        "end",
      ]);
      expect(entries[1].script).toBe(script);
      expect(entries[2].caseId).toBe(entries[1].caseId);
      for (const entry of entries.slice(1)) {
        assert.ok(entry.memory);
        for (const field of [
          "heapUsed",
          "rss",
          "external",
          "arrayBuffers",
        ] as const) {
          expect(entry.memory[field]).toEqual(expect.any(Number));
        }
      }
    }
    await runners[0].logFailure(results[0], "assertion evidence");
    const updated = await records(directory);
    const failure = updated
      .flatMap((log) => log.entries)
      .find((entry) => entry.type === "assertion-failure");
    expect(failure).toMatchObject({
      caseId: 1,
      reason: "assertion evidence",
      script,
    });
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

it("prevents execution when enabled diagnostics cannot persist a start", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fuzz-diagnostics-"));
  const execution = vi.spyOn(Bash.prototype, "exec");
  try {
    const invalid = join(directory, "not-a-directory");
    await writeFile(invalid, "file");
    vi.stubEnv("TEST_DIAGNOSTICS_DIR", invalid);
    const runner = new FuzzRunner({ scriptLogFile: "failure", verbose: false });
    await expect(runner.run("echo harmless", "io-failure")).rejects.toThrow(
      "Fuzz diagnostic start write failed",
    );
    expect(execution).not.toHaveBeenCalled();
    vi.stubEnv("TEST_DIAGNOSTICS_DIR", directory);
    const runnerWithEndFailure = new FuzzRunner({
      scriptLogFile: "end-failure",
      verbose: false,
    });
    const original = new Error("original execution failure");
    execution.mockImplementation(async () => {
      const file = runnerWithEndFailure.getDiagnosticsPath();
      assert.ok(file);
      await rm(file);
      // A directory at the append destination forces completion logging to fail.
      await mkdir(file);
      throw original;
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const result = await runnerWithEndFailure.run(
        "echo harmless",
        "end-io-failure",
      );
      expect(result.error).toBe(original);
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("Fuzz diagnostic completion write failed"),
      );
    } finally {
      consoleError.mockRestore();
    }
  } finally {
    execution.mockRestore();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

it("preserves parent and exact-input records after an abruptly terminated worker", async () => {
  const directory = await mkdtemp(
    join(packageRoot, "test-support/.fuzz-crash-"),
  );
  try {
    const fixture = join(directory, "fixture.ts");
    const config = join(directory, "vitest.config.ts");
    const diagnostics = join(directory, "diagnostics");
    await writeFile(
      config,
      `
      import config from ${JSON.stringify(join(packageRoot, "vitest.unit.config.ts"))};
      export default { ...config, test: { ...config.test, root: ${JSON.stringify(packageRoot)},
        include: [${JSON.stringify(fixture)}], pool: 'forks', maxWorkers: 1 } };
    `,
    );
    await writeFile(
      fixture,
      `
      import { it, expect, vi } from ${JSON.stringify(join(packageRoot, "node_modules/vitest/dist/index.js"))};
      import { readFile } from 'node:fs/promises';
      import { Bash } from ${JSON.stringify(join(packageRoot, "src/Bash.js"))};
      import { FuzzRunner } from ${JSON.stringify(join(packageRoot, "src/security/fuzzing/runners/fuzz-runner.js"))};
      it('persists before execution then crashes', async () => {
        const runner = new FuzzRunner({ scriptLogFile: 'crash-fixture', seed: 0, numRuns: 1, verbose: false });
        await runner.run('echo completed', 'completed');
        if (process.env.FUZZ_FIXTURE_CRASH !== 'true') return;
        const execution = vi.spyOn(Bash.prototype, 'exec').mockImplementation(async (input) => {
          const entries = (await readFile(runner.getDiagnosticsPath(), 'utf8')).trim().split('\\n').map(JSON.parse);
          expect(entries.at(-1).type).toBe('start');
          expect(entries.at(-1).script).toBe(input);
          process.kill(process.pid, 'SIGKILL');
          await new Promise(() => {});
        });
        await runner.run(${JSON.stringify(script)}, 'terminated');
        expect(execution).toHaveBeenCalled();
      });
    `,
    );
    const successDirectory = join(directory, "success");
    const success = await runFixture(config, successDirectory, false);
    expect(success.exitCode, success.output).toBe(0);
    const successLogs = await records(successDirectory);
    const successfulParent = successLogs.find((log) =>
      log.file.startsWith("vitest-"),
    );
    assert.ok(successfulParent);
    expect(successfulParent.entries.at(-1)).toMatchObject({
      event: "run-end",
      reason: "passed",
      unfinishedModules: [],
      unfinishedTests: [],
      errors: [],
    });
    const { exitCode, output } = await runFixture(config, diagnostics, true);
    expect(exitCode, output).not.toBe(0);
    expect(output).toContain("Worker exited unexpectedly");
    const logs = await records(diagnostics);
    const fuzzLog = logs.find((log) => log.file.startsWith("crash-fixture"));
    assert.ok(fuzzLog);
    const fuzz = fuzzLog.entries;
    expect(fuzz[0]).toMatchObject({
      type: "metadata",
      seed: 0,
      nodeVersion: process.version,
      pid: expect.any(Number),
    });
    expect(fuzz.map((entry) => entry.type)).toStrictEqual([
      "metadata",
      "start",
      "end",
      "start",
    ]);
    expect(fuzz[3]).toMatchObject({ script, label: "terminated" });
    expect(fuzz[2]).toMatchObject({
      completed: true,
      status: "OK",
      exitCode: 0,
    });
    const parentLog = logs.find((log) => log.file.startsWith("vitest-"));
    assert.ok(parentLog);
    const parent = parentLog.entries;
    expect(parent[0].event).toBe("run-start");
    const end = parent.find((entry) => entry.event === "run-end");
    assert.ok(end?.errors);
    expect(end.errors.length).toBeGreaterThan(0);
    expect(end.unfinishedStatus).toBe("started without a reported completion");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 70_000);
