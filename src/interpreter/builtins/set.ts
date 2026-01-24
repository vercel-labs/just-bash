/**
 * set - Set/unset shell options builtin
 *
 * In POSIX mode (set -o posix), errors from set (like invalid options)
 * cause the script to exit immediately.
 */

import type { ExecResult } from "../../types.js";
import { PosixFatalError } from "../errors.js";
import { getArrayIndices } from "../helpers/array.js";
import { failure, OK, success } from "../helpers/result.js";
import { updateShellopts } from "../helpers/shellopts.js";
import type { InterpreterContext, ShellOptions } from "../types.js";

/**
 * Check if a character needs $'...' quoting (control characters, non-printable)
 */
function needsDollarQuoting(value: string): boolean {
  // Check for any character that requires $'...' quoting:
  // - Control characters (0x00-0x1F, 0x7F)
  // - High bytes (0x80-0xFF)
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || code > 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Quote a value for shell output using $'...' quoting (bash ANSI-C quoting)
 */
function dollarQuote(value: string): string {
  let result = "$'";
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    const code = value.charCodeAt(i);

    if (code === 0x07) {
      result += "\\a"; // bell
    } else if (code === 0x08) {
      result += "\\b"; // backspace
    } else if (code === 0x09) {
      result += "\\t"; // tab
    } else if (code === 0x0a) {
      result += "\\n"; // newline
    } else if (code === 0x0b) {
      result += "\\v"; // vertical tab
    } else if (code === 0x0c) {
      result += "\\f"; // form feed
    } else if (code === 0x0d) {
      result += "\\r"; // carriage return
    } else if (code === 0x1b) {
      result += "\\e"; // escape (bash extension)
    } else if (code === 0x27) {
      result += "\\'"; // single quote
    } else if (code === 0x5c) {
      result += "\\\\"; // backslash
    } else if (code < 0x20 || code === 0x7f) {
      // Other control characters: use octal notation (bash uses \NNN)
      result += `\\${code.toString(8).padStart(3, "0")}`;
    } else if (code > 0x7f && code <= 0xff) {
      // High bytes: use octal
      result += `\\${code.toString(8).padStart(3, "0")}`;
    } else {
      result += char;
    }
  }
  result += "'";
  return result;
}

/**
 * Quote a value for shell output (used by 'set' with no args)
 * Matches bash's output format:
 * - No quotes for simple alphanumeric values
 * - Single quotes for values with spaces or shell metacharacters
 * - $'...' quoting for values with control characters
 */
function quoteValue(value: string): string {
  // If value contains control characters or non-printable, use $'...' quoting
  if (needsDollarQuoting(value)) {
    return dollarQuote(value);
  }

  // If value contains no special chars, return as-is
  // Safe chars: alphanumerics, underscore, slash, dot, colon, hyphen, at, percent, plus, comma, equals
  if (/^[a-zA-Z0-9_/.:\-@%+,=]*$/.test(value)) {
    return value;
  }

  // Use single quotes for values with spaces or shell metacharacters
  // Escape embedded single quotes as '\''
  return `'${value.replace(/'/g, "'\\''")}'`;
}

const SET_USAGE = `set: usage: set [-eux] [+eux] [-o option] [+o option]
Options:
  -e            Exit immediately if a command exits with non-zero status
  +e            Disable -e
  -u            Treat unset variables as an error when substituting
  +u            Disable -u
  -x            Print commands and their arguments as they are executed
  +x            Disable -x
  -o errexit    Same as -e
  +o errexit    Disable errexit
  -o nounset    Same as -u
  +o nounset    Disable nounset
  -o pipefail   Return status of last failing command in pipeline
  +o pipefail   Disable pipefail
  -o xtrace     Same as -x
  +o xtrace     Disable xtrace
`;

// Map short options to their corresponding shell option property
// Options not in this map are valid but no-ops
const SHORT_OPTION_MAP: Record<string, keyof ShellOptions | null> = {
  e: "errexit",
  u: "nounset",
  x: "xtrace",
  v: "verbose",
  // Implemented options
  f: "noglob",
  C: "noclobber",
  a: "allexport",
  n: "noexec",
  // No-ops (accepted for compatibility)
  h: null,
  b: null,
  m: null,
  B: null,
  H: null,
  P: null,
  T: null,
  E: null,
  p: null,
};

