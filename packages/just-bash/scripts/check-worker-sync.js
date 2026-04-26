import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { build } from "esbuild";

const WORKERS = [
  {
    name: "python3",
    ts: "src/commands/python3/worker.ts",
    js: "src/commands/python3/worker.js",
    external: ["../../../vendor/cpython-emscripten/*"],
  },
  {
    name: "js-exec",
    ts: "src/commands/js-exec/js-exec-worker.ts",
    js: "src/commands/js-exec/js-exec-worker.js",
    external: ["quickjs-emscripten"],
  },
];

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
  let failed = false;

  for (const worker of WORKERS) {
    const tsPath = resolve(worker.ts);
    const jsPath = resolve(worker.js);

    let existingWorkerJs;
    try {
      existingWorkerJs = normalize(readFileSync(jsPath, "utf8"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[FAIL] Could not read ${jsPath}: ${message}\nRun: pnpm build:worker`,
      );
      failed = true;
      continue;
    }

    let generatedWorkerJs;
    try {
      const result = await build({
        entryPoints: [tsPath],
        bundle: true,
        platform: "node",
        format: "esm",
        write: false,
        external: worker.external,
        logLevel: "silent",
      });
      generatedWorkerJs = normalize(result.outputFiles[0]?.text ?? "");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[FAIL] Could not build ${tsPath}: ${message}`);
      failed = true;
      continue;
    }

    if (generatedWorkerJs !== existingWorkerJs) {
      const generatedHash = sha256(generatedWorkerJs);
      const existingHash = sha256(existingWorkerJs);
      const firstDiffLine = findFirstDiffLine(
        generatedWorkerJs,
        existingWorkerJs,
      );
      console.error(
        `[FAIL] ${worker.js} is out of sync with ${worker.ts}.\n` +
          `Generated hash: ${generatedHash}\n` +
          `Checked-in hash: ${existingHash}\n` +
          `First differing line: ${firstDiffLine}\n` +
          "Run: pnpm build:worker",
      );
      failed = true;
    }
  }

  if (failed) {
    process.exit(1);
  }
}

await main();
