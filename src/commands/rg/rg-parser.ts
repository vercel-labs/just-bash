/**
 * Argument parsing for rg command - Declarative approach
 */

import type { ExecResult } from "../../types.js";
import { unknownOption } from "../help.js";
import { FILE_TYPES } from "./file-types.js";
import { createDefaultOptions, type RgOptions } from "./rg-options.js";

export interface ParseResult {
  success: true;
  options: RgOptions;
  paths: string[];
  explicitLineNumbers: boolean;
}

export interface ParseError {
  success: false;
  error: ExecResult;
}

export type ParseArgsResult = ParseResult | ParseError;

/**
 * Validate a file type name
 */
function validateType(typeName: string): ExecResult | null {
  if (!FILE_TYPES[typeName]) {
    return {
      stdout: "",
      stderr: `rg: unknown type: ${typeName}\nUse --type-list to see available types.\n`,
      exitCode: 1,
    };
  }
  return null;
}

// Declarative value option definitions
interface ValueOptDef {
  short?: string;
  long: string;
  target: keyof RgOptions;
  multi?: boolean;
  parse?: (val: string) => number;
  validate?: (val: string) => ExecResult | null;
}

const VALUE_OPTS: ValueOptDef[] = [
  { short: "g", long: "glob", target: "globs", multi: true },
  {
    short: "t",
    long: "type",
    target: "types",
    multi: true,
    validate: validateType,
  },
  {
    short: "T",
    long: "type-not",
    target: "typesNot",
    multi: true,
    validate: validateType,
  },
  { short: "m", long: "max-count", target: "maxCount", parse: parseInt },
  { short: "e", long: "regexp", target: "patterns", multi: true },
  { short: "f", long: "file", target: "patternFiles", multi: true },
  { short: "r", long: "replace", target: "replace" },
  { long: "max-depth", target: "maxDepth", parse: parseInt },
  { long: "context-separator", target: "contextSeparator" },
];

// Declarative boolean flag definitions
type BoolFlagHandler = (options: RgOptions) => void;

const BOOL_FLAGS: Record<string, BoolFlagHandler> = {
  // Case sensitivity
  i: (o) => {
    o.ignoreCase = true;
    o.caseSensitive = false;
    o.smartCase = false;
  },
  "--ignore-case": (o) => {
    o.ignoreCase = true;
    o.caseSensitive = false;
    o.smartCase = false;
  },
  s: (o) => {
    o.caseSensitive = true;
    o.ignoreCase = false;
    o.smartCase = false;
  },
  "--case-sensitive": (o) => {
    o.caseSensitive = true;
    o.ignoreCase = false;
    o.smartCase = false;
  },
  S: (o) => {
    o.smartCase = true;
    o.ignoreCase = false;
    o.caseSensitive = false;
  },
  "--smart-case": (o) => {
    o.smartCase = true;
    o.ignoreCase = false;
    o.caseSensitive = false;
  },

  // Pattern matching
  F: (o) => {
    o.fixedStrings = true;
  },
  "--fixed-strings": (o) => {
    o.fixedStrings = true;
  },
  w: (o) => {
    o.wordRegexp = true;
  },
  "--word-regexp": (o) => {
    o.wordRegexp = true;
  },
  x: (o) => {
    o.lineRegexp = true;
  },
  "--line-regexp": (o) => {
    o.lineRegexp = true;
  },
  v: (o) => {
    o.invertMatch = true;
  },
  "--invert-match": (o) => {
    o.invertMatch = true;
  },
  U: (o) => {
    o.multiline = true;
  },
  "--multiline": (o) => {
    o.multiline = true;
  },

  // Output modes
  c: (o) => {
    o.count = true;
  },
  "--count": (o) => {
    o.count = true;
  },
  "--count-matches": (o) => {
    o.countMatches = true;
  },
  l: (o) => {
    o.filesWithMatches = true;
  },
  "--files-with-matches": (o) => {
    o.filesWithMatches = true;
  },
  "--files-without-match": (o) => {
    o.filesWithoutMatch = true;
  },
  o: (o) => {
    o.onlyMatching = true;
  },
  "--only-matching": (o) => {
    o.onlyMatching = true;
  },
  q: (o) => {
    o.quiet = true;
  },
  "--quiet": (o) => {
    o.quiet = true;
  },

  // Line numbers
  N: (o) => {
    o.lineNumber = false;
  },
  "--no-line-number": (o) => {
    o.lineNumber = false;
  },

  // Filename display
  I: (o) => {
    o.noFilename = true;
  },
  "--no-filename": (o) => {
    o.noFilename = true;
  },
  "0": (o) => {
    o.nullSeparator = true;
  },
  "--null": (o) => {
    o.nullSeparator = true;
  },

  // Column and byte offset
  b: (o) => {
    o.byteOffset = true;
  },
  "--byte-offset": (o) => {
    o.byteOffset = true;
  },
  "--column": (o) => {
    o.column = true;
    o.lineNumber = true;
  },
  "--vimgrep": (o) => {
    o.vimgrep = true;
    o.column = true;
    o.lineNumber = true;
  },
  "--json": (o) => {
    o.json = true;
  },

  // File selection
  "--hidden": (o) => {
    o.hidden = true;
  },
  "--no-ignore": (o) => {
    o.noIgnore = true;
  },
  L: (o) => {
    o.followSymlinks = true;
  },
  "--follow": (o) => {
    o.followSymlinks = true;
  },
  z: (o) => {
    o.searchZip = true;
  },
  "--search-zip": (o) => {
    o.searchZip = true;
  },
  a: (o) => {
    o.searchBinary = true;
  },
  "--text": (o) => {
    o.searchBinary = true;
  },

  // Output formatting
  "--heading": (o) => {
    o.heading = true;
  },
  "--passthru": (o) => {
    o.passthru = true;
  },
  "--include-zero": (o) => {
    o.includeZero = true;
  },
};

