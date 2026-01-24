/**
 * CLI tool for executing bash scripts using Bash.
 *
 * Reads a bash script from stdin, parses it to an AST, executes it,
 * and outputs the AST, exit code, stderr, and stdout.
 *
 * Usage:
 *   echo '<script>' | pnpm dev:exec
 *   cat script.sh | pnpm dev:exec
 *
 * Options:
 *   --print-ast   Show the parsed AST
 *   --real-bash   Also run the script with real bash for comparison
 *   --root <path> Use OverlayFS with specified root directory
 *   --no-limit    Remove execution limits (for large scripts)
 *
 * Output:
 *   - AST: The parsed Abstract Syntax Tree as JSON (unless --no-ast)
 *   - exitCode: The exit code of the script
 *   - stderr: Standard error output (JSON string)
 *   - stdout: Standard output (JSON string)
 *   - (with --real-bash) Real bash output for comparison
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { Bash } from "../Bash.js";
import { OverlayFs } from "../fs/overlay-fs/index.js";
import { parse } from "../parser/parser.js";

const showAst = process.argv.includes("--print-ast");
const runRealBash = process.argv.includes("--real-bash");
const noLimit = process.argv.includes("--no-limit");

// Parse --root option
let rootPath: string | undefined;
const rootIndex = process.argv.indexOf("--root");
if (rootIndex !== -1 && rootIndex + 1 < process.argv.length) {
  rootPath = resolve(process.argv[rootIndex + 1]);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

// Only read from stdin to avoid shell expansion issues with command line args
if (process.stdin.isTTY) {
  console.error("Usage: echo '<script>' | pnpm dev:exec");
  console.error("       cat script.sh | pnpm dev:exec");
  process.exit(1);
}

const script = await readStdin();
if (!script) {
  console.error("No script provided on stdin");
  process.exit(1);
}

// Parse and optionally display AST
if (showAst) {
  const normalizedScript = script
    .split("\n")
    .map((line) => line.trimStart())
    .join("\n");
  try {
    const ast = parse(normalizedScript);
    console.log("AST:", JSON.stringify(ast, null, 2));
    console.log("");
  } catch (error) {
    console.error("Error parsing script:", error);
    process.exit(1);
  }
} else {
  console.log("AST: Request with --print-ast");
}

// Create Bash environment with optional OverlayFS
// Use high limits for dev:exec (typical use is exploration of large filesystems)
const executionLimits = noLimit
  ? {
      maxCommandCount: Number.MAX_SAFE_INTEGER,
      maxLoopIterations: Number.MAX_SAFE_INTEGER,
    }
  : {
      maxCommandCount: 100000, // Higher default for dev:exec
      maxLoopIterations: 100000,
    };

let env: Bash;
if (rootPath) {
  const fs = new OverlayFs({ root: rootPath });
  const mountPoint = fs.getMountPoint();
  env = new Bash({ fs, cwd: mountPoint, executionLimits });
  console.log(`OverlayFS: ${rootPath} mounted at ${mountPoint}`);
} else {
  env = new Bash({ executionLimits });
}
const r = await env.exec(script);
console.log("exitCode:", r.exitCode);
console.log("stderr:", JSON.stringify(r.stderr));
console.log("stdout:", JSON.stringify(r.stdout));

// Run with real bash for comparison
if (runRealBash) {
  console.log("");
  console.log("=== Real Bash ===");
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tempDir = mkdtempSync(join(tmpdir(), "bash-env-"));
  try {
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf-8",
      cwd: tempDir,
      env: { ...process.env, HOME: tempDir, PATH: "/usr/bin:/bin" },
    });
    console.log("exitCode:", result.status);
    console.log("stderr:", JSON.stringify(result.stderr));
    console.log("stdout:", JSON.stringify(result.stdout));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