// Map long options to their corresponding shell option property
// Options not mapped to a property are valid but no-ops
const LONG_OPTION_MAP: Record<string, keyof ShellOptions | null> = {
  errexit: "errexit",
  pipefail: "pipefail",
  nounset: "nounset",
  xtrace: "xtrace",
  verbose: "verbose",
  // Implemented options
  noclobber: "noclobber",
  noglob: "noglob",
  allexport: "allexport",
  noexec: "noexec",
  // No-ops (accepted for compatibility)
  notify: null,
  monitor: null,
  braceexpand: null,
  histexpand: null,
  physical: null,
  functrace: null,
  errtrace: null,
  privileged: null,
  hashall: null,
  posix: "posix",
  vi: null,
  emacs: null,
  ignoreeof: null,
  "interactive-comments": null,
  keyword: null,
  onecmd: null,
};

// List of implemented options to display in `set -o` / `set +o` output
const DISPLAY_OPTIONS: (keyof ShellOptions)[] = [
  "errexit",
  "nounset",
  "pipefail",
  "verbose",
  "xtrace",
  "posix",
  "allexport",
  "noclobber",
  "noglob",
  "noexec",
];

// List of no-op options to display (always off, for compatibility)
const NOOP_DISPLAY_OPTIONS: string[] = [
  "braceexpand",
  "emacs",
  "errtrace",
  "functrace",
  "hashall",
  "histexpand",
  "history",
  "ignoreeof",
  "interactive-comments",
  "keyword",
  "monitor",
  "nolog",
  "notify",
  "onecmd",
  "physical",
  "privileged",
  "vi",
];

/**
 * Set a shell option value using the option map.
 * Also updates the SHELLOPTS environment variable.
 */
function setShellOption(
  ctx: InterpreterContext,
  optionKey: keyof ShellOptions | null,
  value: boolean,
): void {
  if (optionKey !== null) {
    ctx.state.options[optionKey] = value;
    updateShellopts(ctx);
  }
}

/**
 * Check if the next argument exists and is not an option flag
 */
function hasNonOptionArg(args: string[], i: number): boolean {
  return (
    i + 1 < args.length &&
    !args[i + 1].startsWith("-") &&
    !args[i + 1].startsWith("+")
  );
}

/**
 * Quote a value for array element output (always uses double quotes)
 */