// Special flags that return a value indicating line number was explicitly set
const LINE_NUMBER_FLAGS = new Set(["n", "--line-number"]);

// Handle unrestricted mode (-u, -uu, -uuu)
function handleUnrestricted(options: RgOptions): void {
  if (options.hidden) {
    options.searchBinary = true;
  } else if (options.noIgnore) {
    options.hidden = true;
  } else {
    options.noIgnore = true;
  }
}

/**
 * Try to parse a value option, returning the new index if matched
 */
function tryParseValueOpt(
  args: string[],
  i: number,
  options: RgOptions,
): { newIndex: number; error?: ExecResult } | null {
  const arg = args[i];

  for (const def of VALUE_OPTS) {
    // Check --long=VALUE form
    if (arg.startsWith(`--${def.long}=`)) {
      const value = arg.slice(`--${def.long}=`.length);
      const error = applyValueOpt(options, def, value);
      if (error) return { newIndex: i, error };
      return { newIndex: i };
    }

    // Check -x VALUE or --long VALUE form
    if ((def.short && arg === `-${def.short}`) || arg === `--${def.long}`) {
      if (i + 1 >= args.length) return null;
      const value = args[i + 1];
      const error = applyValueOpt(options, def, value);
      if (error) return { newIndex: i + 1, error };
      return { newIndex: i + 1 };
    }
  }

  return null;
}

/**
 * Apply a value option to options object
 */
function applyValueOpt(
  options: RgOptions,
  def: ValueOptDef,
  value: string,
): ExecResult | undefined {
  if (def.validate) {
    const error = def.validate(value);
    if (error) return error;
  }

  const parsed = def.parse ? def.parse(value) : value;

  if (def.multi) {
    (options[def.target] as string[]).push(parsed as string);
  } else {
    (options[def.target] as string | number | null) = parsed;
  }
  return undefined;
}

/**
 * Parse sort option
 */
function parseSort(
  args: string[],
  i: number,
): { value: "path" | "none"; newIndex: number } | null {
  const arg = args[i];

  if (arg === "--sort" && i + 1 < args.length) {
    const val = args[i + 1];
    if (val === "path" || val === "none") {
      return { value: val, newIndex: i + 1 };
    }
  }

  if (arg.startsWith("--sort=")) {
    const val = arg.slice("--sort=".length);
    if (val === "path" || val === "none") {
      return { value: val, newIndex: i };
    }
  }

  return null;
}

/**
 * Parse context flag (-A, -B, -C)
 */
