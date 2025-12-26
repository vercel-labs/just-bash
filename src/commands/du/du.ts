import type { Command, CommandContext, ExecResult } from "../../types.js";
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

export const duCommand: Command = {
  name: "du",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
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

    for (const target of targets) {
      const fullPath = ctx.fs.resolvePath(ctx.cwd, target);

      try {
        // Check if path exists first
        await ctx.fs.stat(fullPath);
        const result = await calculateSize(ctx, fullPath, target, options, 0);
        stdout += result.output;
        grandTotal += result.totalSize;
        stderr += result.stderr;
      } catch {
        stderr += `du: cannot access '${target}': No such file or directory\n`;
      }
    }

    if (options.grandTotal && targets.length > 0) {
      stdout += `${formatSize(grandTotal, options.humanReadable)}\ttotal\n`;
    }

    return { stdout, stderr, exitCode: stderr ? 1 : 0 };
  },
};

interface SizeResult {
  output: string;
  totalSize: number;
  stderr: string;
}

async function calculateSize(
  ctx: CommandContext,
  fullPath: string,
  displayPath: string,
  options: DuOptions,
  depth: number,
): Promise<SizeResult> {
  const result: SizeResult = {
    output: "",
    totalSize: 0,
    stderr: "",
  };

  try {
    const stat = await ctx.fs.stat(fullPath);

    if (!stat.isDirectory) {
      // Single file
      result.totalSize = stat.size;
      if (options.allFiles || depth === 0) {
        result.output =
          formatSize(stat.size, options.humanReadable) +
          "\t" +
          displayPath +
          "\n";
      }
      return result;
    }

    // Directory
    const entries = await ctx.fs.readdir(fullPath);
    let dirSize = 0;

    for (const entry of entries) {
      const entryPath = fullPath === "/" ? `/${entry}` : `${fullPath}/${entry}`;
      const entryDisplayPath =
        displayPath === "." ? entry : `${displayPath}/${entry}`;

      try {
        const entryStat = await ctx.fs.stat(entryPath);

        if (entryStat.isDirectory) {
          const subResult = await calculateSize(
            ctx,
            entryPath,
            entryDisplayPath,
            options,
            depth + 1,
          );
          dirSize += subResult.totalSize;

          // Only output subdirectories if not summarizing and within depth limit
          if (!options.summarize) {
            if (options.maxDepth === null || depth + 1 <= options.maxDepth) {
              result.output += subResult.output;
            } else {
              // Still need to count the size even if not displaying
              dirSize += 0; // Size already counted
            }
          }
        } else {
          dirSize += entryStat.size;
          if (options.allFiles && !options.summarize) {
            result.output +=
              formatSize(entryStat.size, options.humanReadable) +
              "\t" +
              entryDisplayPath +
              "\n";
          }
        }
      } catch {
        // Skip entries we can't read
      }
    }

    result.totalSize = dirSize;

    // Output this directory if within depth limit
    if (
      options.summarize ||
      options.maxDepth === null ||
      depth <= options.maxDepth
    ) {
      result.output += `${formatSize(dirSize, options.humanReadable)}\t${displayPath}\n`;
    }
  } catch (_error) {
    result.stderr = `du: cannot read directory '${displayPath}': Permission denied\n`;
  }

  return result;
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
