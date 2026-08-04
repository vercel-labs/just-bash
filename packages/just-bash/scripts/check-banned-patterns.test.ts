import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runScanner } from "./check-banned-patterns.js";

const scriptPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "check-banned-patterns.js",
);
const cleanup: string[] = [];

function tempDirectory(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

function runScannerCli(cwd: string) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("check-banned-patterns filesystem boundary", () => {
  it("rejects an external file symlink without reading its contents", () => {
    const root = tempDirectory("just-bash-lint-root-");
    const outside = tempDirectory("just-bash-lint-outside-");
    const secret = "EXTERNAL_SECRET_CANARY";
    writeFileSync(join(outside, "secret.ts"), `${secret}\nconst bad = {};\n`);
    symlinkSync(join(outside, "secret.ts"), join(root, "linked.ts"));

    const result = runScannerCli(root);

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("linked.ts: symbolic link rejected");
    expect(result.stderr).toContain("Incomplete security scan");
    expect(result.stderr).not.toContain(secret);
  });

  it("continues scanning after an entry error and reports later violations", () => {
    const root = tempDirectory("just-bash-lint-errors-");
    mkdirSync(join(root, "src"));
    symlinkSync(join(root, "missing.ts"), join(root, "src", "a-broken.ts"));
    writeFileSync(join(root, "src", "z-bad.ts"), "const unsafe = {};\n");

    const result = runScannerCli(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("src/a-broken.ts: symbolic link rejected");
    expect(result.stderr).toContain("Banned Code Patterns Detected");
    expect(result.stderr).toContain("src/z-bad.ts:1");
    expect(result.stderr).not.toContain("No banned patterns detected");
  });

  it("succeeds only after a complete clean scan", () => {
    const root = tempDirectory("just-bash-lint-clean-");
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "safe.ts"), "const safe = new Map();\n");

    const result = runScannerCli(root);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("No banned patterns detected");
  });

  it("accepts a legitimate path segment beginning with two dots", () => {
    const root = tempDirectory("just-bash-lint-dot-name-");
    writeFileSync(join(root, "..safe.ts"), "const safe = new Map();\n");

    const result = runScanner(root, { report: false });

    expect(result.hasErrors).toBe(false);
    expect(result.scanErrors).toEqual([]);
  });

  it("does not scan generated finding and planning inputs", () => {
    const root = tempDirectory("just-bash-lint-inputs-");
    mkdirSync(join(root, ".deepsec"));
    mkdirSync(join(root, "todo"));
    writeFileSync(join(root, ".deepsec", "finding.ts"), "const bad = {};\n");
    writeFileSync(join(root, "todo", "plan.ts"), "const bad = {};\n");
    writeFileSync(join(root, "safe.ts"), "const safe = new Map();\n");

    expect(runScanner(root, { report: false }).hasErrors).toBe(false);
  });

  it("resets findings and visited-directory state for every invocation", () => {
    const badRoot = tempDirectory("just-bash-lint-reset-bad-");
    const goodRoot = tempDirectory("just-bash-lint-reset-good-");
    writeFileSync(join(badRoot, "bad.ts"), "const unsafe = {};\n");
    writeFileSync(join(goodRoot, "good.ts"), "const safe = new Map();\n");

    const first = runScanner(badRoot, { report: false });
    const second = runScanner(goodRoot, { report: false });

    expect(first.violations).toHaveLength(1);
    expect(second.hasErrors).toBe(false);
    expect(second.violations).toEqual([]);
  });

  it.each([
    [
      "non-portable abort composition",
      "src/runtime.ts",
      "const signal = AbortSignal.any(signals);\n",
      "Non-portable AbortSignal composition",
    ],
    [
      "stack-based authorization",
      "src/security/gate.ts",
      'const trusted = errorStack.includes("node:internal/modules/cjs/loader");\n',
      "Stack text used as a security decision",
    ],
    [
      "fresh nested execution engines",
      "src/interpreter/nested.ts",
      "const interpreter = new Interpreter(options, state);\n",
      "Execution engine constructed outside Bash",
    ],
  ])("rejects %s", (_name, relativePath, source, violationName) => {
    const root = tempDirectory("just-bash-lint-rule-");
    const fullPath = join(root, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, source);

    const result = runScannerCli(root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(violationName);
  });

  it.each([
    [
      "forgeable security diagnostics",
      "src/security/gate.ts",
      'const trusted = error.message.includes("trusted loader");\n',
      "Forgeable diagnostic used as a security decision",
    ],
    [
      "optional local limit defaults",
      "src/commands/example.ts",
      "const max = ctx.limits?.maxOutputSize ?? 1024;\n",
      "Optional command limit with literal fallback",
    ],
    [
      "raw secured fetch",
      "src/network/fetch.ts",
      "const response = fetch(currentUrl, options);\n",
      "Raw fetch in secured network path",
    ],
    [
      "whole-buffer decompression",
      "src/commands/archive.ts",
      "const output = gunzipSync(input);\n",
      "Whole-buffer decompression outside codec boundary",
    ],
    [
      "host filesystem imports in commands",
      "src/commands/unsafe.ts",
      'import { readFile } from "node:fs/promises";\n',
      "Restricted Node filesystem import",
    ],
    [
      "raw path-prefix containment",
      "src/fs/containment.ts",
      'const inside = !relative.startsWith("..");\n',
      "Unsafe path-prefix containment",
    ],
    [
      "dynamic string amplification",
      "src/commands/example.ts",
      'const output = "x".repeat(width);\n',
      "Unchecked dynamic string or array amplification",
    ],
    [
      "array-join amplification",
      "src/commands/example.ts",
      'const output = Array(count).fill("x").join("");\n',
      "Unchecked array construction followed by join",
    ],
    [
      "allocating byte measurement",
      "src/commands/example.ts",
      "const bytes = new TextEncoder().encode(input).length;\n",
      "Allocating UTF-8 byte-length measurement",
    ],
    [
      "unbounded interpreter output",
      "src/interpreter/interpreter.ts",
      "stdout += result.stdout;\n",
      "Unbounded interpreter output accumulation",
    ],
    [
      "fatal catch swallowing",
      "src/commands/example.ts",
      "try { run(); } catch (error) { return fallback; }\n",
      "Fatal execution error swallowed by catch",
    ],
    [
      "raw filesystem error returns",
      "src/fs/adapter.ts",
      "return { error: error.message };\n",
      "Raw filesystem error returned from adapter",
    ],
    [
      "workers without request controller",
      "src/commands/example.ts",
      "const worker = new Worker(path);\n",
      "Worker created without shared request controller",
    ],
    [
      "command-local maximums",
      "src/commands/example.ts",
      "const MAX_ROWS = 1234;\n",
      "Undocumented command-local MAX constant",
    ],
  ])("rejects %s", (_name, relativePath, source, violationName) => {
    const root = tempDirectory("just-bash-lint-policy-");
    const fullPath = join(root, relativePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, source);

    const result = runScanner(root, { report: false });

    expect(result.violations.map((item) => item.pattern.name)).toContain(
      violationName,
    );
  });

  it("accepts reviewed gates and shared worker controller adoption", () => {
    const root = tempDirectory("just-bash-lint-approved-");
    mkdirSync(join(root, "src", "fs"), { recursive: true });
    mkdirSync(join(root, "src", "commands"), { recursive: true });
    writeFileSync(
      join(root, "src", "fs", "gate.ts"),
      'import { openSync } from "node:fs";\nconst safe = new Map();\n',
    );
    writeFileSync(
      join(root, "src", "commands", "worker.ts"),
      'import { WorkerRequestController } from "../worker-request-controller.js";\n// @banned-pattern-ignore: constructor is owned by the request controller created below\nconst worker = new Worker(path);\nconst controller = new WorkerRequestController(worker);\n',
    );

    expect(runScanner(root, { report: false }).hasErrors).toBe(false);
  });

  it("does not let one controller token exempt a second unmanaged Worker", () => {
    const root = tempDirectory("just-bash-lint-worker-scope-");
    const file = join(root, "src", "commands", "worker.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      'import { WorkerRequestController } from "../worker-request-controller.js";\n// @banned-pattern-ignore: first constructor is owned by its request controller\nconst first = new Worker(firstPath);\nconst controller = new WorkerRequestController(first);\nconst unmanaged = new Worker(secondPath);\n',
    );

    const result = runScanner(root, { report: false });
    const workerFindings = result.violations.filter(
      (item) =>
        item.pattern.name ===
        "Worker created without shared request controller",
    );
    expect(workerFindings).toHaveLength(1);
    expect(workerFindings[0].content).toContain("secondPath");
  });

  it("rejects an empty banned-pattern suppression reason", () => {
    const root = tempDirectory("just-bash-lint-empty-ignore-");
    const file = join(root, "src", "commands", "worker.ts");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      "// @banned-pattern-ignore:\nconst worker = new Worker(path);\n",
    );

    const result = runScanner(root, { report: false });
    expect(result.violations.map((item) => item.pattern.name)).toContain(
      "Worker created without shared request controller",
    );
  });
});
