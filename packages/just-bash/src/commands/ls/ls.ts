import { BoundedStringBuilder } from "../../bounded-builder.js";
import { utf8ByteLength } from "../../encoding.js";
import type { FsStat } from "../../fs/interface.js";
import { FileTraversalBudget } from "../../fs/traversal.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { DEFAULT_BATCH_SIZE } from "../../utils/constants.js";
import { hasHelpFlag, showHelp } from "../help.js";

function appendLsOutput(
  ctx: RuntimeCommandContext,
  current: string,
  next: string,
): string {
  if (
    utf8ByteLength(next) >
    ctx.limits.maxOutputSize - utf8ByteLength(current)
  ) {
    throw new ExecutionLimitError(
      `ls: output size limit exceeded (${ctx.limits.maxOutputSize} bytes)`,
      "output_size",
    );
  }
  return current + next;
}

/**
 * Bound a collection of directory entries as it enters `ls`, before anything
 * sorts, stats, classifies or formats it. A filesystem backend may return an
 * arbitrarily large `readdir()` result, and the existing output-size limit only
 * applies once entries have been formatted — by which point the work is already
 * done. Piping to `head` does not help either: pipeline producers are
 * materialized before consumers run.
 */
function checkEntryCount(ctx: RuntimeCommandContext, count: number): void {
  if (count > ctx.limits.maxArrayElements) {
    throw new ExecutionLimitError(
      `ls: array element limit exceeded (${ctx.limits.maxArrayElements})`,
      "array_elements",
    );
  }
}

/**
 * Bound a batch of entries and reserve it against the shared traversal budget,
 * so a recursive listing cannot bypass the per-directory bound by walking many
 * directories that are each individually small enough.
 */
function admitEntries(
  ctx: RuntimeCommandContext,
  traversalBudget: FileTraversalBudget,
  count: number,
): void {
  checkEntryCount(ctx, count);
  // `reserve`, not `discover`: reading a directory is a single filesystem
  // operation however many names come back, already charged by the checkpoint
  // at the call site. Only the collection ceiling applies here, so a plain
  // name-order listing stays as cheap in work as it was.
  traversalBudget.reserve(count);
}

function joinLsLines(
  ctx: RuntimeCommandContext,
  lines: readonly string[],
): string {
  const output = new BoundedStringBuilder(ctx.limits.maxOutputSize, "ls");
  for (let index = 0; index < lines.length; index++) {
    if (index > 0) output.append("\n");
    output.append(lines[index]);
  }
  if (lines.length > 0) output.append("\n");
  return output.build();
}

// Format size in human-readable format (e.g., 1.5K, 234M, 2G)
function formatHumanSize(bytes: number): string {
  if (bytes < 1024) return String(bytes);
  if (bytes < 1024 * 1024) {
    const k = bytes / 1024;
    return k < 10 ? `${k.toFixed(1)}K` : `${Math.round(k)}K`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    const m = bytes / (1024 * 1024);
    return m < 10 ? `${m.toFixed(1)}M` : `${Math.round(m)}M`;
  }
  const g = bytes / (1024 * 1024 * 1024);
  return g < 10 ? `${g.toFixed(1)}G` : `${Math.round(g)}G`;
}

// Format date for ls -l output (e.g., "Jan  1 00:00" or "Jan  1  2024")
function formatDate(date: Date): string {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[date.getMonth()];
  const day = String(date.getDate()).padStart(2, " ");
  const now = new Date();
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

  // If within last 6 months, show time; otherwise show year
  if (date > sixMonthsAgo) {
    const hours = String(date.getHours()).padStart(2, "0");
    const mins = String(date.getMinutes()).padStart(2, "0");
    return `${month} ${day} ${hours}:${mins}`;
  }
  const year = date.getFullYear();
  return `${month} ${day}  ${year}`;
}

// Classify suffix for ls -F: / directory, @ symlink, * executable
function classifySuffix(stat: FsStat): string {
  if (stat.isDirectory) return "/";
  if (stat.isSymbolicLink) return "@";
  if ((stat.mode & 0o111) !== 0) return "*";
  return "";
}

