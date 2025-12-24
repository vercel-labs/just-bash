/**
 * jq - Command-line JSON processor
 *
 * Supports a subset of jq syntax:
 * - . (identity)
 * - .key, .key.nested (object access)
 * - .[0], .[-1] (array indexing)
 * - .[] (array/object iteration)
 * - .key[] (access then iterate)
 * - keys, values, length, type
 * - Pipes: .foo | .bar
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

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
    "    --help        display this help and exit",
  ],
};

type JqValue = unknown;

function formatValue(
  v: JqValue,
  compact: boolean,
  raw: boolean,
  indent = 0,
): string {
  if (v === null) return "null";
  if (v === undefined) return "null";
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return raw ? v : JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    if (compact)
      return `[${v.map((x) => formatValue(x, true, false)).join(",")}]`;
    const items = v.map(
      (x) => "  ".repeat(indent + 1) + formatValue(x, false, false, indent + 1),
    );
    return `[\n${items.join(",\n")}\n${"  ".repeat(indent)}]`;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v as object);
    if (keys.length === 0) return "{}";
    if (compact) {
      return `{${keys.map((k) => `${JSON.stringify(k)}:${formatValue((v as Record<string, unknown>)[k], true, false)}`).join(",")}}`;
    }
    const items = keys.map((k) => {
      const val = formatValue(
        (v as Record<string, unknown>)[k],
        false,
        false,
        indent + 1,
      );
      return `${"  ".repeat(indent + 1)}${JSON.stringify(k)}: ${val}`;
    });
    return `{\n${items.join(",\n")}\n${"  ".repeat(indent)}}`;
  }
  return String(v);
}

function accessPath(v: JqValue, path: string): JqValue[] {
  if (path === "" || path === ".") return [v];

  // Remove leading dot
  const p = path.startsWith(".") ? path.slice(1) : path;
  if (p === "") return [v];

  // Handle .[] at the start
  if (p.startsWith("[]")) {
    const rest = p.slice(2);
    if (Array.isArray(v)) {
      return v.flatMap((item) => accessPath(item, `.${rest}`));
    }
    if (v && typeof v === "object") {
      return Object.values(v).flatMap((item) => accessPath(item, `.${rest}`));
    }
    return [];
  }

  // Handle .[n] array index
  const idxMatch = p.match(/^\[(-?\d+)\](.*)/);
  if (idxMatch) {
    const idx = Number.parseInt(idxMatch[1], 10);
    const rest = idxMatch[2];
    if (Array.isArray(v)) {
      const i = idx < 0 ? v.length + idx : idx;
      if (i >= 0 && i < v.length) {
        return accessPath(v[i], `.${rest}`);
      }
    }
    return [null];
  }

  // Handle .key or .key.rest or .key[]
  const keyMatch = p.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(.*)/);
  if (keyMatch) {
    const key = keyMatch[1];
    let rest = keyMatch[2];

    if (v && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as Record<string, unknown>;
      const next = obj[key];

      // Check for [] after key
      if (rest.startsWith("[]")) {
        rest = rest.slice(2);
        if (Array.isArray(next)) {
          return next.flatMap((item) => accessPath(item, `.${rest}`));
        }
        if (next && typeof next === "object") {
          return Object.values(next).flatMap((item) =>
            accessPath(item, `.${rest}`),
          );
        }
        return [];
      }

      if (rest.startsWith(".") || rest.startsWith("[") || rest === "") {
        return accessPath(next, rest || ".");
      }
    }
    return [null];
  }

  // Handle ["key"] syntax
  const bracketKeyMatch = p.match(/^\["([^"]+)"\](.*)/);
  if (bracketKeyMatch) {
    const key = bracketKeyMatch[1];
    const rest = bracketKeyMatch[2];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return accessPath((v as Record<string, unknown>)[key], `.${rest}`);
    }
    return [null];
  }

  return [null];
}

function evalFilter(v: JqValue, filter: string): JqValue[] {
  const f = filter.trim();

  // Handle pipes
  if (f.includes("|")) {
    const parts = f.split("|").map((s) => s.trim());
    let results: JqValue[] = [v];
    for (const part of parts) {
      results = results.flatMap((r) => evalFilter(r, part));
    }
    return results;
  }

  // Built-in functions
  if (f === "keys") {
    if (Array.isArray(v)) return [v.map((_, i) => i)];
    if (v && typeof v === "object") return [Object.keys(v)];
    return [null];
  }
  if (f === "values") {
    if (Array.isArray(v)) return [v];
    if (v && typeof v === "object") return [Object.values(v)];
    return [null];
  }
  if (f === "length") {
    if (typeof v === "string") return [v.length];
    if (Array.isArray(v)) return [v.length];
    if (v && typeof v === "object") return [Object.keys(v).length];
    if (v === null) return [0];
    return [null];
  }
  if (f === "type") {
    if (v === null) return ["null"];
    if (Array.isArray(v)) return ["array"];
    return [typeof v];
  }
  if (f === "first") {
    if (Array.isArray(v) && v.length > 0) return [v[0]];
    return [null];
  }
  if (f === "last") {
    if (Array.isArray(v) && v.length > 0) return [v[v.length - 1]];
    return [null];
  }
  if (f === "reverse") {
    if (Array.isArray(v)) return [[...v].reverse()];
    if (typeof v === "string") return [v.split("").reverse().join("")];
    return [null];
  }
  if (f === "sort") {
    if (Array.isArray(v)) return [[...v].sort()];
    return [null];
  }
  if (f === "unique") {
    if (Array.isArray(v))
      return [
        [...new Set(v.map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x)),
      ];
    return [null];
  }
  if (f === "flatten") {
    if (Array.isArray(v)) return [v.flat()];
    return [null];
  }
  if (f === "add") {
    if (Array.isArray(v)) {
      if (v.length === 0) return [null];
      if (v.every((x) => typeof x === "number"))
        return [v.reduce((a, b) => (a as number) + (b as number), 0)];
      if (v.every((x) => typeof x === "string")) return [v.join("")];
      if (v.every((x) => Array.isArray(x))) return [v.flat()];
      return [null];
    }
    return [null];
  }
  if (f === "min") {
    if (Array.isArray(v) && v.length > 0) return [Math.min(...(v as number[]))];
    return [null];
  }
  if (f === "max") {
    if (Array.isArray(v) && v.length > 0) return [Math.max(...(v as number[]))];
    return [null];
  }
  if (f === "empty") {
    return [];
  }
  if (f === "not") {
    return [!v];
  }

  // Path access
  return accessPath(v, f);
}

export const jqCommand: Command = {
  name: "jq",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(jqHelp);

    let raw = false,
      compact = false,
      exitStatus = false,
      slurp = false,
      nullInput = false;
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
      else if (a === "-") files.push("-");
      else if (a.startsWith("--")) return unknownOption("jq", a);
      else if (a.startsWith("-")) {
        for (const c of a.slice(1)) {
          if (c === "r") raw = true;
          else if (c === "c") compact = true;
          else if (c === "e") exitStatus = true;
          else if (c === "s") slurp = true;
          else if (c === "n") nullInput = true;
          else return unknownOption("jq", `-${c}`);
        }
      } else if (!filterSet) {
        filter = a;
        filterSet = true;
      } else {
        files.push(a);
      }
    }

    let input: string;
    if (nullInput) {
      input = "";
    } else if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
      input = ctx.stdin;
    } else {
      try {
        const filePath = ctx.fs.resolvePath(ctx.cwd, files[0]);
        input = await ctx.fs.readFile(filePath);
      } catch {
        return {
          stdout: "",
          stderr: `jq: ${files[0]}: No such file or directory\n`,
          exitCode: 2,
        };
      }
    }

    try {
      let values: JqValue[];

      if (nullInput) {
        values = evalFilter(null, filter);
      } else if (slurp) {
        // Read all JSON values into array
        const items: JqValue[] = [];
        for (const line of input.trim().split("\n")) {
          if (line.trim()) items.push(JSON.parse(line));
        }
        values = evalFilter(items, filter);
      } else {
        // Parse as single JSON or newline-delimited JSON
        const trimmed = input.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
          values = evalFilter(JSON.parse(trimmed), filter);
        } else {
          // Try line-by-line
          values = [];
          for (const line of trimmed.split("\n")) {
            if (line.trim()) {
              values.push(...evalFilter(JSON.parse(line), filter));
            }
          }
        }
      }

      const output = values.map((v) => formatValue(v, compact, raw)).join("\n");
      const exitCode =
        exitStatus &&
        (values.length === 0 ||
          values.every((v) => v === null || v === undefined || v === false))
          ? 1
          : 0;

      return { stdout: output ? `${output}\n` : "", stderr: "", exitCode };
    } catch (e) {
      return {
        stdout: "",
        stderr: `jq: parse error: ${(e as Error).message}\n`,
        exitCode: 5,
      };
    }
  },
};
