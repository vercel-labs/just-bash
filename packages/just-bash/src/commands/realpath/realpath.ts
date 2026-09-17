import { BoundedStringBuilder } from "../../bounded-builder.js";
import { FileTraversalBudget } from "../../fs/traversal.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { showHelp, unknownOption } from "../help.js";
import { nullPrototype } from "../query-engine/safe-object.js";
import {
  type CanonicalizeFailure,
  type CanonicalizeOptions,
  canonicalize,
} from "./canonicalize.js";
import { isUnder, relativeTo } from "./relative.js";

const realpathHelp = {
  name: "realpath",
  summary: "print the resolved absolute file name",
  usage: "realpath [OPTION]... FILE...",
  options: [
    "-e, --canonicalize-existing  all components of the path must exist",
    "-m, --canonicalize-missing   no component of the path need exist",
    "-L, --logical                resolve '..' components before symlinks",
    "-P, --physical               resolve symlinks as encountered (default)",
    "-q, --quiet                  suppress messages for missing files",
    "-s, --strip, --no-symlinks   don't expand symlinks",
    "-z, --zero                   end each output line with NUL, not newline",
    "    --relative-to=DIR        print the resolved path relative to DIR",
    "    --relative-base=DIR      print absolute paths unless below DIR",
    "    --help                   display this help and exit",
  ],
  notes: ["Without -e or -m every component but the last has to exist."],
};

const FAILURE_MESSAGES = nullPrototype<Record<CanonicalizeFailure, string>>({
  ENOENT: "No such file or directory",
  ENOTDIR: "Not a directory",
  ELOOP: "Too many levels of symbolic links",
  EACCES: "Permission denied",
});

interface ParsedArgs {
  options: CanonicalizeOptions;
  quiet: boolean;
  zero: boolean;
  relativeTo?: string;
  relativeBase?: string;
  operands: string[];
}

type ParseResult =
  | { ok: true; parsed: ParsedArgs }
  | { ok: false; result: ExecResult };

function optionRequiresArgument(option: string): ExecResult {
  return {
    stdout: "",
    stderr: `realpath: option '${option}' requires an argument\n`,
    exitCode: 1,
  };
}

function parseArgs(args: string[]): ParseResult {
  const parsed: ParsedArgs = {
    options: { existence: "default", noSymlinks: false, logical: false },
    quiet: false,
    zero: false,
    operands: [],
  };

  const applyShortFlag = (
    flag: string,
    raw: string,
  ): ExecResult | undefined => {
    switch (flag) {
      case "e":
        parsed.options.existence = "existing";
        return undefined;
      case "m":
        parsed.options.existence = "missing";
        return undefined;
      case "s":
        parsed.options.noSymlinks = true;
        return undefined;
      case "L":
        parsed.options.logical = true;
        return undefined;
      case "P":
        parsed.options.logical = false;
        return undefined;
      case "q":
        parsed.quiet = true;
        return undefined;
      case "z":
        parsed.zero = true;
        return undefined;
      default:
        return unknownOption("realpath", raw);
    }
  };

  let optionsEnded = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (optionsEnded || arg === "-" || !arg.startsWith("-")) {
      parsed.operands.push(arg);
      continue;
    }

    if (arg === "--") {
      optionsEnded = true;
      continue;
    }

    if (arg === "--help") {
      return { ok: false, result: showHelp(realpathHelp) };
    }

    if (arg.startsWith("--")) {
      const separator = arg.indexOf("=");
      const name = separator === -1 ? arg : arg.slice(0, separator);
      const inlineValue =
        separator === -1 ? undefined : arg.slice(separator + 1);

      if (name === "--relative-to" || name === "--relative-base") {
        const value = inlineValue ?? args[++i];
        if (value === undefined) {
          return { ok: false, result: optionRequiresArgument(name) };
        }
        if (name === "--relative-to") {
          parsed.relativeTo = value;
        } else {
          parsed.relativeBase = value;
        }
        continue;
      }

      if (inlineValue !== undefined) {
        return { ok: false, result: unknownOption("realpath", name) };
      }

      switch (name) {
        case "--canonicalize-existing":
          parsed.options.existence = "existing";
          continue;
        case "--canonicalize-missing":
          parsed.options.existence = "missing";
          continue;
        case "--strip":
        case "--no-symlinks":
          parsed.options.noSymlinks = true;
          continue;
        case "--logical":
          parsed.options.logical = true;
          continue;
        case "--physical":
          parsed.options.logical = false;
          continue;
        case "--quiet":
          parsed.quiet = true;
          continue;
        case "--zero":
          parsed.zero = true;
          continue;
        default:
          return { ok: false, result: unknownOption("realpath", name) };
      }
    }

    for (const flag of arg.slice(1)) {
      const failure = applyShortFlag(flag, `-${flag}`);
      if (failure) return { ok: false, result: failure };
    }
  }

  return { ok: true, parsed };
}

