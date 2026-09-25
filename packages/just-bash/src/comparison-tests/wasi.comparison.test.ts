import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeEach, describe, it } from "vitest";
import type { Bash } from "../Bash.js";
import { defineWasiCommand } from "../wasm/index.js";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  isRecordMode,
  setupFiles,
  writeAllFixtures,
} from "./fixture-runner.js";

const compile = promisify(execFile);
const source = new URL("../wasm/wasi/fixtures/command.c", import.meta.url);
const wasm = new Uint8Array(
  await readFile(
    new URL("../wasm/wasi/fixtures/command.wasm", import.meta.url),
  ),
);

describe("WASI CLI compared with the same C program compiled natively", () => {
  let directory: string;
  let shell: Bash;
  beforeEach(async () => {
    directory = await createTestDir();
    shell = await setupFiles(directory, {
      "input.txt": "hello café\nsecond line\n",
    });
    shell.registerCommand(defineWasiCommand("wasi-fixture", { wasm }));
    if (isRecordMode)
      await compile("cc", [
        "-O2",
        fileURLToPath(source),
        "-o",
        join(directory, "wasi-fixture"),
      ]);
  });
  afterEach(async () => {
    await cleanupTestDir(directory);
  });
  afterAll(writeAllFixtures);

  it.each([
    "wasi-fixture args 'two words' '$(echo literal)' café",
    'wasi-fixture cat "$PWD/input.txt" | grep café',
    'wasi-fixture write "$PWD/result" first; wasi-fixture append "$PWD/result" second; cat result',
    "wasi-fixture fs",
    "wasi-fixture binary > bytes; base64 < bytes",
    "wasi-fixture exit 42",
  ])("matches native execution: %s", async (command) => {
    await compareOutputs(
      shell,
      directory,
      `export PATH="$PWD:$PATH"; ${command}`,
    );
  });
});