function parseContextFlag(
  args: string[],
  i: number,
): { flag: "A" | "B" | "C"; value: number; newIndex: number } | null {
  const arg = args[i];

  // -A2, -B3, -C1 form
  const attached = arg.match(/^-([ABC])(\d+)$/);
  if (attached) {
    return {
      flag: attached[1] as "A" | "B" | "C",
      value: parseInt(attached[2], 10),
      newIndex: i,
    };
  }

  // -A 2, -B 3, -C 1 form
  if ((arg === "-A" || arg === "-B" || arg === "-C") && i + 1 < args.length) {
    return {
      flag: arg[1] as "A" | "B" | "C",
      value: parseInt(args[i + 1], 10),
      newIndex: i + 1,
    };
  }

  return null;
}

/**
 * Parse max-count with attached number (-m2)
 */
function parseMaxCountAttached(arg: string): number | null {
  const match = arg.match(/^-m(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Parse rg command arguments
 */
export function parseArgs(args: string[]): ParseArgsResult {
  const options = createDefaultOptions();
  let positionalPattern: string | null = null;
  const paths: string[] = [];

  // Context tracking with MAX precedence
  let explicitA = -1;
  let explicitB = -1;
  let explicitC = -1;
  let explicitLineNumbers = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("-") && arg !== "-") {
      // Try context flags first (-A, -B, -C)
      const contextResult = parseContextFlag(args, i);
      if (contextResult) {
        const { flag, value, newIndex } = contextResult;
        if (flag === "A") explicitA = Math.max(explicitA, value);
        else if (flag === "B") explicitB = Math.max(explicitB, value);
        else explicitC = value; // -C overwrites, doesn't max
        i = newIndex;
        continue;
      }

      // Try max-count with attached number (-m2)
      const maxCountNum = parseMaxCountAttached(arg);
      if (maxCountNum !== null) {
        options.maxCount = maxCountNum;
        continue;
      }

      // Try value options
      const valueResult = tryParseValueOpt(args, i, options);
      if (valueResult) {
        if (valueResult.error) {
          return { success: false, error: valueResult.error };
        }
        i = valueResult.newIndex;
        continue;
      }

      // Try sort option
      const sortResult = parseSort(args, i);
      if (sortResult) {
        options.sort = sortResult.value;
        i = sortResult.newIndex;
        continue;
      }

      // Parse boolean flags (handles both --flag and -xyz combined)
      const flags = arg.startsWith("--") ? [arg] : arg.slice(1).split("");

      for (const flag of flags) {
        // Check for line number flags (special case that returns a value)
        if (LINE_NUMBER_FLAGS.has(flag)) {
          options.lineNumber = true;
          explicitLineNumbers = true;
          continue;
        }

        // Check for unrestricted mode
        if (flag === "u" || flag === "--unrestricted") {
          handleUnrestricted(options);
          continue;
        }

        // Try boolean flags
        const handler = BOOL_FLAGS[flag];
        if (handler) {
          handler(options);
          continue;
        }

        // Unknown flag
        if (flag.startsWith("--")) {
          return { success: false, error: unknownOption("rg", flag) };
        }
        if (flag.length === 1) {
          return { success: false, error: unknownOption("rg", `-${flag}`) };
        }
      }
    } else if (positionalPattern === null) {
      positionalPattern = arg;
    } else {
      paths.push(arg);
    }
  }

  // Resolve context values with MAX precedence
  if (explicitA >= 0 || explicitC >= 0) {
    options.afterContext = Math.max(
      explicitA >= 0 ? explicitA : 0,
      explicitC >= 0 ? explicitC : 0,
    );
  }
  if (explicitB >= 0 || explicitC >= 0) {
    options.beforeContext = Math.max(
      explicitB >= 0 ? explicitB : 0,
      explicitC >= 0 ? explicitC : 0,
    );
  }

  // Add positional pattern
  if (positionalPattern !== null) {
    options.patterns.push(positionalPattern);
  }

  // --column and --vimgrep imply line numbers
  if (options.column || options.vimgrep) {
    explicitLineNumbers = true;
  }

  return {
    success: true,
    options,
    paths,
    explicitLineNumbers,
  };
}
