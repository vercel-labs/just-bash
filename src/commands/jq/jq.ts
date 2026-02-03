/**
 * jq - Command-line JSON processor
 *
 * Uses jq-web (real jq compiled to WebAssembly) for full jq compatibility.
 * Executes in a worker thread with timeout protection to prevent runaway compute.
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { readFiles } from "../../utils/file-reader.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Timeout for jq execution (1000ms = 1 second)
// This prevents infinite loops from hanging the process while allowing
// normal operations to complete
const JQ_TIMEOUT_MS = 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Worker path: try current directory first (dist), then fall back to src
// When running tests, we're in src/commands/jq/, worker is in src/commands/jq/jq-worker.ts
// When running from dist, we're in dist/commands/jq/, worker is in dist/commands/jq/jq-worker.js
let workerPath = join(__dirname, "jq-worker.js");
// For tests running from source, use the TypeScript file
if (__filename.includes("/src/")) {
  workerPath = join(__dirname, "jq-worker.ts");
}

/**
 * Execute jq in a worker thread with timeout protection.
 * Returns the result or throws an error if timeout is exceeded.
 */
async function executeJqWithTimeout(
  input: string,
  filter: string,
  flags: string[],
): Promise<{ output: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerPath);
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      worker.terminate();
      reject(new Error("jq execution timeout: operation took too long"));
    }, JQ_TIMEOUT_MS);

    worker.on("message", (result: any) => {
      clearTimeout(timeout);
      worker.terminate();
      
      if (timedOut) return;

      if (result.success) {
        resolve({ output: result.output, exitCode: result.exitCode });
      } else {
        const error: any = new Error(result.error);
        error.exitCode = result.exitCode;
        error.stderr = result.stderr;
        reject(error);
      }
    });

    worker.on("error", (err) => {
      clearTimeout(timeout);
      worker.terminate();
      if (!timedOut) reject(err);
    });

    worker.on("exit", (code) => {
      clearTimeout(timeout);
      if (!timedOut && code !== 0) {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });

    worker.postMessage({ input, filter, flags });
  });
}

/**
 * Parse a JSON stream (concatenated JSON values).
 * Real jq can handle `{...}{...}` or `{...}\n{...}` or pretty-printed concatenated JSONs.
 */
function parseJsonStream(input: string): unknown[] {
  const results: unknown[] = [];
  let pos = 0;
  const len = input.length;

  while (pos < len) {
    // Skip whitespace
    while (pos < len && /\s/.test(input[pos])) pos++;
    if (pos >= len) break;

    const startPos = pos;
    const char = input[pos];

    if (char === "{" || char === "[") {
      // Parse object or array by finding matching close bracket
      const openBracket = char;
      const closeBracket = char === "{" ? "}" : "]";
      let depth = 1;
      let inString = false;
      let isEscaped = false;
      pos++;

      while (pos < len && depth > 0) {
        const c = input[pos];
        if (isEscaped) {
          isEscaped = false;
        } else if (c === "\\") {
          isEscaped = true;
        } else if (c === '"') {
          inString = !inString;
        } else if (!inString) {
          if (c === openBracket) depth++;
          else if (c === closeBracket) depth--;
        }
        pos++;
      }

      if (depth !== 0) {
        throw new Error(
          `Unexpected end of JSON input at position ${pos} (unclosed ${openBracket})`,
        );
      }

      results.push(JSON.parse(input.slice(startPos, pos)));
    } else if (char === '"') {
      // Parse string
      let isEscaped = false;
      pos++;
      while (pos < len) {
        const c = input[pos];
        if (isEscaped) {
          isEscaped = false;
        } else if (c === "\\") {
          isEscaped = true;
        } else if (c === '"') {
          pos++;
          break;
        }
        pos++;
      }
      results.push(JSON.parse(input.slice(startPos, pos)));
    } else if (char === "-" || (char >= "0" && char <= "9")) {
      // Parse number
      while (pos < len && /[\d.eE+-]/.test(input[pos])) pos++;
      results.push(JSON.parse(input.slice(startPos, pos)));
    } else if (input.slice(pos, pos + 4) === "true") {
      results.push(true);
      pos += 4;
    } else if (input.slice(pos, pos + 5) === "false") {
      results.push(false);
      pos += 5;
    } else if (input.slice(pos, pos + 4) === "null") {
      results.push(null);
      pos += 4;
    } else {
      // Try to provide context about what we found
      const context = input.slice(pos, pos + 10);
      throw new Error(
        `Invalid JSON at position ${startPos}: unexpected '${context.split(/\s/)[0]}'`,
      );
    }
  }

  return results;
}