const lsHelp = {
  name: "ls",
  summary: "list directory contents",
  usage: "ls [OPTION]... [FILE]...",
  options: [
    "-a, --all            do not ignore entries starting with .",
    "-A, --almost-all     do not list . and ..",
    "-d, --directory      list directories themselves, not their contents",
    "-F, --classify       append indicator (one of */=>@) to entries",
    "-h, --human-readable with -l, print sizes like 1K 234M 2G etc.",
    "-l                   use a long listing format",
    "-r, --reverse        reverse order while sorting",
    "-R, --recursive      list subdirectories recursively",
    "-S                   sort by file size, largest first",
    "-t                   sort by time, newest first",
    "-1                   list one file per line",
    "    --help           display this help and exit",
  ],
};

type SortKey = "name" | "size" | "time";

const argDefs = {
  showAll: { short: "a", long: "all", type: "boolean" as const },
  showAlmostAll: { short: "A", long: "almost-all", type: "boolean" as const },
  longFormat: { short: "l", type: "boolean" as const },
  humanReadable: {
    short: "h",
    long: "human-readable",
    type: "boolean" as const,
  },
  recursive: { short: "R", long: "recursive", type: "boolean" as const },
  reverse: { short: "r", long: "reverse", type: "boolean" as const },
  sortBySize: { short: "S", type: "boolean" as const },
  classifyFiles: { short: "F", long: "classify", type: "boolean" as const },
  directoryOnly: { short: "d", long: "directory", type: "boolean" as const },
  sortByTime: { short: "t", type: "boolean" as const },
  onePerLine: { short: "1", type: "boolean" as const },
};

export const lsCommand: RuntimeCommand = {
  name: "ls",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(lsHelp);
    }

    const parsed = parseArgs("ls", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const showAll = parsed.result.flags.showAll;
    const showAlmostAll = parsed.result.flags.showAlmostAll;
    const longFormat = parsed.result.flags.longFormat;
    const humanReadable = parsed.result.flags.humanReadable;
    const recursive = parsed.result.flags.recursive;
    const reverse = parsed.result.flags.reverse;
    const classifyFiles = parsed.result.flags.classifyFiles;
    const directoryOnly = parsed.result.flags.directoryOnly;
    const sortKey = resolveSortKey(
      args,
      parsed.result.flags.sortBySize,
      parsed.result.flags.sortByTime,
    );
    // Note: onePerLine is accepted but implicit in our output
    void parsed.result.flags.onePerLine;

    const paths = parsed.result.positional;

    if (paths.length === 0) {
      paths.push(".");
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;
    const traversalBudget = new FileTraversalBudget({
      limits: ctx.limits,
      signal: ctx.signal,
      executionScope: ctx.executionScope,
      site: "ls",
    });

    // With -d every operand names itself, so there is nothing to group: the
    // whole list is one block of names in sort order.
    if (directoryOnly) {
      for (const path of await sortOperands(
        paths,
        ctx,
        sortKey,
        reverse,
        traversalBudget,
      )) {
        // -d never descends, but each operand is still a filesystem visit and
        // is charged like one, so the limit bounds this list as it bounds a walk.
        traversalBudget.visit(0);
        const fullPath = ctx.fs.resolvePath(ctx.cwd, path);
        try {
          const stat = await ctx.fs.stat(fullPath);
          if (longFormat) {
            const mode = stat.isDirectory ? "drwxr-xr-x" : "-rw-r--r--";
            const suffix = classifyFiles
              ? classifySuffix(await ctx.fs.lstat(fullPath))
              : "";
            const size = stat.size ?? 0;
            const sizeStr = humanReadable
              ? formatHumanSize(size).padStart(5)
              : String(size).padStart(5);
            const mtime = stat.mtime ?? new Date(0);
            const dateStr = formatDate(mtime);
            stdout = appendLsOutput(
              ctx,
              stdout,
              `${mode} 1 user user ${sizeStr} ${dateStr} ${path}${suffix}\n`,
            );
          } else {
            const suffix = classifyFiles
              ? classifySuffix(await ctx.fs.lstat(fullPath))
              : "";
            stdout = appendLsOutput(ctx, stdout, `${path}${suffix}\n`);
          }
        } catch {
          stderr = appendLsOutput(
            ctx,
            stderr,
            `ls: cannot access '${path}': No such file or directory\n`,
          );
          exitCode = 2;
        }
      }
      return { stdout, stderr, exitCode };
    }

    // Operands are partitioned before anything is listed: everything that is
    // not a directory prints first as a single block, then each directory
    // prints its contents under a label. Only the directory groups are
    // separated by a blank line.
    const fileOperands: string[] = [];
    const dirOperands: string[] = [];
    for (const path of paths) {
      // Each operand is a filesystem visit like any other, so it is charged
      // before the stat rather than after the walk starts. A long operand list
      // otherwise does all its work before the budget can refuse any of it.
      // listPath is told not to charge it a second time.
      traversalBudget.visit(0);
      try {
        const stat = await ctx.fs.stat(ctx.fs.resolvePath(ctx.cwd, path));
        if (stat.isDirectory) {
          // `visit()` and `discover()` keep separate counters, so charging an
          // operand as a visit does not reserve it as a root whose children
          // are about to be discovered. The budget pre-reserves exactly one
          // root, so without this a listing of N directories could admit N-1
          // further batches of children before the bound applied.
          if (dirOperands.length > 0) traversalBudget.reserve(1);
          dirOperands.push(path);
        } else {
          fileOperands.push(path);
        }
      } catch {
        stderr = appendLsOutput(
          ctx,
          stderr,
          `ls: ${path}: No such file or directory\n`,
        );
        exitCode = 2;
      }
    }

    const listOperand = async (
      path: string,
      showHeader: boolean,
    ): Promise<void> => {
      const result = await listPath(
        path,
        ctx,
        showAll,
        showAlmostAll,
        longFormat,
        recursive,
        showHeader,
        reverse,
        humanReadable,
        sortKey,
        classifyFiles,
        false,
        traversalBudget,
        0,
        new Set(),
        true,
      );
      stdout = appendLsOutput(ctx, stdout, result.stdout);
      stderr = appendLsOutput(ctx, stderr, result.stderr);
      if (result.exitCode !== 0) exitCode = result.exitCode;
    };

    for (const path of await sortOperands(
      fileOperands,
      ctx,
      sortKey,
      reverse,
      traversalBudget,
    )) {
      await listOperand(path, false);
    }

    // A lone directory operand is listed bare; anything else labels it.
    const labelDirectories = paths.length > 1;
    for (const path of await sortOperands(
      dirOperands,
      ctx,
      sortKey,
      reverse,
      traversalBudget,
    )) {
      if (stdout) stdout = appendLsOutput(ctx, stdout, "\n");
      await listOperand(path, labelDirectories);
    }

    return { stdout, stderr, exitCode };
  },
};

