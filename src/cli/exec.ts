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
 *   --no-ast      Disable AST output
 *   --real-bash   Also run the script with real bash for comparison
 *
 * Output:
 *   - AST: The parsed Abstract Syntax Tree as JSON (unless --no-ast)
 *   - exitCode: The exit code of the script
 *   - stderr: Standard error output (JSON string)
 *   - stdout: Standard output (JSON string)
 *   - (with --real-bash) Real bash output for comparison
 */

import { spawnSync } from "node:child_process";
import { Bash } from "../Bash.js";
import { parse } from "../parser/parser.js";

const showAst = process.argv.includes("--print-ast");
const runRealBash = process.argv.includes("--real-bash");

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

const env = new Bash();
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
      env: { ...process.env, HOME: tempDir, PATH: "/bin:/usr/bin" },
    });
    console.log("exitCode:", result.status);
    console.log("stderr:", JSON.stringify(result.stderr));
    console.log("stdout:", JSON.stringify(result.stdout));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
