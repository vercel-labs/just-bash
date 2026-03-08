import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { build } from "esbuild";

const WORKER_TS = resolve("src/commands/python3/worker.ts");
const WORKER_JS = resolve("src/commands/python3/worker.js");

function normalize(content) {
  return content.replace(/\r\n/g, "\n").trimEnd();
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function findFirstDiffLine(a, b) {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    if (aLines[i] !== bLines[i]) {
      return i + 1;
    }
  }
  return -1;
}

async function main() {
  let existingWorkerJs;
  try {
    existingWorkerJs = normalize(readFileSync(WORKER_JS, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[FAIL] Could not read ${WORKER_JS}: ${message}\nRun: pnpm build:worker`,
    );
    process.exit(1);
  }

  let generatedWorkerJs;
  try {
    const result = await build({
      entryPoints: [WORKER_TS],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      external: ["../../../vendor/cpython-emscripten/*"],
      logLevel: "silent",
    });
    generatedWorkerJs = normalize(result.outputFiles[0]?.text ?? "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[FAIL] Could not build ${WORKER_TS}: ${message}`);
    process.exit(1);
  }

  if (generatedWorkerJs !== existingWorkerJs) {
    const generatedHash = sha256(generatedWorkerJs);
    const existingHash = sha256(existingWorkerJs);
    const firstDiffLine = findFirstDiffLine(
      generatedWorkerJs,
      existingWorkerJs,
    );
    console.error(
      `[FAIL] src/commands/python3/worker.js is out of sync with worker.ts.\n` +
        `Generated hash: ${generatedHash}\n` +
        `Checked-in hash: ${existingHash}\n` +
        `First differing line: ${firstDiffLine}\n` +
        "Run: pnpm build:worker",
    );
    process.exit(1);
  }
}

await main();