const jqHelp = {
  name: "jq",
  summary: "command-line JSON processor",
  usage: "jq [OPTIONS] FILTER [FILE]",
  options: [
    "-r, --raw-output  output strings without quotes",
    "-c, --compact     compact output (no pretty printing)",
    "-e, --exit-status set exit status based on output",
    "-s, --slurp       read entire input into array",
    "-n, --null-input  don't read any input",
    "-j, --join-output don't print newlines after each output",
    "-a, --ascii       force ASCII output",
    "-S, --sort-keys   sort object keys",
    "-C, --color       colorize output (ignored)",
    "-M, --monochrome  monochrome output (ignored)",
    "    --tab         use tabs for indentation",
    "    --help        display this help and exit",
  ],
};

/**
 * Build jq flags string from options
 */
function buildJqFlags(options: {
  raw: boolean;
  compact: boolean;
  sortKeys: boolean;
  useTab: boolean;
  joinOutput: boolean;
}): string {
  const flags: string[] = [];
  if (options.raw) flags.push("-r");
  if (options.compact) flags.push("-c");
  if (options.sortKeys) flags.push("-S");
  if (options.useTab) flags.push("--tab");
  if (options.joinOutput) flags.push("-j");
  return flags.join(" ");
}

export const jqCommand: Command = {
  name: "jq",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(jqHelp);

    let raw = false;
    let compact = false;
    let exitStatus = false;
    let slurp = false;
    let nullInput = false;
    let joinOutput = false;
    let sortKeys = false;
    let useTab = false;
    let filter = ".";
    let filterSet = false;
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "-r" || a === "--raw-output") raw = true;
      else if (a === "-c" || a === "--compact-output") compact = true;
      else if (a === "-e" || a === "--exit-status") exitStatus = true;
      else if (a === "-s" || a === "--slurp") slurp = true;
      else if (a === "-n" || a === "--null-input") nullInput = true;
      else if (a === "-j" || a === "--join-output") joinOutput = true;
      else if (a === "-a" || a === "--ascii") {
        /* ignored */
      } else if (a === "-S" || a === "--sort-keys") sortKeys = true;
      else if (a === "-C" || a === "--color") {
        /* ignored */
      } else if (a === "-M" || a === "--monochrome") {
        /* ignored */
      } else if (a === "--tab") useTab = true;
      else if (a === "-") files.push("-");
      else if (a.startsWith("--")) return unknownOption("jq", a);
      else if (a.startsWith("-")) {
        for (const c of a.slice(1)) {
          if (c === "r") raw = true;
          else if (c === "c") compact = true;
          else if (c === "e") exitStatus = true;
          else if (c === "s") slurp = true;
          else if (c === "n") nullInput = true;
          else if (c === "j") joinOutput = true;
          else if (c === "a") {
            /* ignored */
          } else if (c === "S") sortKeys = true;
          else if (c === "C") {
            /* ignored */
          } else if (c === "M") {
            /* ignored */
          } else return unknownOption("jq", `-${c}`);
        }
      } else if (!filterSet) {
        filter = a;
        filterSet = true;
      } else {
        files.push(a);
      }
    }

    // Build list of inputs: stdin or files
    let inputs: { source: string; content: string }[] = [];
    if (nullInput) {
      // No input
    } else if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
      inputs.push({ source: "stdin", content: ctx.stdin });
    } else {
      // Read all files in parallel using shared utility
      const result = await readFiles(ctx, files, {
        cmdName: "jq",
        stopOnError: true,
      });
      if (result.exitCode !== 0) {
        return {
          stdout: "",
          stderr: result.stderr,
          exitCode: 2, // jq uses exit code 2 for file errors
        };
      }
      inputs = result.files.map((f) => ({
        source: f.filename || "stdin",
        content: f.content,
      }));
    }

    try {
      // Build jq flags array (jq-web expects an array, not a string)
      const flags: string[] = [];
      if (raw) flags.push("-r");
      if (compact) flags.push("-c");
      if (sortKeys) flags.push("-S");
      if (useTab) flags.push("--tab");
      if (joinOutput) flags.push("-j");

      const outputParts: string[] = [];

      if (nullInput) {
        // Null input mode: run filter with null input
        const { output } = await executeJqWithTimeout("null", filter, flags);
        if (output !== undefined) {
          outputParts.push(output);
        }
      } else if (slurp) {
        // Slurp mode: combine all inputs into single array
        const items: unknown[] = [];
        for (const { content } of inputs) {
          const trimmed = content.trim();
          if (trimmed) {
            items.push(...parseJsonStream(trimmed));
          }
        }
        const jsonInput = JSON.stringify(items);
        const { output } = await executeJqWithTimeout(jsonInput, filter, flags);
        if (output !== undefined) {
          outputParts.push(output);
        }
      } else {
        // Process each input separately
        for (const { content } of inputs) {
          const trimmed = content.trim();
          if (!trimmed) continue;

          const jsonValues = parseJsonStream(trimmed);
          for (const jsonValue of jsonValues) {
            const jsonInput = JSON.stringify(jsonValue);
            const { output } = await executeJqWithTimeout(jsonInput, filter, flags);
            // Include result even if undefined/empty (e.g., 'empty' filter)
            if (output !== undefined) {
              outputParts.push(output);
            }
          }
        }
      }

      // executeJqWithTimeout() returns formatted output
      // - Without -j: includes newlines between values but NOT a trailing newline
      // - With -j: no newlines at all
      // We need to add the final newline (unless -j is used) and handle multiple inputs
      
      let output: string;
      if (joinOutput) {
        // With -j: concatenate all outputs with no separators or trailing newline
        output = outputParts.join("");
      } else {
        // Without -j: each output part needs a trailing newline
        // jq-web doesn't add the final newline, so we need to add it
        output = outputParts.map(part => part.endsWith("\n") ? part : `${part}\n`).join("");
      }
      
      // Calculate exit code for -e flag
      // We need to check if output represents null/false/empty
      let exitCode = 0;
      if (exitStatus) {
        const trimmed = output.trim();
        if (!trimmed || trimmed === "null" || trimmed === "false") {
          exitCode = 1;
        }
      }

      return {
        stdout: output,
        stderr: "",
        exitCode,
      };
    } catch (e) {
      const error = e as any;
      const msg = error.message;
      
      // Check for timeout
      if (msg.includes("timeout")) {
        return {
          stdout: "",
          stderr: "jq: execution timeout: operation took too long\n",
          exitCode: 124, // Standard timeout exit code
        };
      }
      
      // Check if jq-web provided an exit code
      const exitCode = error.exitCode || 3;
      
      // Use stderr from jq-web if available, otherwise format the message
      let stderr = error.stderr || msg;
      
      // For JSON parse errors from parseJsonStream, format as parse error
      if (msg.includes("Invalid JSON") || msg.includes("Unexpected")) {
        stderr = `jq: parse error: ${msg}`;
        return {
          stdout: "",
          stderr: `${stderr}\n`,
          exitCode: 5,
        };
      }
      
      // Ensure stderr ends with newline
      if (!stderr.endsWith('\n')) {
        stderr += '\n';
      }
      
      return {
        stdout: "",
        stderr,
        exitCode,
      };
    }
  },
};

// Made with Bob
