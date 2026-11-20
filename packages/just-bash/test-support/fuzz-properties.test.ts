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
import {
  createFcOptions,
  createFuzzConfig,
} from "../src/security/fuzzing/config.js";
import { FuzzRunner } from "../src/security/fuzzing/runners/fuzz-runner.js";

const packageRoot = resolve(import.meta.dirname, "..");

it("derives reproducible seeds for distinct property names", () => {
  const config = createFuzzConfig({ seed: 123, numRuns: 1, verbose: false });
  const originalName = expect.getState().currentTestName;
  try {
    expect.setState({ currentTestName: "property one" });
    const first = createFcOptions(config).seed;
    expect.setState({ currentTestName: "property two" });
    const second = createFcOptions(config).seed;
    expect.setState({ currentTestName: "property one" });
    expect(createFcOptions(config).seed).toBe(first);
    expect(createFcOptions({ ...config, seed: 124 }).seed).not.toBe(first);
    expect(second).not.toBe(first);
    expect.setState({ currentTestName: undefined });
    expect(createFcOptions(config)).toStrictEqual({
      seed: 123,
      numRuns: 1,
      endOnFailure: true,
    });
  } finally {
    expect.setState({ currentTestName: originalName });
  }
});

it("does not generate inputs if the property record cannot be written", async () => {
  const directory = await mkdtemp(
    join(packageRoot, "test-support/.fuzz-crash-"),
  );
  try {
    vi.stubEnv("TEST_DIAGNOSTICS_DIR", directory);
    const config = createFuzzConfig({ scriptLogFile: "fuzz.log" });
    const runner = new FuzzRunner(config);
    config.logProperty = runner.logProperty;
    const [file] = await readdir(directory);
    await rm(join(directory, file));
    await mkdir(join(directory, file));
    const generate = vi.fn((value: number) => value);

    expect(() =>
      fc.sample(fc.integer().map(generate), createFcOptions(config)),
    ).toThrow("Fuzz diagnostic property write failed");
    expect(generate).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

it("records the active property before a worker dies during generation", async () => {
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
      import { it } from ${JSON.stringify(join(packageRoot, "node_modules/vitest/dist/index.js"))};
      import fc from ${JSON.stringify(join(packageRoot, "node_modules/fast-check/lib/esm/fast-check.js"))};
      import { createFcOptions, createFuzzConfig } from ${JSON.stringify(join(packageRoot, "src/security/fuzzing/config.js"))};
      import { FuzzRunner } from ${JSON.stringify(join(packageRoot, "src/security/fuzzing/runners/fuzz-runner.js"))};
      it('crashes while generating a value', () => {
        const config = createFuzzConfig({ scriptLogFile: 'fuzz-malformed.log', numRuns: 1, verbose: false });
        const runner = new FuzzRunner(config);
        config.logProperty = runner.logProperty;
        fc.assert(fc.property(fc.integer().map(() => {
          process.kill(process.pid, 'SIGKILL');
          return 0;
        }), () => true), createFcOptions(config));
      });
    `,
    );
    const failure = await promisify(execFile)(
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
          FUZZ_SEED: "123",
          TEST_DIAGNOSTICS_DIR: diagnostics,
        },
        timeout: 30_000,
        maxBuffer: 2 * 1024 * 1024,
      },
    ).then(
      () => {
        throw new Error("Expected the Vitest worker to crash");
      },
      (error: unknown) => {
        if (!(error instanceof Error)) throw error;
        return error as Error & {
          code: number;
          killed: boolean;
          stdout: string;
          stderr: string;
        };
      },
    );
    expect(failure).toMatchObject({ code: 1, killed: false });
    expect(failure.stdout + failure.stderr).toContain(
      "Worker exited unexpectedly",
    );

    const files = await readdir(diagnostics);
    expect(files).toHaveLength(1);
    const entries = (await readFile(join(diagnostics, files[0]), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as unknown);
    const originalName = expect.getState().currentTestName;
    try {
      expect.setState({ currentTestName: "crashes while generating a value" });
      const seed = createFcOptions(createFuzzConfig({ seed: 123 })).seed;
      expect(entries).toStrictEqual([
        { type: "metadata", seed: 123 },
        { type: "property", name: "crashes while generating a value", seed },
      ]);
    } finally {
      expect.setState({ currentTestName: originalName });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 70_000);
