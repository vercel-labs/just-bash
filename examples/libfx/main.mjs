import { readFile } from "node:fs/promises";
import { Bash, defineWasmCommand } from "just-bash";

const apiKey = process.env.AI_GATEWAY_API_KEY;
if (!apiKey) throw new Error("Set AI_GATEWAY_API_KEY to run this example");

const wasmUrl = new URL("./fx-core.wasm", import.meta.resolve("libfx/wasm"));
const bash = new Bash({
  cwd: "/project",
  env: {
    AI_GATEWAY_API_KEY: apiKey,
    FX_MODEL: process.env.FX_MODEL || "google/gemini-2.5-flash-lite",
  },
  files: {
    "/project/notes.md":
      "# Release notes\n\nWASM commands now support pipes and virtual files.\n" +
      "Each invocation runs in a worker with a deadline and memory limits.\n" +
      "The runtime adds no third-party dependencies.\n",
  },
  executionLimits: { maxExecutionTimeMs: 120_000 },
  customCommands: [
    defineWasmCommand("fx", {
      wasm: new Uint8Array(await readFile(wasmUrl)),
      adapter: new URL("./fx-adapter.mjs", import.meta.url),
      timeoutMs: 120_000,
    }),
  ],
});

const script =
  'echo "Keep it under 50 words." | fx "Read notes.md and summarize the release." > summary.md && cat summary.md';
console.log(`$ ${script}`);
const result = await bash.exec(script);
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
process.exitCode = result.exitCode;