function quoteArrayValue(value: string): string {
  // If value needs $'...' quoting, use it inside the double quotes context
  if (needsDollarQuoting(value)) {
    return dollarQuote(value);
  }
  // For array elements, bash always uses double quotes
  // Escape backslashes and double quotes
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Format an array variable for set output
 * Format: arr=([0]="a" [1]="b" [2]="c")
 */
function formatArrayOutput(ctx: InterpreterContext, arrayName: string): string {
  const indices = getArrayIndices(ctx, arrayName);
  if (indices.length === 0) {
    return `${arrayName}=()`;
  }

  const elements = indices.map((i) => {
    const value = ctx.state.env[`${arrayName}_${i}`] ?? "";
    return `[${i}]=${quoteArrayValue(value)}`;
  });

  return `${arrayName}=(${elements.join(" ")})`;
}

/**
 * Get all array names from the environment
 */
function getArrayNames(ctx: InterpreterContext): Set<string> {
  const arrayNames = new Set<string>();
  for (const key of Object.keys(ctx.state.env)) {
    // Match array element pattern: name_index where index is numeric
    const match = key.match(/^([a-zA-Z_][a-zA-Z0-9_]*)_(\d+)$/);
    if (match) {
      arrayNames.add(match[1]);
    }
  }
  return arrayNames;
}

export function handleSet(ctx: InterpreterContext, args: string[]): ExecResult {
  if (args.includes("--help")) {
    return success(SET_USAGE);
  }

  // With no arguments, print all shell variables
  if (args.length === 0) {
    const arrayNames = getArrayNames(ctx);

    // Collect scalar variables (excluding array elements like name_0)
    const scalarEntries: [string, string][] = [];
    for (const [key, value] of Object.entries(ctx.state.env)) {
      // Only valid variable names (no underscores followed by digits or __metadata)
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        continue;
      }
      // Skip if this is actually an array (has array elements)
      if (arrayNames.has(key)) {
        continue;
      }
      scalarEntries.push([key, value]);
    }

    // Build output: scalars first, then arrays
    const lines: string[] = [];

    // Add scalar variables
    for (const [key, value] of scalarEntries.sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      lines.push(`${key}=${quoteValue(value)}`);
    }

    // Add arrays
    for (const arrayName of [...arrayNames].sort()) {
      lines.push(formatArrayOutput(ctx, arrayName));
    }

    // Sort all lines together (bash outputs in sorted order)
    lines.sort((a, b) => {
      // Extract variable name for comparison
      const nameA = a.split("=")[0];
      const nameB = b.split("=")[0];
      return nameA.localeCompare(nameB);
    });

    return success(lines.length > 0 ? `${lines.join("\n")}\n` : "");
  }

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Handle -o / +o with option name
    if ((arg === "-o" || arg === "+o") && hasNonOptionArg(args, i)) {
      const optName = args[i + 1];
      if (!(optName in LONG_OPTION_MAP)) {
        const errorMsg = `bash: set: ${optName}: invalid option name\n${SET_USAGE}`;
        // In POSIX mode, invalid option is fatal
        if (ctx.state.options.posix) {
          throw new PosixFatalError(1, "", errorMsg);
        }
        return failure(errorMsg);
      }
      setShellOption(ctx, LONG_OPTION_MAP[optName], arg === "-o");
      i += 2;
      continue;
    }

    // Handle -o alone (print current settings)
    if (arg === "-o") {
      const implementedOutput = DISPLAY_OPTIONS.map(
        (opt) => `${opt.padEnd(16)}${ctx.state.options[opt] ? "on" : "off"}`,
      );
      const noopOutput = NOOP_DISPLAY_OPTIONS.map(
        (opt) => `${opt.padEnd(16)}off`,
      );
      const allOptions = [...implementedOutput, ...noopOutput].sort();
      return success(`${allOptions.join("\n")}\n`);
    }

    // Handle +o alone (print commands to recreate settings)
    if (arg === "+o") {
      const implementedOutput = DISPLAY_OPTIONS.map(
        (opt) => `set ${ctx.state.options[opt] ? "-o" : "+o"} ${opt}`,
      );
      const noopOutput = NOOP_DISPLAY_OPTIONS.map((opt) => `set +o ${opt}`);
      const allOptions = [...implementedOutput, ...noopOutput].sort();
      return success(`${allOptions.join("\n")}\n`);
    }

    // Handle combined short flags like -eu or +eu
    if (
      arg.length > 1 &&
      (arg[0] === "-" || arg[0] === "+") &&
      arg[1] !== "-"
    ) {
      const enable = arg[0] === "-";
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];
        if (!(flag in SHORT_OPTION_MAP)) {
          const errorMsg = `bash: set: ${arg[0]}${flag}: invalid option\n${SET_USAGE}`;
          // In POSIX mode, invalid option is fatal
          if (ctx.state.options.posix) {
            throw new PosixFatalError(1, "", errorMsg);
          }
          return failure(errorMsg);
        }
        setShellOption(ctx, SHORT_OPTION_MAP[flag], enable);
      }
      i++;
      continue;
    }

    // Handle -- (end of options)
    if (arg === "--") {
      setPositionalParameters(ctx, args.slice(i + 1));
      return OK;
    }

    // Handle - (disable xtrace and verbose, end of options)
    if (arg === "-") {
      ctx.state.options.xtrace = false;
      ctx.state.options.verbose = false;
      updateShellopts(ctx);
      if (i + 1 < args.length) {
        setPositionalParameters(ctx, args.slice(i + 1));
        return OK;
      }
      i++;
      continue;
    }

    // Handle + (single + is ignored, continue processing options)
    if (arg === "+") {
      i++;
      continue;
    }

    // Invalid option
    if (arg.startsWith("-") || arg.startsWith("+")) {
      const errorMsg = `bash: set: ${arg}: invalid option\n${SET_USAGE}`;
      // In POSIX mode, invalid option is fatal
      if (ctx.state.options.posix) {
        throw new PosixFatalError(1, "", errorMsg);
      }
      return failure(errorMsg);
    }

    // Non-option arguments are positional parameters
    setPositionalParameters(ctx, args.slice(i));
    return OK;
  }

  return OK;
}

/**
 * Set positional parameters ($1, $2, etc.) and update $@, $*, $#
 */
function setPositionalParameters(
  ctx: InterpreterContext,
  params: string[],
): void {
  // Clear existing positional parameters
  let i = 1;
  while (ctx.state.env[String(i)] !== undefined) {
    delete ctx.state.env[String(i)];
    i++;
  }

  // Set new positional parameters
  for (let j = 0; j < params.length; j++) {
    ctx.state.env[String(j + 1)] = params[j];
  }

  // Update $# (number of parameters)
  ctx.state.env["#"] = String(params.length);

  // Update $@ and $* (all parameters)
  ctx.state.env["@"] = params.join(" ");
  ctx.state.env["*"] = params.join(" ");
}
