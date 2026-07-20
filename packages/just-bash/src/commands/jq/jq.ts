/**
 * jq - Command-line JSON processor
 *
 * Full jq implementation with proper parser and evaluator.
 */

import { decodeBytesToUtf8 } from "../../encoding.js";
import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import {
  assertDefenseContext,
  awaitWithDefenseContext,
} from "../../security/defense-context.js";
import { SecurityViolationError } from "../../security/defense-in-depth-box.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { readFiles } from "../../utils/file-reader.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { utf8ByteLength } from "../printf/escapes.js";
import {
  type EvaluateOptions,
  evaluate,
  parse,
  type QueryValue,
} from "../query-engine/index.js";
import { formatJsonValue } from "../query-engine/json-output.js";
import { sanitizeParsedData } from "../query-engine/safe-object.js";
import { getValueDepth } from "../query-engine/value-operations.js";

function escapeControlChar(char: string): string {
  switch (char) {
    case "\b":
      return "\\b";
    case "\f":
      return "\\f";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    default:
      return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  }
}

function sanitizeJsonControlChars(input: string): string {
  let output = "";
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (isEscaped) {
      output += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      output += char;
      isEscaped = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = !inString;
      continue;
    }

    if (inString && char.charCodeAt(0) <= 0x1f) {
      output += escapeControlChar(char);
      continue;
    }

    output += char;
  }

  return output;
}

function parseJsonSlice(
  input: string,
  startPos: number,
  endPos: number,
): unknown {
  return JSON.parse(sanitizeJsonControlChars(input.slice(startPos, endPos)));
}

/**
 * Parse a JSON stream (concatenated JSON values).
 * Real jq can handle `{...}{...}` or `{...}\n{...}` or pretty-printed concatenated JSONs.
 */
