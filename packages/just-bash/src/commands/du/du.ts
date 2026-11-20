import {
  encodeUtf8ToBytes,
  latin1FromBytes,
  utf8ByteLength,
} from "../../encoding.js";
import { ExecutionOutputAccumulator } from "../../execution-output.js";
import type { ExecutionScope } from "../../execution-scope.js";
import { FileSystemPolicyError, traverseFileTree } from "../../fs/traversal.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";
import { getErrorCode } from "../../interpreter/helpers/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
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
    "--max-depth=N  print total for directory only if N or fewer levels deep",
    "    --help  display this help and exit",
  ],
};

const argDefs = {
  allFiles: { short: "a", type: "boolean" as const },
  humanReadable: { short: "h", type: "boolean" as const },
  summarize: { short: "s", type: "boolean" as const },
  grandTotal: { short: "c", type: "boolean" as const },
  maxDepth: { long: "max-depth", type: "number" as const },
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

    const targets = parsed.result.positional;

    // Default to current directory
    if (targets.length === 0) {
      targets.push(".");
    }

    let stdout = "";
    let stderr = "";
    let grandTotal = 0;
    let exitCode = 0;
    const output = ctx.executionScope
      ? new ExecutionOutputAccumulator(
          ctx.executionScope as ExecutionScope,
          "du",
        )
      : undefined;
    let fallbackOutputBytes = 0;
    const append = (stream: "stdout" | "stderr", value: string): void => {
      if (output) output.append(stream, value);
      else {
        const bytes = utf8ByteLength(value);
        if (bytes > ctx.limits.maxOutputSize - fallbackOutputBytes) {
          throw new ExecutionLimitError(
            `du: output size limit exceeded (${ctx.limits.maxOutputSize} bytes)`,
            "output_size",
          );
        }
        fallbackOutputBytes += bytes;
        if (stream === "stdout") stdout += value;
        else stderr += value;
      }
      if (stream === "stderr" && value) exitCode = 1;
    };

    for (const target of targets) {
      const fullPath = ctx.fs.resolvePath(ctx.cwd, target);

      try {
        // Check if path exists first
        await ctx.fs.stat(fullPath);
        grandTotal += await calculateSize(
          ctx,
          fullPath,
          target,
          options,
          0,
          append,
        );
      } catch (error) {
        if (
          error instanceof ExecutionLimitError ||
          error instanceof ExecutionAbortedError ||
          error instanceof FileSystemPolicyError
        ) {
          throw error;
        }
        append(
          "stderr",
          `du: cannot access ${quotePath(target)}: No such file or directory\n`,
        );
      }
    }

    if (options.grandTotal && targets.length > 0) {
      append(
        "stdout",
        `${formatSize(grandTotal, options.humanReadable)}\ttotal\n`,
      );
    }

    return output?.build(exitCode) ?? { stdout, stderr, exitCode };
  },
};

async function calculateSize(
  ctx: RuntimeCommandContext,
  fullPath: string,
  displayPath: string,
  options: DuOptions,
  depth: number,
  append: (stream: "stdout" | "stderr", value: string) => void,
): Promise<number> {
  let totalSize = 0;
  const shownPath = (path: string): string => {
    const relative = path.slice(fullPath === "/" ? 1 : fullPath.length + 1);
    if (!relative) return displayPath.replace(/\/+$/, "/");
    const prefix = displayPath.replace(/\/+$/, "");
    return `${prefix}/${relative}`;
  };
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
      onError(error, path, operation) {
        if (
          error instanceof ExecutionLimitError ||
          error instanceof ExecutionAbortedError ||
          error instanceof FileSystemPolicyError
        )
          throw error;
        const code = getErrorCode(error);
        const reason = code && TRAVERSAL_ERROR_REASONS.get(code);
        if (!reason) throw error;
        const action = operation === "readdir" ? "read directory" : "access";
        append(
          "stderr",
          `du: cannot ${action} ${quotePath(shownPath(path))}: ${reason}\n`,
        );
      },
    },
    (entry) => {
      const shown = shownPath(entry.path);
      const parent =
        entry.path === "/"
          ? "/"
          : entry.path.slice(0, entry.path.lastIndexOf("/")) || "/";

      if (entry.phase === "enter") {
        if (entry.stat.isDirectory) {
          directorySizes.set(entry.path, 0);
          return;
        }
        directorySizes.set(
          parent,
          (directorySizes.get(parent) ?? 0) + entry.stat.size,
        );
        if ((options.allFiles || entry.depth === depth) && !options.summarize) {
          append(
            "stdout",
            `${formatSize(entry.stat.size, options.humanReadable)}\t${shown}\n`,
          );
        }
        if (entry.depth === depth) totalSize = entry.stat.size;
        return;
      }

      const size = directorySizes.get(entry.path) ?? 0;
      if (entry.depth > depth) {
        directorySizes.set(parent, (directorySizes.get(parent) ?? 0) + size);
      } else {
        totalSize = size;
      }
      const relativeDepth = entry.depth - depth;
      if (
        (options.summarize && relativeDepth === 0) ||
        (!options.summarize &&
          (options.maxDepth === null || relativeDepth <= options.maxDepth))
      ) {
        append(
          "stdout",
          `${formatSize(size, options.humanReadable)}\t${shown}\n`,
        );
      }
    },
  );

  return totalSize;
}

// Match find's recoverable directory-read errors; never expose backend messages.
const TRAVERSAL_ERROR_REASONS = new Map<string, string>([
  ["EACCES", "Permission denied"],
  ["EIO", "Input/output error"],
  ["ELOOP", "Too many levels of symbolic links"],
  ["ENAMETOOLONG", "File name too long"],
  ["ENOENT", "No such file or directory"],
  ["ENOTDIR", "Not a directory"],
  ["EPERM", "Permission denied"],
]);

// GNU du uses shell-escape-always quoting for diagnostics. Keep control
// characters out of log lines while leaving the displayed path recognizable.
function quotePath(path: string): string {
  if (path.includes("'") && !/["\\$`\u0000-\u001f\u007f-\u009f]/.test(path)) {
    return `"${path}"`;
  }
  const quoted = path
    .replace(/'/g, "'\\''")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, (controls) => {
      let escaped = "";
      for (const char of controls) {
        const index = "\u0007\b\t\n\u000b\f\r".indexOf(char);
        if (index >= 0) escaped += `\\${"abtnvfr"[index]}`;
        else {
          for (const byte of latin1FromBytes(encodeUtf8ToBytes(char))) {
            escaped += `\\${byte.charCodeAt(0).toString(8).padStart(3, "0")}`;
          }
        }
      }
      return `'$'${escaped}''`;
    });
  return /[\u0000-\u001f\u007f-\u009f]$/.test(path)
    ? `'${quoted.slice(0, -1)}`
    : `'${quoted}'`;
}

function formatSize(bytes: number, humanReadable: boolean): string {
  if (!humanReadable) {
    // Return size in 1K blocks
    return String(Math.ceil(bytes / 1024) || 1);
  }

  if (bytes < 1024) {
    return `${bytes}`;
  } else if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)}K`;
  } else if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  } else {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
  }
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
