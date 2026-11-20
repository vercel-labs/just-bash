import { BoundedStringBuilder } from "../../bounded-builder.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { traverseFileTree } from "../../fs/traversal.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { allocatedFileBytes, formatHumanSize } from "../file-metadata.js";
import { hasHelpFlag, showHelp } from "../help.js";

const duHelp = {
  name: "du",
  summary: "estimate file space usage",
  usage: "du [OPTION]... [FILE]...",
  options: [
    "-a          write counts for all files, not just directories",
    "-h          print sizes in human readable format",
    "-s          display only a total for each argument",
    "-c          produce a grand total",
    "-k          display sizes in 1024-byte units",
    "-d N        print totals at most N levels below each argument",
    "--max-depth=N  print total for directory only if N or fewer levels deep",
    "    --help  display this help and exit",
  ],
};

const argDefs = {
  allFiles: { short: "a", type: "boolean" as const },
  humanReadable: { short: "h", type: "boolean" as const },
  summarize: { short: "s", type: "boolean" as const },
  grandTotal: { short: "c", type: "boolean" as const },
  maxDepth: { short: "d", long: "max-depth", type: "number" as const },
  kilobytes: { short: "k", type: "boolean" as const },
};

interface DuOptions {
  allFiles: boolean;
  humanReadable: boolean;
  summarize: boolean;
  grandTotal: boolean;
  maxDepth: number | null;
}

export const duCommand: RuntimeCommand = {
  name: "du",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(duHelp);
    }

    const parsed = parseArgs("du", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const options: DuOptions = {
      allFiles: parsed.result.flags.allFiles,
      humanReadable: parsed.result.flags.humanReadable,
      summarize: parsed.result.flags.summarize,
      grandTotal: parsed.result.flags.grandTotal,
      maxDepth: parsed.result.flags.maxDepth ?? null,
    };

    if (
      options.maxDepth !== null &&
      (!Number.isInteger(options.maxDepth) || options.maxDepth < 0)
    )
      return {
        stdout: "",
        stderr: `du: invalid maximum depth '${options.maxDepth}'\n`,
        exitCode: 1,
      };
    if (
      options.summarize &&
      options.maxDepth !== null &&
      options.maxDepth !== 0
    )
      return {
        stdout: "",
        stderr: `du: warning: summarizing conflicts with --max-depth=${options.maxDepth}\nTry 'du --help' for more information.\n`,
        exitCode: 1,
      };
    for (const arg of args) {
      if (arg === "--") break;
      if (arg.startsWith("-") && !arg.startsWith("--"))
        for (const flag of arg.slice(1)) {
          if (flag === "h") options.humanReadable = true;
          else if (flag === "k") options.humanReadable = false;
        }
    }
    const targets = parsed.result.positional;

    // Default to current directory
    if (targets.length === 0) {
      targets.push(".");
    }

    const output = new BoundedStringBuilder(
      Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength),
      "du",
    );
    const errors = new BoundedStringBuilder(
      ctx.limits.maxOutputSize,
      "du diagnostics",
    );
    let grandTotal = 0;

    for (const target of targets) {
      const fullPath = ctx.fs.resolvePath(ctx.cwd, target);

      try {
        // Check if path exists first
        await ctx.fs.lstat(fullPath);
        const result = await calculateSize(
          ctx,
          fullPath,
          target,
          options,
          output,
          0,
        );
        grandTotal += result.totalSize;
        errors.append(result.stderr);
      } catch (error) {
        rethrowFatalExecutionError(error);
        errors.append(
          `du: cannot access '${target}': ${String(error).includes("ENOENT") ? "No such file or directory" : "cannot read file or directory"}\n`,
        );
      }
    }

    if (options.grandTotal && targets.length > 0) {
      output.append(
        `${formatSize(grandTotal, options.humanReadable)}\ttotal\n`,
      );
    }

    const stderr = errors.build();
    return { stdout: output.build(), stderr, exitCode: stderr ? 1 : 0 };
  },
};

interface SizeResult {
  totalSize: number;
  stderr: string;
}

async function calculateSize(
  ctx: RuntimeCommandContext,
  fullPath: string,
  displayPath: string,
  options: DuOptions,
  output: BoundedStringBuilder,
  depth: number,
): Promise<SizeResult> {
  const result: SizeResult = { totalSize: 0, stderr: "" };
  const directorySizes = new Map<string, number>();

  await traverseFileTree(
    {
      fs: ctx.fs,
      root: fullPath,
      limits: ctx.limits,
      signal: ctx.signal,
      executionScope: ctx.executionScope,
      site: "du",
      symlinks: "never",
      includeLeave: true,
    },
    (entry) => {
      const relative = entry.path.slice(fullPath.length).replace(/^\//, "");
      const shown = relative ? `${displayPath}/${relative}` : displayPath;
      const parent =
        entry.path === "/"
          ? "/"
          : entry.path.slice(0, entry.path.lastIndexOf("/")) || "/";

      if (entry.phase === "enter") {
        const entrySize = allocatedFileBytes(
          entry.stat,
          ctx.virtualFileMetadata,
        );
        if (entry.stat.isDirectory) {
          directorySizes.set(entry.path, entrySize);
          return;
        }
        directorySizes.set(
          parent,
          (directorySizes.get(parent) ?? 0) + entrySize,
        );
        if (
          entry.depth === depth ||
          (options.allFiles &&
            !options.summarize &&
            (options.maxDepth === null ||
              entry.depth - depth <= options.maxDepth))
        ) {
          output.append(
            `${formatSize(entrySize, options.humanReadable)}\t${shown}\n`,
          );
        }
        if (entry.depth === depth) result.totalSize = entrySize;
        return;
      }

      const size = directorySizes.get(entry.path) ?? 0;
      directorySizes.delete(entry.path);
      if (entry.depth > depth) {
        directorySizes.set(parent, (directorySizes.get(parent) ?? 0) + size);
      } else {
        result.totalSize = size;
      }
      const relativeDepth = entry.depth - depth;
      if (
        (options.summarize && relativeDepth === 0) ||
        (!options.summarize &&
          (options.maxDepth === null || relativeDepth <= options.maxDepth))
      ) {
        output.append(`${formatSize(size, options.humanReadable)}\t${shown}\n`);
      }
    },
  );

  return result;
}

function formatSize(bytes: number, humanReadable: boolean): string {
  return humanReadable
    ? formatHumanSize(bytes)
    : String(Math.ceil(bytes / 1024));
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "du",
  flags: [
    { flag: "-a", type: "boolean" },
    { flag: "-h", type: "boolean" },
    { flag: "-s", type: "boolean" },
    { flag: "-c", type: "boolean" },
    { flag: "--max-depth", type: "value", valueHint: "number" },
  ],
  needsFiles: true,
};