function parseJsonStream(
  input: string,
  limits: { maxDepth: number; maxElements: number },
): unknown[] {
  const results: unknown[] = [];
  const appendResult = (value: unknown): void => {
    if (results.length >= limits.maxElements) {
      throw new ExecutionLimitError(
        `query result element limit exceeded (${limits.maxElements})`,
        "array_elements",
      );
    }
    results.push(value);
  };
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
      const bracketStack: string[] = [char === "{" ? "}" : "]"];
      let inString = false;
      let isEscaped = false;
      pos++;

      while (pos < len && bracketStack.length > 0) {
        const c = input[pos];
        if (isEscaped) {
          isEscaped = false;
        } else if (c === "\\") {
          isEscaped = true;
        } else if (c === '"') {
          inString = !inString;
        } else if (!inString) {
          if (c === "{" || c === "[") {
            bracketStack.push(c === "{" ? "}" : "]");
            if (bracketStack.length > limits.maxDepth) {
              throw new ExecutionLimitError(
                `query depth limit exceeded (${limits.maxDepth})`,
                "recursion",
              );
            }
          } else if (c === "}" || c === "]") {
            if (bracketStack.pop() !== c) {
              throw new Error(`Mismatched JSON delimiter at position ${pos}`);
            }
          }
        }
        pos++;
      }

      if (bracketStack.length !== 0) {
        throw new Error(
          `Unexpected end of JSON input at position ${pos} (unclosed ${char})`,
        );
      }

      appendResult(
        sanitizeParsedData(parseJsonSlice(input, startPos, pos), {
          maxDepth: limits.maxDepth,
          maxElements: limits.maxElements,
        }),
      );
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
      appendResult(
        sanitizeParsedData(parseJsonSlice(input, startPos, pos), limits),
      );
    } else if (char === "-" || (char >= "0" && char <= "9")) {
      // Parse number
      while (pos < len && /[\d.eE+-]/.test(input[pos])) pos++;
      appendResult(
        sanitizeParsedData(parseJsonSlice(input, startPos, pos), limits),
      );
    } else if (input.slice(pos, pos + 4) === "true") {
      appendResult(true);
      pos += 4;
    } else if (input.slice(pos, pos + 5) === "false") {
      appendResult(false);
      pos += 5;
    } else if (input.slice(pos, pos + 4) === "null") {
      appendResult(null);
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
  usage: "jq [OPTIONS] FILTER [FILE...]",
  options: [
    "-R, --raw-input   read each line as string instead of JSON",
    "-r, --raw-output  output strings without quotes",
    "-c, --compact-output  compact instead of pretty-printed output",
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

export const jqCommand: Command = {
  name: "jq",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    assertDefenseContext(ctx.requireDefenseContext, "jq", "execution entry");
    const withDefenseContext = <T>(
      phase: string,
      op: () => Promise<T>,
    ): Promise<T> =>
      awaitWithDefenseContext(ctx.requireDefenseContext, "jq", phase, op);

    if (hasHelpFlag(args)) return showHelp(jqHelp);

    let raw = false;
    let rawInput = false;
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
      if (a === "-R" || a === "--raw-input") rawInput = true;
      else if (a === "-r" || a === "--raw-output") raw = true;
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
          if (c === "R") rawInput = true;
          else if (c === "r") raw = true;
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

    // Build list of inputs: stdin or files. jq parses JSON, so the input
    // bytes are decoded to UTF-8 before parsing — without this, multi-byte
    // sequences inside string values get re-encoded twice and emit mojibake.
    let inputs: { source: string; content: string }[] = [];
    if (nullInput) {
      // No input
    } else if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
      inputs.push({ source: "stdin", content: decodeBytesToUtf8(ctx.stdin) });
    } else {
      // Read all files in parallel using shared utility
      const result = await withDefenseContext("file read", () =>
        readFiles(ctx, files, {
          cmdName: "jq",
          stopOnError: true,
        }),
      );
      if (result.exitCode !== 0) {
        return {
          stdout: "",
          stderr: result.stderr,
          exitCode: 2, // jq uses exit code 2 for file errors
        };
      }
      inputs = result.files.map((f) => ({
        source: f.filename || "stdin",
        content: decodeBytesToUtf8(f.content),
      }));
    }

    try {
      const ast = parse(filter, {
        maxDepth: ctx.limits.maxQueryDepth,
        maxTokens: ctx.limits.maxQueryTokens,
        maxSourceLength: ctx.limits.maxStringLength,
      });
      let values: QueryValue[] = [];

      const evalOptions: EvaluateOptions = {
        limits: ctx.limits
          ? {
              maxIterations: ctx.limits.maxJqIterations,
              maxStringLength: ctx.limits.maxStringLength,
              maxOutputSize: ctx.limits.maxOutputSize,
              maxArrayElements: ctx.limits.maxQueryElements,
              maxDepth: ctx.limits.maxQueryDepth,
            }
          : undefined,
        env: ctx.env,
        coverage: ctx.coverage,
        requireDefenseContext: ctx.requireDefenseContext,
        budget: { operations: 0, callDepth: 0 },
      };
      const jsonLimits = {
        maxDepth: ctx.limits.maxQueryDepth,
        maxElements: ctx.limits.maxQueryElements,
      };
      const appendValues = (target: QueryValue[], next: QueryValue[]): void => {
        if (next.length > ctx.limits.maxQueryElements - target.length) {
          throw new ExecutionLimitError(
            `query result element limit exceeded (${ctx.limits.maxQueryElements})`,
            "array_elements",
          );
        }
        for (const value of next) target.push(value);
      };

      if (nullInput) {
        values = evaluate(null, ast, evalOptions);
      } else if (rawInput && slurp) {
        // Raw slurp: the entire concatenated input becomes one JSON string.
        const rawText = inputs.map(({ content }) => content).join("");
        values = evaluate(rawText, ast, evalOptions);
      } else if (rawInput) {
        // Raw input: real jq concatenates all inputs into a single stream and
        // splits on newlines, so a line can span a file boundary when a file
        // lacks a trailing newline. Scan incrementally, carrying only the
        // unterminated trailing fragment across inputs, instead of building the
        // full concatenated string and a complete array of lines. A trailing
        // newline does not yield a final empty string, but interior blank
        // lines are preserved.
        let remainder = "";
        for (const { content } of inputs) {
          const text = remainder + content;
          let start = 0;
          let nl = text.indexOf("\n", start);
          while (nl !== -1) {
            appendValues(
              values,
              evaluate(text.slice(start, nl), ast, evalOptions),
            );
            start = nl + 1;
            nl = text.indexOf("\n", start);
          }
          remainder = text.slice(start);
        }
        if (remainder !== "") {
          appendValues(values, evaluate(remainder, ast, evalOptions));
        }
      } else if (slurp) {
        // Slurp mode: combine all inputs into single array
        // Use JSON stream parser to handle concatenated JSON (not just NDJSON)
        const items: QueryValue[] = [];
        for (const { content } of inputs) {
          const trimmed = content.trim();
          if (trimmed) {
            appendValues(items, parseJsonStream(trimmed, jsonLimits));
          }
        }
        values = evaluate(items, ast, evalOptions);
      } else {
        // Process each input file separately
        // Use JSON stream parser to handle concatenated JSON (e.g., cat file1.json file2.json | jq .)
        for (const { content } of inputs) {
          const trimmed = content.trim();
          if (!trimmed) continue;

          const jsonValues = parseJsonStream(trimmed, jsonLimits);
          for (const jsonValue of jsonValues) {
            appendValues(values, evaluate(jsonValue, ast, evalOptions));
          }
        }
      }

      const separator = joinOutput ? "" : "\n";
      const maxStringLength = Math.min(
        ctx.limits.maxStringLength,
        ctx.limits.maxOutputSize,
      );
      const formatted: string[] = [];
      let outputBytes = 0;
      for (const value of values) {
        const separatorBytes = formatted.length > 0 ? separator.length : 0;
        const finalNewlineBytes = joinOutput ? 0 : 1;
        const remainingBytes =
          maxStringLength - outputBytes - separatorBytes - finalNewlineBytes;
        if (remainingBytes < 0) {
          throw new ExecutionLimitError(
            `output size limit exceeded (${maxStringLength} bytes)`,
            "string_length",
          );
        }
        if (
          getValueDepth(value, ctx.limits.maxQueryDepth + 1) >
          ctx.limits.maxQueryDepth
        ) {
          throw new ExecutionLimitError(
            `query depth limit exceeded (${ctx.limits.maxQueryDepth})`,
            "recursion",
          );
        }
        const text = formatJsonValue(value, remainingBytes, {
          compact,
          raw,
          sortKeys,
          useTab,
          limitKind: "string_length",
        });
        const textBytes = utf8ByteLength(text);
        if (
          outputBytes + separatorBytes + textBytes + finalNewlineBytes >
          maxStringLength
        ) {
          throw new ExecutionLimitError(
            `output size limit exceeded (${maxStringLength} bytes)`,
            "string_length",
          );
        }
        outputBytes += separatorBytes + textBytes;
        formatted.push(text);
      }
      const output = formatted.join(separator);

      const exitCode =
        exitStatus &&
        (values.length === 0 ||
          values.every((v) => v === null || v === undefined || v === false))
          ? 1
          : 0;

      // jq emits text; the pipeline handles encoding.
      const stdoutText = output ? (joinOutput ? output : `${output}\n`) : "";
      return {
        stdout: stdoutText,
        stderr: "",
        exitCode,
      };
    } catch (e) {
      if (e instanceof SecurityViolationError) {
        throw e;
      }
      if (e instanceof ExecutionLimitError) {
        const message = sanitizeErrorMessage(e.message);
        return {
          stdout: "",
          stderr: `jq: ${message}\n`,
          exitCode: ExecutionLimitError.EXIT_CODE,
        };
      }
      const msg = sanitizeErrorMessage((e as Error).message);
      if (msg.includes("Unknown function")) {
        return {
          stdout: "",
          stderr: `jq: error: ${msg}\n`,
          exitCode: 3,
        };
      }
      return {
        stdout: "",
        stderr: `jq: parse error: ${msg}\n`,
        exitCode: 5,
      };
    }
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "jq",
  flags: [
    { flag: "-R", type: "boolean" },
    { flag: "-r", type: "boolean" },
    { flag: "-c", type: "boolean" },
    { flag: "-e", type: "boolean" },
    { flag: "-s", type: "boolean" },
    { flag: "-n", type: "boolean" },
    { flag: "-j", type: "boolean" },
    { flag: "-S", type: "boolean" },
    { flag: "--tab", type: "boolean" },
  ],
  stdinType: "json",
  needsArgs: true,
};