export const realpathCommand: RuntimeCommand = {
  name: "realpath",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    const parseResult = parseArgs(args);
    if (!parseResult.ok) return parseResult.result;
    const { options, quiet, zero, operands } = parseResult.parsed;

    if (operands.length === 0) {
      return {
        stdout: "",
        stderr: "realpath: missing operand\n",
        exitCode: 1,
      };
    }

    const outputLimit = Math.min(
      ctx.limits.maxStringLength,
      ctx.limits.maxOutputSize,
    );

    const budget = new FileTraversalBudget({
      limits: ctx.limits,
      signal: ctx.signal,
      executionScope: ctx.executionScope,
      site: "realpath",
      label: "path resolution",
    });

    const fail = (operand: string, code: CanonicalizeFailure): string => {
      if (quiet) return "";
      // GNU quotes a name only when it would otherwise be unreadable, which
      // for realpath operands means the empty name.
      const name = operand === "" ? "''" : operand;
      return `realpath: ${name}: ${FAILURE_MESSAGES[code]}\n`;
    };

    // GNU canonicalizes both directory options up front and gives up on the
    // whole invocation when one of them cannot be resolved.
    const resolveDirectoryOption = async (
      operand: string | undefined,
    ): Promise<
      { ok: true; path?: string } | { ok: false; result: ExecResult }
    > => {
      if (operand === undefined) return { ok: true };
      const resolved = await canonicalize(
        ctx.fs,
        ctx.cwd,
        operand,
        options,
        budget,
      );
      if (resolved.ok) return { ok: true, path: resolved.path };
      return {
        ok: false,
        result: {
          stdout: "",
          stderr: fail(operand, resolved.code),
          exitCode: 1,
        },
      };
    };

    const resolvedBase = await resolveDirectoryOption(
      parseResult.parsed.relativeBase,
    );
    if (!resolvedBase.ok) return resolvedBase.result;
    const resolvedAnchor = await resolveDirectoryOption(
      parseResult.parsed.relativeTo,
    );
    if (!resolvedAnchor.ok) return resolvedAnchor.result;

    let base = resolvedBase.path;
    let anchor = resolvedAnchor.path;

    // --relative-to only applies while it is itself below --relative-base;
    // otherwise both are dropped and names print absolute.
    if (base !== undefined && anchor !== undefined && !isUnder(base, anchor)) {
      base = undefined;
      anchor = undefined;
    } else if (base !== undefined && anchor === undefined) {
      anchor = base;
    }

    const output = new BoundedStringBuilder(outputLimit, "realpath");
    // Diagnostics are charged too: an operand can fail without touching the
    // filesystem (the empty name), so nothing else bounds this.
    const diagnostics = new BoundedStringBuilder(outputLimit, "realpath");
    let failed = false;

    for (const operand of operands) {
      const resolved = await canonicalize(
        ctx.fs,
        ctx.cwd,
        operand,
        options,
        budget,
      );
      if (!resolved.ok) {
        failed = true;
        diagnostics.append(fail(operand, resolved.code));
        continue;
      }
      const printable =
        anchor !== undefined &&
        (base === undefined || isUnder(base, resolved.path))
          ? relativeTo(anchor, resolved.path)
          : resolved.path;
      output.append(printable).append(zero ? "\0" : "\n");
    }

    return {
      stdout: output.build(),
      stderr: diagnostics.build(),
      exitCode: failed ? 1 : 0,
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "realpath",
  flags: [
    { flag: "-e", type: "boolean" },
    { flag: "-m", type: "boolean" },
    { flag: "-s", type: "boolean" },
    { flag: "-L", type: "boolean" },
    { flag: "-P", type: "boolean" },
    { flag: "-q", type: "boolean" },
    { flag: "-z", type: "boolean" },
    { flag: "--relative-to", type: "value", valueHint: "path" },
    { flag: "--relative-base", type: "value", valueHint: "path" },
  ],
  needsArgs: true,
};
