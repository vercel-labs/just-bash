/**
 * set - Set/unset shell options builtin
 *
 * In POSIX mode (set -o posix), errors from set (like invalid options)
 * cause the script to exit immediately.
 */

import type { ExecResult } from "../../types.js";
import { PosixFatalError } from "../errors.js";
import { getArrayIndices, getAssocArrayKeys } from "../helpers/array.js";
import { quoteArrayValue, quoteValue } from "../helpers/quoting.js";
import { failure, OK, success } from "../helpers/result.js";
import { updateShellopts } from "../helpers/shellopts.js";
import type { InterpreterContext, ShellOptions } from "../types.js";

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
const SHORT_OPTION_MAP = new Map<string, keyof ShellOptions | null>([
  ["e", "errexit"],
  ["u", "nounset"],
  ["x", "xtrace"],
  ["v", "verbose"],
  // Implemented options
  ["f", "noglob"],
  ["C", "noclobber"],
  ["a", "allexport"],
  ["n", "noexec"],
  // No-ops (accepted for compatibility)
  ["h", null],
  ["b", null],
  ["m", null],
  ["B", null],
  ["H", null],
  ["P", null],
  ["T", null],
  ["E", null],
  ["p", null],
]);

// Map long options to their corresponding shell option property
// Options not mapped to a property are valid but no-ops
const LONG_OPTION_MAP = new Map<string, keyof ShellOptions | null>([
  ["errexit", "errexit"],
  ["pipefail", "pipefail"],
  ["nounset", "nounset"],
  ["xtrace", "xtrace"],
  ["verbose", "verbose"],
  // Implemented options
  ["noclobber", "noclobber"],
  ["noglob", "noglob"],
  ["allexport", "allexport"],
  ["noexec", "noexec"],
  ["posix", "posix"],
  ["vi", "vi"],
  ["emacs", "emacs"],
  // No-ops (accepted for compatibility)
  ["notify", null],
  ["monitor", null],
  ["braceexpand", null],
  ["histexpand", null],
  ["physical", null],
  ["functrace", null],
  ["errtrace", null],
  ["privileged", null],
  ["hashall", null],
  ["ignoreeof", null],
  ["interactive-comments", null],
  ["keyword", null],
  ["onecmd", null],
]);

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
  "vi",
  "emacs",
];

// List of no-op options to display (always off, for compatibility)
const NOOP_DISPLAY_OPTIONS: string[] = [
  "braceexpand",
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
];

/**
 * Set a shell option value using the option map.
 * Also updates the SHELLOPTS environment variable.
 * Handles mutual exclusivity for vi/emacs options.
 */
