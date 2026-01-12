/**
 * jq - Command-line JSON processor
 *
 * Full jq implementation with proper parser and evaluator.
 */

import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { batchReadFiles } from "../../utils/batched-read.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import {
  type EvaluateOptions,
  evaluate,
  parse,
  type QueryValue,
} from "../query-engine/index.js";

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

function formatValue(
  v: QueryValue,
  compact: boolean,
  raw: boolean,
  sortKeys: boolean,
  useTab: boolean,
  indent = 0,
): string {
  if (v === null) return "null";
  if (v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "null";
    return String(v);
  }
  if (typeof v === "string") return raw ? v : JSON.stringify(v);

  const indentStr = useTab ? "\t" : "  ";

  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (compact) {
      return `[${v.map((x) => formatValue(x, true, false, sortKeys, useTab)).join(",")}]`;
    }
    const items = v.map(
      (x) =>
        indentStr.repeat(indent + 1) +
        formatValue(x, false, false, sortKeys, useTab, indent + 1),
    );
    return `[\n${items.join(",\n")}\n${indentStr.repeat(indent)}]`;
  }

  if (typeof v === "object") {
    let keys = Object.keys(v as object);
    if (sortKeys) keys = keys.sort();
    if (keys.length === 0) return "{}";
    if (compact) {
      return `{${keys.map((k) => `${JSON.stringify(k)}:${formatValue((v as Record<string, unknown>)[k], true, false, sortKeys, useTab)}`).join(",")}}`;
    }
    const items = keys.map((k) => {
      const val = formatValue(
        (v as Record<string, unknown>)[k],
        false,
        false,
        sortKeys,
        useTab,
        indent + 1,
      );
      return `${indentStr.repeat(indent + 1)}${JSON.stringify(k)}: ${val}`;
    });
    return `{\n${items.join(",\n")}\n${indentStr.repeat(indent)}}`;
  }

  return String(v);
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
      const { results, error } = await batchReadFiles(files, ctx, {
        cmdName: "jq",
      });
      if (error) return error;
      inputs = results.map((r) => ({ source: r.source, content: r.content }));
    }

    try {
      const ast = parse(filter);
      let values: QueryValue[] = [];

      const evalOptions: EvaluateOptions = {
        limits: ctx.limits
          ? { maxIterations: ctx.limits.maxJqIterations }
          : undefined,
        env: ctx.env,
      };

      if (nullInput) {
        values = evaluate(null, ast, evalOptions);
      } else if (slurp) {
        // Slurp mode: combine all inputs into single array
        const items: QueryValue[] = [];
        for (const { content } of inputs) {
          for (const line of content.trim().split("\n")) {
            if (line.trim()) items.push(JSON.parse(line));
          }
        }
        values = evaluate(items, ast, evalOptions);
      } else {
        // Process each input file separately
        for (const { content } of inputs) {
          const trimmed = content.trim();
          if (!trimmed) continue;

          // Helper to parse file line by line (for NDJSON or non-JSON-object/array files)
          const parseLineByLine = () => {
            for (const line of trimmed.split("\n")) {
              if (line.trim()) {
                values.push(...evaluate(JSON.parse(line), ast, evalOptions));
              }
            }
          };

          if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            // Try to parse as single JSON value first
            try {
              values.push(...evaluate(JSON.parse(trimmed), ast, evalOptions));
            } catch {
              // If that fails (e.g., NDJSON file), parse line by line
              parseLineByLine();
            }
          } else {
            parseLineByLine();
          }
        }
      }

      const formatted = values.map((v) =>
        formatValue(v, compact, raw, sortKeys, useTab),
      );
      const separator = joinOutput ? "" : "\n";
      const output = formatted.join(separator);
      const exitCode =
        exitStatus &&
        (values.length === 0 ||
          values.every((v) => v === null || v === undefined || v === false))
          ? 1
          : 0;

      return {
        stdout: output ? (joinOutput ? output : `${output}\n`) : "",
        stderr: "",
        exitCode,
      };
    } catch (e) {
      if (e instanceof ExecutionLimitError) {
        return {
          stdout: "",
          stderr: `jq: ${e.message}\n`,
          exitCode: ExecutionLimitError.EXIT_CODE,
        };
      }
      const msg = (e as Error).message;
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