/**
 * -S and -t are the same kind of flag, and giving both is not an error: the
 * one written last on the command line decides, so the choice cannot be made
 * from the parsed booleans alone.
 */
function resolveSortKey(
  args: readonly string[],
  sortBySize: boolean,
  sortByTime: boolean,
): SortKey {
  if (!sortBySize && !sortByTime) return "name";
  if (sortBySize !== sortByTime) return sortBySize ? "size" : "time";

  let last: SortKey = "name";
  for (const arg of args) {
    if (arg === "--") break;
    if (!arg.startsWith("-") || arg.startsWith("--")) continue;
    for (const flag of arg.slice(1)) {
      if (flag === "S") last = "size";
      else if (flag === "t") last = "time";
    }
  }
  return last;
}

// Operands carry the same sort order as directory entries do.
async function sortOperands(
  paths: readonly string[],
  ctx: RuntimeCommandContext,
  sortKey: SortKey,
  reverse: boolean,
  traversalBudget?: FileTraversalBudget,
): Promise<string[]> {
  return await sortNames(
    paths,
    (path) => ctx.fs.resolvePath(ctx.cwd, path),
    ctx,
    sortKey,
    reverse,
    traversalBudget,
  );
}

/**
 * Size and time both sort descending — largest and newest first — and fall
 * back to the name when two entries tie, so a listing never depends on the
 * order the filesystem happened to return. -r reverses the result, tiebreak
 * included.
 *
 * The key comes from lstat, so a symlink sorts on its own size and mtime
 * rather than its target's, which is what ls does without -L.
 */
