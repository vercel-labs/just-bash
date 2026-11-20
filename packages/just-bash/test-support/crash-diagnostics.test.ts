import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
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
const fixturePrefix = join(packageRoot, "test-support/.fuzz-crash-");
const script = "printf '%s' '\"quoted\"\n\t\u0000雪😀\\\ud800'";

async function records(directory: string) {
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith(".jsonl"),
  );
  return Promise.all(
    files.map(async (file) => ({
      file,
      entries: (await readFile(join(directory, file), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown),
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
          FUZZ_FIXTURE_SECRET: "environment-only value",
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

it("accepts, records, and replays signed 32-bit seeds", async () => {
  const directory = await mkdtemp(fixturePrefix);
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

    vi.stubEnv("FUZZ_SEED", undefined);
    vi.stubEnv("TEST_DIAGNOSTICS_DIR", directory);
    const generated = createFuzzConfig({
      scriptLogFile: "fuzz-coverage.log",
      numRuns: 10,
      verbose: false,
    });
    expect(Number.isInteger(generated.seed)).toBe(true);
    new FuzzRunner(generated);
    expect((await records(directory))[0].entries).toStrictEqual([
      { type: "metadata", seed: generated.seed },
    ]);
    vi.stubEnv("FUZZ_SEED", String(generated.seed));
    const replay = createFuzzConfig({ numRuns: 10, verbose: false });
    expect(fc.sample(fc.integer(), createFcOptions(replay))).toStrictEqual(
      fc.sample(fc.integer(), createFcOptions(generated)),
    );
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

it("records ordered exact inputs without outputs or failure details", async () => {
  const directory = await mkdtemp(fixturePrefix);
  const execution = vi
    .spyOn(Bash.prototype, "exec")
    .mockImplementation(async (input) => {
      if (input === "echo second") throw new Error("private execution error");
      return {
        stdout: "private stdout",
        stderr: "private stderr",
        exitCode: 1,
        env: { SECRET: "environment-only value" },
        metadata: { detail: "private metadata" },
      };
    });
  try {
    vi.stubEnv("FUZZ_SEED", "0");
    vi.stubEnv("TEST_DIAGNOSTICS_DIR", directory);
    vi.stubEnv("FUZZ_FIXTURE_SECRET", "environment-only value");
    const failureLogFile = join(directory, "fuzz-malformed-failures.log");
    const config = createFuzzConfig({
      scriptLogFile: "fuzz-malformed.log",
      failureLogFile,
      numRuns: 1,
      verbose: false,
    });
    const runners = [new FuzzRunner(config), new FuzzRunner(config)];
    const results = await Promise.all(
      runners.map(async (runner) => {
        const first = await runner.run(script);
        await runner.run("echo second");
        return first;
      }),
    );
    runners[0].logFailure(results[0], "private failure reason");

    const logs = await records(directory);
    expect(logs).toHaveLength(2);
    expect(new Set(logs.map((log) => log.file)).size).toBe(2);
    for (const { file, entries } of logs) {
      expect(file).toMatch(/^fuzz-malformed\.log-.*\.jsonl$/);
      expect(entries).toStrictEqual([
        { type: "metadata", seed: 0 },
        { type: "start", caseId: 1, script },
        { type: "end", caseId: 1 },
        { type: "start", caseId: 2, script: "echo second" },
        { type: "end", caseId: 2 },
      ]);
    }
    const failure = await readFile(failureLogFile, "utf8");
    expect(failure).toContain("private failure reason");
    expect(failure).toContain("private stdout");
    expect(failure).toContain("private stderr");
  } finally {
    execution.mockRestore();
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

it("handles diagnostic write failures without hiding execution failures", async () => {
  const directory = await mkdtemp(fixturePrefix);
  const execution = vi.spyOn(Bash.prototype, "exec");
  try {
    const startDirectory = join(directory, "start");
    vi.stubEnv("TEST_DIAGNOSTICS_DIR", startDirectory);
    const runner = new FuzzRunner({ scriptLogFile: "start", verbose: false });
    const [startFile] = await readdir(startDirectory);
    await rm(join(startDirectory, startFile));
    await mkdir(join(startDirectory, startFile));
    await expect(runner.run("echo harmless")).rejects.toThrow(
      "Fuzz diagnostic start write failed",
    );
    expect(execution).not.toHaveBeenCalled();

    const endDirectory = join(directory, "end");
    vi.stubEnv("TEST_DIAGNOSTICS_DIR", endDirectory);
    const runnerWithEndFailure = new FuzzRunner({
      scriptLogFile: "end",
      verbose: false,
    });
    const [endFile] = await readdir(endDirectory);
    const original = new Error("original execution failure");
    execution.mockImplementation(async () => {
      await rm(join(endDirectory, endFile));
      await mkdir(join(endDirectory, endFile));
      throw original;
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      const result = await runnerWithEndFailure.run("echo harmless");
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

it("preserves the last input when a Vitest worker is killed", async () => {
  const directory = await mkdtemp(fixturePrefix);
  try {
    const fixture = join(directory, "fixture.test.ts");
    const config = join(directory, "vitest.config.ts");
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
      import { readdir, readFile } from 'node:fs/promises';
      import { join } from 'node:path';
      import { Bash } from ${JSON.stringify(join(packageRoot, "src/Bash.js"))};
      import { FuzzRunner } from ${JSON.stringify(join(packageRoot, "src/security/fuzzing/runners/fuzz-runner.js"))};
      it('persists before execution then crashes', async () => {
        const runner = new FuzzRunner({ scriptLogFile: 'fuzz-malformed.log', numRuns: 1, verbose: false });
        await runner.run('echo completed');
        if (process.env.FUZZ_FIXTURE_CRASH !== 'true') return;
        vi.spyOn(Bash.prototype, 'exec').mockImplementation(async (input) => {
          const directory = process.env.TEST_DIAGNOSTICS_DIR!;
          const files = await readdir(directory);
          expect(files).toHaveLength(1);
          const entries = (await readFile(join(directory, files[0]), 'utf8')).trim().split('\\n').map(JSON.parse);
          expect(entries.at(-1)).toStrictEqual({ type: 'start', caseId: 2, script: input });
          process.kill(process.pid, 'SIGKILL');
          await new Promise(() => {});
        });
        await runner.run(${JSON.stringify(script)});
      });
    `,
    );
    const successDirectory = join(directory, "success");
    const success = await runFixture(config, successDirectory, false);
    expect(success.exitCode, success.output).toBe(0);
    const successLogs = await records(successDirectory);
    expect(successLogs).toHaveLength(1);
    expect(successLogs[0].entries).toStrictEqual([
      { type: "metadata", seed: 0 },
      { type: "start", caseId: 1, script: "echo completed" },
      { type: "end", caseId: 1 },
    ]);

    const diagnostics = join(directory, "crash");
    const { exitCode, output } = await runFixture(config, diagnostics, true);
    expect(exitCode, output).not.toBe(0);
    expect(output).toContain("Worker exited unexpectedly");
    const logs = await records(diagnostics);
    expect(logs).toHaveLength(1);
    expect(logs[0].entries).toStrictEqual([
      { type: "metadata", seed: 0 },
      { type: "start", caseId: 1, script: "echo completed" },
      { type: "end", caseId: 1 },
      { type: "start", caseId: 2, script },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 70_000);