function setShellOption(
  ctx: InterpreterContext,
  optionKey: keyof ShellOptions | null,
  value: boolean,
): void {
  if (optionKey !== null) {
    // Handle mutual exclusivity of vi and emacs
    if (value) {
      if (optionKey === "vi") {
        ctx.state.options.emacs = false;
      } else if (optionKey === "emacs") {
        ctx.state.options.vi = false;
      }
    }
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
 * Format an array variable for set output
 * Format: arr=([0]="a" [1]="b" [2]="c")
 */
function formatArrayOutput(ctx: InterpreterContext, arrayName: string): string {
  const indices = getArrayIndices(ctx, arrayName);
  if (indices.length === 0) {
    return `${arrayName}=()`;
  }

  const elements = indices.map((i) => {
    const value = ctx.state.env.get(`${arrayName}_${i}`) ?? "";
    return `[${i}]=${quoteArrayValue(value)}`;
  });

  return `${arrayName}=(${elements.join(" ")})`;
}

/**
 * Quote a key for associative array output
 * Keys with spaces or special characters are quoted with double quotes
 */
function quoteAssocKey(key: string): string {
  // If key contains no special chars, return as-is
  // Safe chars: alphanumerics, underscore
  if (/^[a-zA-Z0-9_]+$/.test(key)) {
    return key;
  }
  // Use double quotes for keys with spaces or shell metacharacters
  // Escape backslashes and double quotes
  const escaped = key.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Format an associative array variable for set output
 * Format: arr=([key1]="val1" [key2]="val2" )
 * Note: bash adds a trailing space before the closing paren
 */
function formatAssocArrayOutput(
  ctx: InterpreterContext,
  arrayName: string,
): string {
  const keys = getAssocArrayKeys(ctx, arrayName);
  if (keys.length === 0) {
    return `${arrayName}=()`;
  }

  const elements = keys.map((k) => {
    const value = ctx.state.env.get(`${arrayName}_${k}`) ?? "";
    return `[${quoteAssocKey(k)}]=${quoteArrayValue(value)}`;
  });

  // Note: bash has a trailing space before the closing paren for assoc arrays
  return `${arrayName}=(${elements.join(" ")} )`;
}

/**
 * Get all indexed array names from the environment (excluding associative arrays)
 */
function getIndexedArrayNames(ctx: InterpreterContext): Set<string> {
  const arrayNames = new Set<string>();
  const assocArrays = ctx.state.associativeArrays ?? new Set<string>();

  for (const key of ctx.state.env.keys()) {
    // Match array element pattern: name_index where index is numeric
    const match = key.match(/^([a-zA-Z_][a-zA-Z0-9_]*)_(\d+)$/);
    if (match) {
      const name = match[1];
      // Exclude associative arrays - they're handled separately
      if (!assocArrays.has(name)) {
        arrayNames.add(name);
      }
    }
  }
  return arrayNames;
}

/**
 * Get all associative array names from state
 */
function getAssocArrayNames(ctx: InterpreterContext): Set<string> {
  return ctx.state.associativeArrays ?? new Set<string>();
}

/**
 * Format the `set -o` listing (one option per line, "<name>  on|off").
 */
function formatOptionsList(ctx: InterpreterContext): string {
  const implementedOutput = DISPLAY_OPTIONS.map(
    (opt) => `${opt.padEnd(16)}${ctx.state.options[opt] ? "on" : "off"}`,
  );
  const noopOutput = NOOP_DISPLAY_OPTIONS.map((opt) => `${opt.padEnd(16)}off`);
  return `${[...implementedOutput, ...noopOutput].sort().join("\n")}\n`;
}

/**
 * Format the `set +o` listing (the `set -o <name>` / `set +o <name>`
 * commands needed to recreate the current option settings).
 */
function formatOptionsResetCommands(ctx: InterpreterContext): string {
  const implementedOutput = DISPLAY_OPTIONS.map(
    (opt) => `set ${ctx.state.options[opt] ? "-o" : "+o"} ${opt}`,
  );
  const noopOutput = NOOP_DISPLAY_OPTIONS.map((opt) => `set +o ${opt}`);
  return `${[...implementedOutput, ...noopOutput].sort().join("\n")}\n`;
}

export function handleSet(ctx: InterpreterContext, args: string[]): ExecResult {
  if (args.includes("--help")) {
    return success(SET_USAGE);
  }

  // With no arguments, print all shell variables
  if (args.length === 0) {
    const indexedArrayNames = getIndexedArrayNames(ctx);
    const assocArrayNames = getAssocArrayNames(ctx);

    // Helper function to check if a key is an element of any assoc array
    const isAssocArrayElement = (key: string): boolean => {
      for (const arrayName of assocArrayNames) {
        const prefix = `${arrayName}_`;
        const metadataSuffix = `${arrayName}__length`;
        // Skip metadata entries
        if (key === metadataSuffix) {
          continue;
        }
        if (key.startsWith(prefix)) {
          const elemKey = key.slice(prefix.length);
          // Skip if the key part starts with "_length" (metadata pattern)
          if (elemKey.startsWith("_length")) {
            continue;
          }
          return true;
        }
      }
      return false;
    };

    // Collect scalar variables (excluding array elements and internal metadata)
    const scalarEntries: [string, string][] = [];
    for (const [key, value] of ctx.state.env) {
      // Only valid variable names
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        continue;
      }
      // Skip if this is an indexed array (has array elements)
      if (indexedArrayNames.has(key)) {
        continue;
      }
      // Skip if this is an associative array
      if (assocArrayNames.has(key)) {
        continue;
      }
      // Skip indexed array element variables (name_index pattern where name is an indexed array)
      const arrayElementMatch = key.match(/^([a-zA-Z_][a-zA-Z0-9_]*)_(\d+)$/);
      if (arrayElementMatch && indexedArrayNames.has(arrayElementMatch[1])) {
        continue;
      }
      // Skip indexed array metadata variables (name__length pattern)
      const arrayMetadataMatch = key.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)__length$/,
      );
      if (arrayMetadataMatch && indexedArrayNames.has(arrayMetadataMatch[1])) {
        continue;
      }
      // Skip associative array element variables
      if (isAssocArrayElement(key)) {
        continue;
      }
      // Skip associative array metadata (name__length pattern for assoc arrays)
      if (arrayMetadataMatch && assocArrayNames.has(arrayMetadataMatch[1])) {
        continue;
      }
      scalarEntries.push([key, value]);
    }

    // Build output: scalars first, then arrays
    const lines: string[] = [];

    // Add scalar variables
    for (const [key, value] of scalarEntries.sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      lines.push(`${key}=${quoteValue(value)}`);
    }

    // Add indexed arrays (use ASCII sort order: uppercase before lowercase)
    for (const arrayName of [...indexedArrayNames].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      lines.push(formatArrayOutput(ctx, arrayName));
    }

    // Add associative arrays
    for (const arrayName of [...assocArrayNames].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      lines.push(formatAssocArrayOutput(ctx, arrayName));
    }

    // Sort all lines together (bash uses ASCII sort order: uppercase before lowercase)
    lines.sort((a, b) => {
      // Extract variable name for comparison
      const nameA = a.split("=")[0];
      const nameB = b.split("=")[0];
      return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
    });

    return success(lines.length > 0 ? `${lines.join("\n")}\n` : "");
  }

  // Listings emitted by a no-option-name `o` bundled in a short-flag cluster
  // (e.g. `set -oe`). bash prints the option listing but keeps applying the
  // rest of the flags, so the output is deferred and flushed once all flags
  // and tokens have been processed.
  const pendingListings: string[] = [];
  const finish = (): ExecResult =>
    pendingListings.length > 0 ? success(pendingListings.join("")) : OK;

  let i = 0;
  while (i < args.length) {
    const arg = args[i];

    // Handle -o / +o with option name
    if ((arg === "-o" || arg === "+o") && hasNonOptionArg(args, i)) {
      const optName = args[i + 1];
      if (!LONG_OPTION_MAP.has(optName)) {
        const errorMsg = `bash: set: ${optName}: invalid option name\n${SET_USAGE}`;
        // In POSIX mode, invalid option is fatal
        if (ctx.state.options.posix) {
          throw new PosixFatalError(1, "", errorMsg);
        }
        return failure(errorMsg);
      }
      setShellOption(ctx, LONG_OPTION_MAP.get(optName) ?? null, arg === "-o");
      i += 2;
      continue;
    }

    // Handle -o with no option name (print current settings). Like the
    // bundled form, bash prints the listing but keeps processing any following
    // tokens — e.g. `set -o -x` lists options and then enables xtrace — so the
    // listing is deferred and flushed at the end rather than returned here.
    if (arg === "-o") {
      pendingListings.push(formatOptionsList(ctx));
      i++;
      continue;
    }

    // Handle +o with no option name (print commands to recreate settings).
    if (arg === "+o") {
      pendingListings.push(formatOptionsResetCommands(ctx));
      i++;
      continue;
    }

    // Handle combined short flags like -eu or +eu, including a bundled
    // -o/+o long option (e.g. `set -euo pipefail`). In bash, an `o` inside
    // a cluster consumes the *next word* as its long-option name — so
    // `set -euo pipefail` is equivalent to `set -e -u -o pipefail`, and the
    // remaining characters of the token keep being parsed as short flags
    // (`set -oe pipefail` sets both pipefail and errexit). Multiple `o`s
    // consume successive words. The option name must be a non-option word: a
    // following `-`/`+`-prefixed token (e.g. `set -o -x`) is NOT consumed as
    // the name — bash then treats it as the "no name available" case. In that
    // case the `o` prints the current option settings (like a standalone
    // `-o`/`+o`) but does NOT stop flag processing — the remaining flags are
    // still applied, so `set -oe` (no name) enables errexit and lists options,
    // and `set -o -x` lists options and then enables xtrace.
    if (
      arg.length > 1 &&
      (arg[0] === "-" || arg[0] === "+") &&
      arg[1] !== "-"
    ) {
      const enable = arg[0] === "-";
      // Number of following words already consumed as -o/+o option names.
      let consumedArgs = 0;
      for (let j = 1; j < arg.length; j++) {
        const flag = arg[j];

        // `o` takes its option name from the next word, not from the
        // remaining characters of the current token.
        if (flag === "o") {
          const valueIndex = i + 1 + consumedArgs;
          const hasOptionName =
            valueIndex < args.length &&
            !args[valueIndex].startsWith("-") &&
            !args[valueIndex].startsWith("+");
          if (hasOptionName) {
            const optName = args[valueIndex];
            if (!LONG_OPTION_MAP.has(optName)) {
              const errorMsg = `bash: set: ${optName}: invalid option name\n${SET_USAGE}`;
              // In POSIX mode, invalid option is fatal
              if (ctx.state.options.posix) {
                throw new PosixFatalError(1, "", errorMsg);
              }
              return failure(errorMsg);
            }
            setShellOption(ctx, LONG_OPTION_MAP.get(optName) ?? null, enable);
            consumedArgs++;
            continue;
          }
          // No option name available: like a standalone `-o`/`+o`, bash prints
          // the option listing — a snapshot of the state *so far*, hence
          // computed here before later flags in the cluster are applied — but
          // it keeps processing the remaining flags, so e.g. `set -oe` still
          // enables errexit. The listing is deferred and flushed at the end.
          pendingListings.push(
            enable ? formatOptionsList(ctx) : formatOptionsResetCommands(ctx),
          );
          continue;
        }

        if (!SHORT_OPTION_MAP.has(flag)) {
          const errorMsg = `bash: set: ${arg[0]}${flag}: invalid option\n${SET_USAGE}`;
          // In POSIX mode, invalid option is fatal
          if (ctx.state.options.posix) {
            throw new PosixFatalError(1, "", errorMsg);
          }
          return failure(errorMsg);
        }
        setShellOption(ctx, SHORT_OPTION_MAP.get(flag) ?? null, enable);
      }
      i += 1 + consumedArgs;
      continue;
    }

    // Handle -- (end of options)
    if (arg === "--") {
      setPositionalParameters(ctx, args.slice(i + 1));
      return finish();
    }

    // Handle - (disable xtrace and verbose, end of options)
    if (arg === "-") {
      ctx.state.options.xtrace = false;
      ctx.state.options.verbose = false;
      updateShellopts(ctx);
      if (i + 1 < args.length) {
        setPositionalParameters(ctx, args.slice(i + 1));
        return finish();
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
    return finish();
  }

  return finish();
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
  while (ctx.state.env.has(String(i))) {
    ctx.state.env.delete(String(i));
    i++;
  }

  // Set new positional parameters
  for (let j = 0; j < params.length; j++) {
    ctx.state.env.set(String(j + 1), params[j]);
  }

  // Update $# (number of parameters)
  ctx.state.env.set("#", String(params.length));

  // Update $@ and $* (all parameters)
  ctx.state.env.set("@", params.join(" "));
  ctx.state.env.set("*", params.join(" "));

  // Note: bash does NOT reset OPTIND when positional parameters change.
  // This is intentional to match bash behavior.
}