async function sortNames(
  names: readonly string[],
  resolve: (name: string) => string,
  ctx: RuntimeCommandContext,
  sortKey: SortKey,
  reverse: boolean,
  traversalBudget?: FileTraversalBudget,
): Promise<string[]> {
  const sorted = [...names];

  if (sortKey === "name") {
    sorted.sort();
  } else {
    // One metadata read per name, charged before any of them run: a large
    // directory would otherwise sort itself without the budget seeing the I/O.
    traversalBudget?.checkpoint(sorted.length);
    const keys = new Map<string, number>();
    for (const name of sorted) {
      try {
        const stat = await ctx.fs.lstat(resolve(name));
        keys.set(
          name,
          sortKey === "size"
            ? (stat.size ?? 0)
            : (stat.mtime ?? new Date(0)).getTime(),
        );
      } catch {
        keys.set(name, 0);
      }
    }
    sorted.sort((a, b) => {
      const difference = (keys.get(b) ?? 0) - (keys.get(a) ?? 0);
      if (difference !== 0) return difference;
      return a < b ? -1 : a > b ? 1 : 0;
    });
  }

  if (reverse) sorted.reverse();
  return sorted;
}

async function listPath(
  path: string,
  ctx: RuntimeCommandContext,
  showAll: boolean,
  showAlmostAll: boolean,
  longFormat: boolean,
  recursive: boolean,
  showHeader: boolean,
  reverse: boolean = false,
  humanReadable: boolean = false,
  sortKey: SortKey = "name",
  classifyFiles: boolean = false,
  _isSubdir: boolean = false,
  traversalBudget: FileTraversalBudget = new FileTraversalBudget({
    limits: ctx.limits,
    signal: ctx.signal,
    executionScope: ctx.executionScope,
    site: "ls",
  }),
  traversalDepth = 0,
  ancestorIdentities: Set<string> = new Set(),
  visitAlreadyCharged = false,
): Promise<ExecResult> {
  const showHidden = showAll || showAlmostAll;
  const fullPath = ctx.fs.resolvePath(ctx.cwd, path);

  try {
    // An operand is charged where it is resolved, before its stat, so charging
    // it here as well would spend two entries on one visit.
    if (!visitAlreadyCharged) traversalBudget.visit(traversalDepth);
    const stat = await ctx.fs.stat(fullPath);

    if (!stat.isDirectory) {
      // It's a file, just show it
      const fileSuffix = classifyFiles
        ? classifySuffix(await ctx.fs.lstat(fullPath))
        : "";
      if (longFormat) {
        const size = stat.size ?? 0;
        const sizeStr = humanReadable
          ? formatHumanSize(size).padStart(5)
          : String(size).padStart(5);
        const mtime = stat.mtime ?? new Date(0);
        const dateStr = formatDate(mtime);
        return {
          stdout: `-rw-r--r-- 1 user user ${sizeStr} ${dateStr} ${path}${fileSuffix}\n`,
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: `${path}${fileSuffix}\n`, stderr: "", exitCode: 0 };
    }

    const identity =
      stat.identity ??
      (stat.dev !== undefined && stat.ino !== undefined
        ? `${String(stat.dev)}:${String(stat.ino)}`
        : await ctx.fs.realpath(fullPath).catch(() => undefined));
    if (identity !== undefined && ancestorIdentities.has(identity)) {
      return {
        stdout: "",
        stderr: `ls: ${path}: symbolic link cycle detected\n`,
        exitCode: 2,
      };
    }
    const childAncestors = new Set(ancestorIdentities);
    if (identity !== undefined) childAncestors.add(identity);

    // It's a directory
    let entries = await ctx.fs.readdir(fullPath);
    traversalBudget.checkpoint();
    // `-a` prepends the synthetic "." and ".." below, so charge for them here
    // rather than letting a directory of exactly `maxArrayElements` entries
    // build an array two elements over the limit.
    admitEntries(ctx, traversalBudget, entries.length + (showAll ? 2 : 0));

    // Filter hidden files unless -a or -A
    if (!showHidden) {
      entries = entries.filter((e) => !e.startsWith("."));
    }

    // -S and -t need each entry's metadata; plain name order does not.
    entries = await sortNames(
      entries,
      (entry) => (fullPath === "/" ? `/${entry}` : `${fullPath}/${entry}`),
      ctx,
      sortKey,
      false,
      traversalBudget,
    );

    // Add . and .. entries for -a flag (but not for -A)
    if (showAll) {
      entries = [".", "..", ...entries];
    }

    if (reverse) {
      entries.reverse();
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    // For recursive listing:
    // - All directories get a header (including the first one)
    // - When starting from '.', show '.:'
    // - Subdirectories use './subdir:' format when starting from '.'
    // - When starting from other path, subdirs use '{path}/subdir:' format
    if (recursive || showHeader) {
      stdout = appendLsOutput(ctx, stdout, `${path}:\n`);
    }

    if (longFormat) {
      stdout = appendLsOutput(ctx, stdout, `total ${entries.length}\n`);

      // Separate special entries (. and ..) from regular entries
      const specialEntries = entries.filter((e) => e === "." || e === "..");
      const regularEntries = entries.filter((e) => e !== "." && e !== "..");

      // Add special entries first
      for (const entry of specialEntries) {
        stdout = appendLsOutput(
          ctx,
          stdout,
          `drwxr-xr-x 1 user user     0 Jan  1 00:00 ${entry}\n`,
        );
      }

      // Parallelize stat calls for regular entries
      const entryStats: {
        name: string;
        line: string;
      }[] = [];

      for (let i = 0; i < regularEntries.length; i += DEFAULT_BATCH_SIZE) {
        const batch = regularEntries.slice(i, i + DEFAULT_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (entry) => {
            const entryPath =
              fullPath === "/" ? `/${entry}` : `${fullPath}/${entry}`;
            try {
              const entryStat = await ctx.fs.stat(entryPath);
              const mode = entryStat.isDirectory ? "drwxr-xr-x" : "-rw-r--r--";
              const suffix = classifyFiles
                ? classifySuffix(await ctx.fs.lstat(entryPath))
                : "";
              const size = entryStat.size ?? 0;
              const sizeStr = humanReadable
                ? formatHumanSize(size).padStart(5)
                : String(size).padStart(5);
              const mtime = entryStat.mtime ?? new Date(0);
              const dateStr = formatDate(mtime);
              return {
                name: entry,
                line: `${mode} 1 user user ${sizeStr} ${dateStr} ${entry}${suffix}\n`,
              };
            } catch {
              return {
                name: entry,
                line: `-rw-r--r-- 1 user user     0 Jan  1 00:00 ${entry}\n`,
              };
            }
          }),
        );
        entryStats.push(...batchResults);
      }

      // Sort to maintain original order (entries were already sorted)
      const entryOrder = new Map(regularEntries.map((e, i) => [e, i]));
      entryStats.sort(
        (a, b) => (entryOrder.get(a.name) ?? 0) - (entryOrder.get(b.name) ?? 0),
      );

      for (const { line } of entryStats) {
        stdout = appendLsOutput(ctx, stdout, line);
      }
    } else if (classifyFiles) {
      // Classify each entry with type suffix
      const classified: string[] = [];
      const regularEntries = entries.filter((e) => e !== "." && e !== "..");
      const specialEntries = entries.filter((e) => e === "." || e === "..");

      for (const entry of specialEntries) {
        classified.push(`${entry}/`);
      }

      for (let i = 0; i < regularEntries.length; i += DEFAULT_BATCH_SIZE) {
        const batch = regularEntries.slice(i, i + DEFAULT_BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (entry) => {
            const entryPath =
              fullPath === "/" ? `/${entry}` : `${fullPath}/${entry}`;
            try {
              const entryStat = await ctx.fs.lstat(entryPath);
              return `${entry}${classifySuffix(entryStat)}`;
            } catch {
              return entry;
            }
          }),
        );
        classified.push(...batchResults);
      }

      stdout = appendLsOutput(ctx, stdout, joinLsLines(ctx, classified));
    } else {
      stdout = appendLsOutput(ctx, stdout, joinLsLines(ctx, entries));
    }

    // Handle recursive - parallel processing for better performance
    if (recursive) {
      // Filter out . and .. and get directory entries
      const filteredEntries = entries.filter((e) => e !== "." && e !== "..");
      const listedEntries = new Set(filteredEntries);

      // Use readdirWithFileTypes if available to avoid stat calls
      let dirEntries: { name: string; isDirectory: boolean }[] = [];

      if (ctx.fs.readdirWithFileTypes) {
        const entriesWithTypes = await ctx.fs.readdirWithFileTypes(fullPath);
        traversalBudget.checkpoint();
        // This re-reads the directory already admitted above, so bound the
        // fresh allocation without reserving the same children twice.
        checkEntryCount(ctx, entriesWithTypes.length);
        dirEntries = entriesWithTypes
          .filter((e) => e.isDirectory && listedEntries.has(e.name))
          .map((e) => ({ name: e.name, isDirectory: true }));
      } else {
        // Fall back to stat calls - parallelize them
        for (let i = 0; i < filteredEntries.length; i += DEFAULT_BATCH_SIZE) {
          const batch = filteredEntries.slice(i, i + DEFAULT_BATCH_SIZE);
          const results = await Promise.all(
            batch.map(async (entry) => {
              const entryPath =
                fullPath === "/" ? `/${entry}` : `${fullPath}/${entry}`;
              try {
                const entryStat = await ctx.fs.stat(entryPath);
                return { name: entry, isDirectory: entryStat.isDirectory };
              } catch {
                return { name: entry, isDirectory: false };
              }
            }),
          );
          dirEntries.push(...results.filter((r) => r.isDirectory));
        }
      }

      // Sections come out in the same order the entries did, so -t and -S
      // reach the descent and not just each directory's own listing.
      const dirOrder = await sortNames(
        dirEntries.map((d) => d.name),
        (name) => (fullPath === "/" ? `/${name}` : `${fullPath}/${name}`),
        ctx,
        sortKey,
        reverse,
        traversalBudget,
      );
      const dirRank = new Map(dirOrder.map((name, index) => [name, index]));
      dirEntries.sort(
        (a, b) => (dirRank.get(a.name) ?? 0) - (dirRank.get(b.name) ?? 0),
      );

      // Descend one subdirectory at a time. Fanning out in batches would let
      // every child in the batch await its own `readdir()` before any of them
      // reached `admitEntries`, so up to `DEFAULT_BATCH_SIZE` directories could
      // each materialize an entry list before the shared budget rejected the
      // first one — multiplying the bound this command is supposed to enforce
      // by the batch width. Entries within a single directory are still
      // statted in parallel batches; that work runs over an already-admitted,
      // bounded list.
      const subResults: { name: string; result: ExecResult }[] = [];

      for (const dir of dirEntries) {
        const subPath = path === "." ? `./${dir.name}` : `${path}/${dir.name}`;
        const result = await listPath(
          subPath,
          ctx,
          showAll,
          showAlmostAll,
          longFormat,
          recursive,
          false,
          reverse,
          humanReadable,
          sortKey,
          classifyFiles,
          true,
          traversalBudget,
          traversalDepth + 1,
          childAncestors,
        );
        subResults.push({ name: dir.name, result });
      }

      // Descending in order already yields this order; keep the explicit sort
      // so the output contract does not depend on the traversal staying
      // sequential, and reuse the ranking settled above rather than sorting by
      // name a second time.
      subResults.sort(
        (a, b) => (dirRank.get(a.name) ?? 0) - (dirRank.get(b.name) ?? 0),
      );

      // Append results
      for (const { result } of subResults) {
        stdout = appendLsOutput(ctx, stdout, "\n");
        stdout = appendLsOutput(ctx, stdout, result.stdout);
        stderr = appendLsOutput(ctx, stderr, result.stderr);
        if (result.exitCode !== 0) exitCode = result.exitCode;
      }
    }

    return { stdout, stderr, exitCode };
  } catch (error) {
    if (
      error instanceof ExecutionLimitError ||
      error instanceof ExecutionAbortedError
    ) {
      throw error;
    }
    return {
      stdout: "",
      stderr: `ls: ${path}: No such file or directory\n`,
      exitCode: 2,
    };
  }
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "ls",
  flags: [
    { flag: "-a", type: "boolean" },
    { flag: "-A", type: "boolean" },
    { flag: "-l", type: "boolean" },
    { flag: "-h", type: "boolean" },
    { flag: "-R", type: "boolean" },
    { flag: "-r", type: "boolean" },
    { flag: "-S", type: "boolean" },
    { flag: "-F", type: "boolean" },
    { flag: "-d", type: "boolean" },
    { flag: "-t", type: "boolean" },
    { flag: "-1", type: "boolean" },
  ],
  needsFiles: true,
};
