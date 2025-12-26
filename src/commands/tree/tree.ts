import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

const treeHelp = {
  name: "tree",
  summary: "list contents of directories in a tree-like format",
  usage: "tree [OPTION]... [DIRECTORY]...",
  options: [
    "-a          include hidden files",
    "-d          list directories only",
    "-L LEVEL    limit depth of directory tree",
    "-f          print full path prefix for each file",
    "    --help  display this help and exit",
  ],
};

const argDefs = {
  showHidden: { short: "a", type: "boolean" as const },
  directoriesOnly: { short: "d", type: "boolean" as const },
  fullPath: { short: "f", type: "boolean" as const },
  maxDepth: { short: "L", type: "number" as const },
};

interface TreeOptions {
  showHidden: boolean;
  directoriesOnly: boolean;
  maxDepth: number | null;
  fullPath: boolean;
}

export const treeCommand: Command = {
  name: "tree",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(treeHelp);
    }

    const parsed = parseArgs("tree", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const options: TreeOptions = {
      showHidden: parsed.result.flags.showHidden,
      directoriesOnly: parsed.result.flags.directoriesOnly,
      maxDepth: parsed.result.flags.maxDepth ?? null,
      fullPath: parsed.result.flags.fullPath,
    };

    const directories = parsed.result.positional;

    // Default to current directory
    if (directories.length === 0) {
      directories.push(".");
    }

    let stdout = "";
    let stderr = "";
    let dirCount = 0;
    let fileCount = 0;

    for (const dir of directories) {
      const result = await buildTree(ctx, dir, options, "", 0);
      stdout += result.output;
      stderr += result.stderr;
      dirCount += result.dirCount;
      fileCount += result.fileCount;
    }

    // Add summary
    stdout += `\n${dirCount} director${dirCount === 1 ? "y" : "ies"}`;
    if (!options.directoriesOnly) {
      stdout += `, ${fileCount} file${fileCount === 1 ? "" : "s"}`;
    }
    stdout += "\n";

    return { stdout, stderr, exitCode: stderr ? 1 : 0 };
  },
};

interface TreeResult {
  output: string;
  stderr: string;
  dirCount: number;
  fileCount: number;
}

async function buildTree(
  ctx: CommandContext,
  path: string,
  options: TreeOptions,
  prefix: string,
  depth: number,
): Promise<TreeResult> {
  const result: TreeResult = {
    output: "",
    stderr: "",
    dirCount: 0,
    fileCount: 0,
  };

  const fullPath = ctx.fs.resolvePath(ctx.cwd, path);

  try {
    const stat = await ctx.fs.stat(fullPath);
    if (!stat.isDirectory) {
      // Single file
      result.output = `${path}\n`;
      result.fileCount = 1;
      return result;
    }
  } catch {
    result.stderr = `tree: ${path}: No such file or directory\n`;
    return result;
  }

  // Root directory line
  result.output = `${path}\n`;

  // Check depth limit
  if (options.maxDepth !== null && depth >= options.maxDepth) {
    return result;
  }

  try {
    const entries = await ctx.fs.readdir(fullPath);

    // Filter and sort entries
    const filteredEntries = entries.filter((e) => {
      if (!options.showHidden && e.startsWith(".")) {
        return false;
      }
      return true;
    });
    filteredEntries.sort();

    for (let i = 0; i < filteredEntries.length; i++) {
      const entry = filteredEntries[i];
      const entryPath = fullPath === "/" ? `/${entry}` : `${fullPath}/${entry}`;
      const isLast = i === filteredEntries.length - 1;
      const connector = isLast ? "`-- " : "|-- ";
      const childPrefix = prefix + (isLast ? "    " : "|   ");

      try {
        const entryStat = await ctx.fs.stat(entryPath);

        if (entryStat.isDirectory) {
          result.dirCount++;
          const displayName = options.fullPath ? entryPath : entry;
          result.output += `${prefix + connector + displayName}\n`;

          // Recurse into directory
          if (options.maxDepth === null || depth + 1 < options.maxDepth) {
            const subResult = await buildTreeRecursive(
              ctx,
              entryPath,
              options,
              childPrefix,
              depth + 1,
            );
            result.output += subResult.output;
            result.dirCount += subResult.dirCount;
            result.fileCount += subResult.fileCount;
          }
        } else if (!options.directoriesOnly) {
          result.fileCount++;
          const displayName = options.fullPath ? entryPath : entry;
          result.output += `${prefix + connector + displayName}\n`;
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  } catch (_error) {
    result.stderr = `tree: ${path}: Permission denied\n`;
  }

  return result;
}

async function buildTreeRecursive(
  ctx: CommandContext,
  path: string,
  options: TreeOptions,
  prefix: string,
  depth: number,
): Promise<TreeResult> {
  const result: TreeResult = {
    output: "",
    stderr: "",
    dirCount: 0,
    fileCount: 0,
  };

  // Check depth limit
  if (options.maxDepth !== null && depth >= options.maxDepth) {
    return result;
  }

  try {
    const entries = await ctx.fs.readdir(path);

    // Filter and sort entries
    const filteredEntries = entries.filter((e) => {
      if (!options.showHidden && e.startsWith(".")) {
        return false;
      }
      return true;
    });
    filteredEntries.sort();

    for (let i = 0; i < filteredEntries.length; i++) {
      const entry = filteredEntries[i];
      const entryPath = path === "/" ? `/${entry}` : `${path}/${entry}`;
      const isLast = i === filteredEntries.length - 1;
      const connector = isLast ? "`-- " : "|-- ";
      const childPrefix = prefix + (isLast ? "    " : "|   ");

      try {
        const entryStat = await ctx.fs.stat(entryPath);

        if (entryStat.isDirectory) {
          result.dirCount++;
          const displayName = options.fullPath ? entryPath : entry;
          result.output += `${prefix + connector + displayName}\n`;

          // Recurse into directory
          const subResult = await buildTreeRecursive(
            ctx,
            entryPath,
            options,
            childPrefix,
            depth + 1,
          );
          result.output += subResult.output;
          result.dirCount += subResult.dirCount;
          result.fileCount += subResult.fileCount;
        } else if (!options.directoriesOnly) {
          result.fileCount++;
          const displayName = options.fullPath ? entryPath : entry;
          result.output += `${prefix + connector + displayName}\n`;
        }
      } catch {
        // Skip entries we can't stat
      }
    }
  } catch {
    // Can't read directory
  }

  return result;
}
