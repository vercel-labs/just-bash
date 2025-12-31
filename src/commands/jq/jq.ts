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
  if (f === "to_entries") {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return [
        Object.entries(v as Record<string, unknown>).map(([key, value]) => ({
          key,
          value,
        })),
      ];
    }
    return [null];
  }
  if (f === "from_entries") {
    if (Array.isArray(v)) {
      const obj: Record<string, unknown> = {};
      for (const item of v) {
        if (item && typeof item === "object") {
          const entry = item as Record<string, unknown>;
          // Support both {key, value} and {name, value} and {k, v} formats
          const key = entry.key ?? entry.name ?? entry.k;
          const value = entry.value ?? entry.v;
          if (key !== undefined) {
            obj[String(key)] = value;
          }
        }
      }
      return [obj];
    }
    return [null];
  }
  if (f === "with_entries") {
    // with_entries(f) is shorthand for to_entries | map(f) | from_entries
    // For now, just return to_entries since we don't support inline functions yet
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return [
        Object.entries(v as Record<string, unknown>).map(([key, value]) => ({
          key,
          value,
        })),
      ];
    }
    return [null];
  }
  if (f === "has") {
    // .has requires an argument, handle basic case
    return [v !== null && v !== undefined];
  }
  if (f === "in") {
    // .in requires an argument
    return [false];
  }
  if (f === "getpath") {
    return [v];
  }
  if (f === "paths") {
    // Return all paths in the object
    const paths: unknown[][] = [];
    const walk = (val: unknown, path: unknown[]) => {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i = 0; i < val.length; i++) {
            paths.push([...path, i]);
            walk(val[i], [...path, i]);
          }
        } else {
          for (const key of Object.keys(val)) {
            paths.push([...path, key]);
            walk((val as Record<string, unknown>)[key], [...path, key]);
          }
        }
      }
    };
    walk(v, []);
    return [paths];
  }
  if (f === "leaf_paths") {
    const paths: unknown[][] = [];
    const walk = (val: unknown, path: unknown[]) => {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          if (val.length === 0) {
            paths.push(path);
          } else {
            for (let i = 0; i < val.length; i++) {
              walk(val[i], [...path, i]);
            }
          }
        } else {
          const keys = Object.keys(val);
          if (keys.length === 0) {
            paths.push(path);
          } else {
            for (const key of keys) {
              walk((val as Record<string, unknown>)[key], [...path, key]);
            }
          }
        }
      } else {
        paths.push(path);
      }
    };
    walk(v, []);
    return [paths];
  }
  if (f === "any") {
    if (Array.isArray(v)) return [v.some(Boolean)];
    return [false];
  }
  if (f === "all") {
    if (Array.isArray(v)) return [v.every(Boolean)];
    return [true];
  }
  if (f === "group_by") {
    // Basic implementation - needs argument
    if (Array.isArray(v)) return [[v]];
    return [null];
  }
  if (f === "unique_by") {
    if (Array.isArray(v)) return [v];
    return [null];
  }
  if (f === "join") {
    // Needs argument
    if (Array.isArray(v)) return [v.join("")];
    return [null];
  }
  if (f === "splits" || f === "split") {
    // Needs argument
    if (typeof v === "string") return [[v]];
    return [null];
  }
  if (f === "ascii_downcase" || f === "ascii_upcase") {
    if (typeof v === "string") {
      return [f === "ascii_downcase" ? v.toLowerCase() : v.toUpperCase()];
    }
    return [null];
  }
  if (f === "ltrimstr" || f === "rtrimstr") {
    // Needs argument
    return [v];
  }
  if (f === "startswith" || f === "endswith") {
    // Needs argument
    return [false];
  }
  if (f === "contains") {
    // Needs argument
    return [false];
  }
  if (f === "inside") {
    // Needs argument
    return [false];
  }
  if (f === "indices") {
    // Needs argument
    return [[]];
  }
  if (f === "index" || f === "rindex") {
    // Needs argument
    return [null];
  }
  if (f === "test" || f === "match" || f === "capture") {
    // Needs argument
    return [null];
  }
  if (f === "floor") {
    if (typeof v === "number") return [Math.floor(v)];
    return [null];
  }
  if (f === "ceil") {
    if (typeof v === "number") return [Math.ceil(v)];
    return [null];
  }
  if (f === "round") {
    if (typeof v === "number") return [Math.round(v)];
    return [null];
  }
  if (f === "sqrt") {
    if (typeof v === "number") return [Math.sqrt(v)];
    return [null];
  }
  if (f === "fabs" || f === "abs") {
    if (typeof v === "number") return [Math.abs(v)];
    return [null];
  }
  if (f === "tostring") {
    if (typeof v === "string") return [v];
    return [JSON.stringify(v)];
  }
  if (f === "tonumber") {
    if (typeof v === "number") return [v];
    if (typeof v === "string") {
      const n = Number(v);
      return [Number.isNaN(n) ? null : n];
    }
    return [null];
  }
  if (f === "infinite") {
    return [!Number.isFinite(v as number)];
  }
  if (f === "nan") {
    return [Number.isNaN(v as number)];
  }
  if (f === "isinfinite") {
    return [typeof v === "number" && !Number.isFinite(v)];
  }
  if (f === "isnan") {
    return [typeof v === "number" && Number.isNaN(v)];
  }
  if (f === "isnormal") {
    return [typeof v === "number" && Number.isFinite(v) && v !== 0];
  }
  if (f === "env") {
    return [{}]; // No env access in sandbox
  }
  if (f === "now") {
    return [Date.now() / 1000];
  }

  // Handle recursive descent ..
  if (f === "..") {
    const results: JqValue[] = [];
    const walk = (val: JqValue) => {
      results.push(val);
      if (Array.isArray(val)) {
        for (const item of val) {
          walk(item);
        }
      } else if (val && typeof val === "object") {
        for (const key of Object.keys(val)) {
          walk((val as Record<string, unknown>)[key]);
        }
      }
    };
    walk(v);
    return results;
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
