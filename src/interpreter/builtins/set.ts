/**
 * set - Set/unset shell options builtin
 */

import type { ExecResult } from "../../types.js";
import { failure, OK, success } from "../helpers/result.js";
import type { InterpreterContext, ShellOptions } from "../types.js";

/**
 * Quote a value for shell output (used by 'set' with no args)
 */
function quoteValue(value: string): string {
  // If value contains no special chars, return as-is
  if (/^[a-zA-Z0-9_/.:-]*$/.test(value)) {
    return value;
  }
  // Use single quotes, escaping any single quotes in the value
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
  // No-ops (accepted for compatibility)
  f: null,
  h: null,
  C: null,
  n: null,
  a: null,
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
  // No-ops (accepted for compatibility)
  noclobber: null,
  noglob: null,
  noexec: null,
  allexport: null,
  notify: null,
  monitor: null,
  braceexpand: null,
  histexpand: null,
  physical: null,
  functrace: null,
  errtrace: null,
  privileged: null,
  hashall: null,
  posix: null,
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
];

// List of no-op options to display (always off, for compatibility)
const NOOP_DISPLAY_OPTIONS: string[] = [
  "allexport",
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
  "noclobber",
  "noexec",
  "noglob",
  "nolog",
  "notify",
  "onecmd",
  "physical",
  "posix",
  "privileged",
  "vi",
];

/**
 * Set a shell option value using the option map
 */
function setShellOption(
  ctx: InterpreterContext,
  optionKey: keyof ShellOptions | null,
  value: boolean,
): void {
  if (optionKey !== null) {
    ctx.state.options[optionKey] = value;
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

export function handleSet(ctx: InterpreterContext, args: string[]): ExecResult {
  if (args.includes("--help")) {
    return success(SET_USAGE);
  }

  // With no arguments, print all shell variables
  if (args.length === 0) {
    const output = Object.entries(ctx.state.env)
      .filter(([key]) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) // Only valid variable names
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${quoteValue(value)}`)
      .join("\n");
    return success(output ? `${output}\n` : "");
  }

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Handle -o / +o with option name
    if ((arg === "-o" || arg === "+o") && hasNonOptionArg(args, i)) {
      const optName = args[i + 1];
      if (!(optName in LONG_OPTION_MAP)) {
        return failure(
          `bash: set: ${optName}: invalid option name\n${SET_USAGE}`,
        );
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
          return failure(
            `bash: set: ${arg[0]}${flag}: invalid option\n${SET_USAGE}`,
          );
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
      return failure(`bash: set: ${arg}: invalid option\n${SET_USAGE}`);
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
