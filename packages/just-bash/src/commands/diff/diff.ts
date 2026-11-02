/**
 * diff - Compare files line by line
 */

import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { comparePaths } from "./compare.js";
import { DEFAULT_CONTEXT } from "./format.js";

const diffHelp = {
  name: "diff",
  summary: "compare files line by line",
  usage: "diff [OPTION]... FILE1 FILE2",
  options: [
    "    --normal      output a normal diff (default)",
    "-u, --unified     output a unified diff",
    "-U N             output a unified diff with N context lines",
    "-r, --recursive   recursively compare directories",
    "-N, --new-file    treat absent files as empty",
    "    --label L     use L for the next file header",
    "-c, --context     output a context diff",
    "-q, --brief       report only whether files differ",
    "-s, --report-identical-files  report when files are the same",
    "-i, --ignore-case  ignore case differences",
    "    --version     output version information and exit",
    "    --help        display this help and exit",
  ],
};

const helpHint = "diff: Try 'diff --help' for more information.\n";
const argDefs = {
  normal: { long: "normal", type: "boolean" as const },
  unified: { short: "u", long: "unified", type: "boolean" as const },
  context: { short: "c", long: "context", type: "boolean" as const },
  brief: { short: "q", long: "brief", type: "boolean" as const },
  reportSame: {
    short: "s",
    long: "report-identical-files",
    type: "boolean" as const,
  },
  ignoreCase: { short: "i", long: "ignore-case", type: "boolean" as const },
  version: { long: "version", type: "boolean" as const },
  recursive: { short: "r", long: "recursive", type: "boolean" as const },
  newFile: { short: "N", long: "new-file", type: "boolean" as const },
  lines: { short: "U", type: "number" as const },
};

export const diffCommand: RuntimeCommand = {
  name: "diff",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) return showHelp(diffHelp);

    const normalized: string[] = [];
    const labels: string[] = [];
    const optionWords: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--") {
        normalized.push(...args.slice(i));
        break;
      }
      if (arg === "--label" || arg.startsWith("--label=")) {
        const value = arg === "--label" ? args[++i] : arg.slice(8);
        if (value === undefined)
          return {
            stdout: "",
            stderr: `diff: option '--label' requires an argument\n${helpHint}`,
            exitCode: 2,
          };
        labels.push(value);
        optionWords.push(arg, ...(arg === "--label" ? [value] : []));
      } else {
        if (arg.startsWith("--unified=")) normalized.push("-U", arg.slice(10));
        else normalized.push(arg);
        if (arg.startsWith("-") && arg !== "-") {
          optionWords.push(arg);
          if (arg === "-U") {
            const value = args[++i];
            if (value !== undefined) {
              normalized.push(value);
              optionWords.push(value);
            }
          }
        }
      }
    }
    if (labels.length > 2)
      return {
        stdout: "",
        stderr: `diff: too many file label options\n${helpHint}`,
        exitCode: 2,
      };
    const parsed = parseArgs("diff", normalized, argDefs);
    if (!parsed.ok)
      return {
        ...parsed.error,
        stderr: parsed.error.stderr + helpHint,
        exitCode: 2,
      };

    const flags = parsed.result.flags;
    if (flags.version) {
      // No version number: this command ships inside just-bash and has no
      // release cadence of its own, and a hard-coded package version would go
      // stale on the very next release.
      return { stdout: "diff (just-bash)\n", stderr: "", exitCode: 0 };
    }

    const styleCount =
      Number(flags.normal) +
      Number(flags.unified || flags.lines !== undefined) +
      Number(flags.context);
    if (styleCount > 1) {
      return {
        stdout: "",
        stderr: `diff: conflicting output style options\n${helpHint}`,
        exitCode: 2,
      };
    }

    const files = parsed.result.positional;
    if (files.length !== 2)
      return {
        stdout: "",
        stderr:
          (files.length < 2
            ? "diff: missing operand\n"
            : `diff: extra operand '${files[2]}'\n`) + helpHint,
        exitCode: 2,
      };
    const context = flags.lines ?? DEFAULT_CONTEXT;
    if (!Number.isSafeInteger(context) || context < 0)
      return {
        stdout: "",
        stderr: `diff: invalid context length '${context}'\n${helpHint}`,
        exitCode: 2,
      };
    return comparePaths(ctx, files[0], files[1], {
      recursive: flags.recursive,
      newFile: flags.newFile,
      brief: flags.brief,
      reportSame: flags.reportSame,
      ignoreCase: flags.ignoreCase,
      style:
        flags.unified || flags.lines !== undefined
          ? "unified"
          : flags.context
            ? "context"
            : "normal",
      context,
      labels,
      optionWords,
    });
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "diff",
  flags: [
    { flag: "--normal", type: "boolean" },
    { flag: "-u", type: "boolean" },
    { flag: "-c", type: "boolean" },
    { flag: "-q", type: "boolean" },
    { flag: "-s", type: "boolean" },
    { flag: "-i", type: "boolean" },
  ],
  needsArgs: true,
  minArgs: 2,
};
