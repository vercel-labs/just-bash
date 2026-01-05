import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import {
  applyWidth,
  parseWidthPrecision,
  processEscapes,
} from "../printf/escapes.js";
import { collectNewerRefs, evaluateExpressionWithPrune } from "./matcher.js";
import { parseExpressions } from "./parser.js";
import type { EvalContext } from "./types.js";

const findHelp = {
  name: "find",
  summary: "search for files in a directory hierarchy",
  usage: "find [path...] [expression]",
  options: [
    "-name PATTERN    file name matches shell pattern PATTERN",
    "-iname PATTERN   like -name but case insensitive",
    "-path PATTERN    file path matches shell pattern PATTERN",
    "-ipath PATTERN   like -path but case insensitive",
    "-regex PATTERN   file path matches regular expression PATTERN",
    "-iregex PATTERN  like -regex but case insensitive",
    "-type TYPE       file is of type: f (regular file), d (directory)",
    "-empty           file is empty or directory is empty",
    "-mtime N         file's data was modified N*24 hours ago",
    "-newer FILE      file was modified more recently than FILE",
    "-size N[ckMGb]   file uses N units of space (c=bytes, k=KB, M=MB, G=GB, b=512B blocks)",
    "-perm MODE       file's permission bits are exactly MODE (octal)",
    "-perm -MODE      all permission bits MODE are set",
    "-perm /MODE      any permission bits MODE are set",
    "-maxdepth LEVELS descend at most LEVELS directories",
    "-mindepth LEVELS do not apply tests at levels less than LEVELS",
    "-depth           process directory contents before directory itself",
    "-prune           do not descend into this directory",
    "-not, !          negate the following expression",
    "-a, -and         logical AND (default)",
    "-o, -or          logical OR",
    "-exec CMD {} ;   execute CMD on each file ({} is replaced by filename)",
    "-exec CMD {} +   execute CMD with multiple files at once",
    "-print           print the full file name (default action)",
    "-print0          print the full file name followed by a null character",
    "-printf FORMAT   print FORMAT with directives: %f %h %p %P %s %d %m %M %t",
    "-delete          delete found files/directories",
    "    --help       display this help and exit",
  ],
};

// Predicates that take arguments
const PREDICATES_WITH_ARGS_SET = new Set([
  "-name",
  "-iname",
  "-path",
  "-ipath",
  "-regex",
  "-iregex",
  "-type",
  "-maxdepth",
  "-mindepth",
  "-mtime",
  "-newer",
  "-size",
  "-perm",
]);

export const findCommand: Command = {
  name: "find",
  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(findHelp);
    }

    const searchPaths: string[] = [];
    let maxDepth: number | null = null;
    let minDepth: number | null = null;
    let depthFirst = false;

    // Find all path arguments and parse -maxdepth/-mindepth/-depth
    // Paths come before any predicates (arguments starting with -)
    let expressionsStarted = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-maxdepth" && i + 1 < args.length) {
        expressionsStarted = true;
        maxDepth = parseInt(args[++i], 10);
      } else if (arg === "-mindepth" && i + 1 < args.length) {
        expressionsStarted = true;
        minDepth = parseInt(args[++i], 10);
      } else if (arg === "-depth") {
        expressionsStarted = true;
        depthFirst = true;
      } else if (arg === "-exec") {
        expressionsStarted = true;
        // Skip -exec and all arguments until terminator (; or +)
        i++;
        while (i < args.length && args[i] !== ";" && args[i] !== "+") {
          i++;
        }
        // i now points to the terminator, loop will increment past it
      } else if (
        !arg.startsWith("-") &&
        arg !== ";" &&
        arg !== "+" &&
        arg !== "(" &&
        arg !== ")" &&
        arg !== "\\(" &&
        arg !== "\\)" &&
        arg !== "!"
      ) {
        // This is a path if we haven't started expressions yet
        if (!expressionsStarted) {
          searchPaths.push(arg);
        }
      } else if (PREDICATES_WITH_ARGS_SET.has(arg)) {
        expressionsStarted = true;
        // Skip value arguments for predicates that take arguments
        i++;
      } else if (
        arg.startsWith("-") ||
        arg === "(" ||
        arg === "\\(" ||
        arg === "!"
      ) {
        expressionsStarted = true;
      }
    }

    // Default to current directory if no paths specified
    if (searchPaths.length === 0) {
      searchPaths.push(".");
    }

    // Parse expressions
    const { expr, error, actions } = parseExpressions(args, 0);

    // Return error for unknown predicates
    if (error) {
      return { stdout: "", stderr: error, exitCode: 1 };
    }

    // Check if there's an explicit -print in the expression
    const hasExplicitPrint = actions.some((a) => a.type === "print");

    // Determine if we should use default printing (when no actions at all)
    const useDefaultPrint = actions.length === 0;

    const results: string[] = [];
    // Extended results for -printf (stores metadata for each result)
    const hasPrintfAction = actions.some((a) => a.type === "printf");
    const printfResults: Array<{
      path: string;
      name: string;
      size: number;
      mtime: number;
      mode: number;
      isDirectory: boolean;
      depth: number;
      startingPoint: string;
    }> = [];
    let stderr = "";
    let exitCode = 0;

    // Collect and resolve -newer reference file mtimes
    const newerRefPaths = collectNewerRefs(expr);
    const newerRefTimes = new Map<string, number>();

    for (const refPath of newerRefPaths) {
      const refFullPath = ctx.fs.resolvePath(ctx.cwd, refPath);
      try {
        const refStat = await ctx.fs.stat(refFullPath);
        newerRefTimes.set(refPath, refStat.mtime?.getTime() ?? Date.now());
      } catch {
        // Reference file doesn't exist, -newer will always be false
      }
    }

    // Process each search path
    for (let searchPath of searchPaths) {
      // Normalize trailing slashes (except for root "/")
      if (searchPath.length > 1 && searchPath.endsWith("/")) {
        searchPath = searchPath.slice(0, -1);
      }
      const basePath = ctx.fs.resolvePath(ctx.cwd, searchPath);

      // Check if path exists
      try {
        await ctx.fs.stat(basePath);
      } catch {
        stderr += `find: ${searchPath}: No such file or directory\n`;
        exitCode = 1;
        continue;
      }

      // Recursive function to find files
      async function findRecursive(
        currentPath: string,
        depth: number,
      ): Promise<void> {
        // Check maxdepth - don't descend beyond this depth
        if (maxDepth !== null && depth > maxDepth) {
          return;
        }

        let stat: Awaited<ReturnType<typeof ctx.fs.stat>> | undefined;
        try {
          stat = await ctx.fs.stat(currentPath);
        } catch {
          return;
        }
        if (!stat) return;

        // For the starting directory, use the search path itself as the name
        // (e.g., when searching from '.', the name should be '.')
        let name: string;
        if (currentPath === basePath) {
          name = searchPath.split("/").pop() || searchPath;
        } else {
          name = currentPath.split("/").pop() || "";
        }

        const relativePath =
          currentPath === basePath
            ? searchPath
            : searchPath === "."
              ? `./${currentPath.slice(basePath === "/" ? basePath.length : basePath.length + 1)}`
              : searchPath + currentPath.slice(basePath.length);

        // For directories, get entries once and reuse for both isEmpty check and recursion
        let entries: string[] | null = null;
        if (stat.isDirectory) {
          entries = await ctx.fs.readdir(currentPath);
        }

        // Determine if entry is empty
        const isEmpty = stat.isFile
          ? stat.size === 0
          : entries !== null && entries.length === 0;

        // Helper to process current entry
        const processEntry = (): void => {
          // Check if this entry matches our criteria
          // Only apply tests if we're at or beyond mindepth
          const atOrBeyondMinDepth = minDepth === null || depth >= minDepth;
          let matches = atOrBeyondMinDepth;

          let shouldPrint = false;
          if (matches && expr !== null) {
            const evalCtx: EvalContext = {
              name,
              relativePath,
              isFile: stat.isFile,
              isDirectory: stat.isDirectory,
              isEmpty,
              mtime: stat.mtime?.getTime() ?? Date.now(),
              size: stat.size ?? 0,
              mode: stat.mode ?? 0o644,
              newerRefTimes,
            };
            const evalResult = evaluateExpressionWithPrune(expr, evalCtx);
            matches = evalResult.matches;

            // Determine if this path should be printed:
            // - If there's an explicit -print, only print when it was triggered
            // - Otherwise, use default printing (print everything that matches)
            if (hasExplicitPrint) {
              shouldPrint = evalResult.printed;
            } else {
              shouldPrint = matches;
            }
          } else if (matches) {
            // No expression, default print
            shouldPrint = true;
          }

          if (shouldPrint) {
            results.push(relativePath);
            if (hasPrintfAction) {
              printfResults.push({
                path: relativePath,
                name,
                size: stat.size ?? 0,
                mtime: stat.mtime?.getTime() ?? Date.now(),
                mode: stat.mode ?? 0o644,
                isDirectory: stat.isDirectory,
                depth,
                startingPoint: searchPath,
              });
            }
          }
        };

        // Helper to recurse into children
        const recurseChildren = async (): Promise<void> => {
          if (entries !== null) {
            for (const entry of entries) {
              const childPath =
                currentPath === "/" ? `/${entry}` : `${currentPath}/${entry}`;
              await findRecursive(childPath, depth + 1);
            }
          }
        };

        // Check for pruning (only when not in depth-first mode)
        let shouldPrune = false;
        if (!depthFirst && expr !== null) {
          const evalCtx: EvalContext = {
            name,
            relativePath,
            isFile: stat.isFile,
            isDirectory: stat.isDirectory,
            isEmpty,
            mtime: stat.mtime?.getTime() ?? Date.now(),
            size: stat.size ?? 0,
            mode: stat.mode ?? 0o644,
            newerRefTimes,
          };
          const evalResult = evaluateExpressionWithPrune(expr, evalCtx);
          shouldPrune = evalResult.pruned;
        }

        if (depthFirst) {
          // Process children first, then this entry
          await recurseChildren();
          processEntry();
        } else {
          // Process this entry first, then children (if not pruned)
          processEntry();
          if (!shouldPrune) {
            await recurseChildren();
          }
        }
      }

      await findRecursive(basePath, 0);
    }

    let stdout = "";

    // Execute actions if any
    if (actions.length > 0) {
      for (const action of actions) {
        switch (action.type) {
          case "print":
            // When -print is in the expression (hasExplicitPrint), results are already
            // populated based on when -print was triggered during evaluation.
            // Just output them here.
            stdout += results.length > 0 ? `${results.join("\n")}\n` : "";
            break;

          case "print0":
            stdout += results.length > 0 ? `${results.join("\0")}\0` : "";
            break;

          case "delete": {
            // Delete files in reverse order (depth-first) to handle directories
            const sortedForDelete = [...results].sort(
              (a, b) => b.length - a.length,
            );
            for (const file of sortedForDelete) {
              const fullPath = ctx.fs.resolvePath(ctx.cwd, file);
              try {
                await ctx.fs.rm(fullPath, { recursive: false });
              } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                stderr += `find: cannot delete '${file}': ${msg}\n`;
                exitCode = 1;
              }
            }
            break;
          }

          case "printf":
            for (const r of printfResults) {
              stdout += formatFindPrintf(action.format, r);
            }
            break;

          case "exec":
            if (!ctx.exec) {
              return {
                stdout: "",
                stderr: "find: -exec not supported in this context\n",
                exitCode: 1,
              };
            }
            if (action.batchMode) {
              // -exec ... + : execute command once with all files
              const cmdWithFiles: string[] = [];
              for (const part of action.command) {
                if (part === "{}") {
                  cmdWithFiles.push(...results);
                } else {
                  cmdWithFiles.push(part);
                }
              }
              const cmd = cmdWithFiles.map((p) => `"${p}"`).join(" ");
              const result = await ctx.exec(cmd, { cwd: ctx.cwd });
              stdout += result.stdout;
              stderr += result.stderr;
              if (result.exitCode !== 0) {
                exitCode = result.exitCode;
              }
            } else {
              // -exec ... ; : execute command for each file
              for (const file of results) {
                const cmdWithFile = action.command.map((part) =>
                  part === "{}" ? file : part,
                );
                const cmd = cmdWithFile.map((p) => `"${p}"`).join(" ");
                const result = await ctx.exec(cmd, { cwd: ctx.cwd });
                stdout += result.stdout;
                stderr += result.stderr;
                if (result.exitCode !== 0) {
                  exitCode = result.exitCode;
                }
              }
            }
            break;
        }
      }
    } else if (useDefaultPrint) {
      // Default: print with newline separator
      stdout = results.length > 0 ? `${results.join("\n")}\n` : "";
    }

    return { stdout, stderr, exitCode };
  },
};

/**
 * Format a find -printf format string
 * Supported directives (all support optional width/precision like %-20.10f):
 * %f - file basename (filename without directory)
 * %h - directory name (dirname)
 * %p - full path
 * %P - path without starting point
 * %s - file size in bytes
 * %d - depth in directory tree
 * %m - permissions in octal (without leading 0)
 * %M - symbolic permissions like -rwxr-xr-x
 * %t - modification time in ctime format
 * %T@ - modification time as seconds since epoch
 * %Tk - modification time with strftime format k
 * %% - literal %
 * Also processes escape sequences: \n, \t, etc.
 */
function formatFindPrintf(
  format: string,
  result: {
    path: string;
    name: string;
    size: number;
    mtime: number;
    mode: number;
    isDirectory: boolean;
    depth: number;
    startingPoint: string;
  },
): string {
  // First process escape sequences
  const processed = processEscapes(format);

  let output = "";
  let i = 0;

  while (i < processed.length) {
    if (processed[i] === "%" && i + 1 < processed.length) {
      i++; // skip %

      // Check for %% first
      if (processed[i] === "%") {
        output += "%";
        i++;
        continue;
      }

      // Parse optional width/precision (e.g., %-20.10)
      const [width, precision, consumed] = parseWidthPrecision(processed, i);
      i += consumed;

      if (i >= processed.length) {
        output += "%";
        break;
      }

      const directive = processed[i];
      let value: string;

      switch (directive) {
        case "f":
          // Filename (basename)
          value = result.name;
          i++;
          break;
        case "h": {
          // Directory (dirname)
          const lastSlash = result.path.lastIndexOf("/");
          value = lastSlash > 0 ? result.path.slice(0, lastSlash) : ".";
          i++;
          break;
        }
        case "p":
          // Full path
          value = result.path;
          i++;
          break;
        case "P": {
          // Path without starting point
          const sp = result.startingPoint;
          if (result.path === sp) {
            value = "";
          } else if (result.path.startsWith(`${sp}/`)) {
            value = result.path.slice(sp.length + 1);
          } else if (sp === "." && result.path.startsWith("./")) {
            value = result.path.slice(2);
          } else {
            value = result.path;
          }
          i++;
          break;
        }
        case "s":
          // File size in bytes
          value = String(result.size);
          i++;
          break;
        case "d":
          // Depth in directory tree
          value = String(result.depth);
          i++;
          break;
        case "m":
          // Permissions in octal (without leading 0)
          value = (result.mode & 0o777).toString(8);
          i++;
          break;
        case "M":
          // Symbolic permissions
          value = formatSymbolicMode(result.mode, result.isDirectory);
          i++;
          break;
        case "t": {
          // Modification time in ctime format
          const date = new Date(result.mtime);
          value = formatCtimeDate(date);
          i++;
          break;
        }
        case "T": {
          // Time format: %T@ for epoch, %TY for year, etc.
          if (i + 1 < processed.length) {
            const timeFormat = processed[i + 1];
            const date = new Date(result.mtime);
            value = formatTimeDirective(date, timeFormat);
            i += 2;
          } else {
            value = "%T";
            i++;
          }
          break;
        }
        default:
          // Unknown directive, keep as-is
          output += `%${width !== 0 || precision !== -1 ? `${width}.${precision}` : ""}${directive}`;
          i++;
          continue;
      }

      // Apply width/precision formatting using shared utility
      output += applyWidth(value, width, precision);
    } else {
      output += processed[i];
      i++;
    }
  }

  return output;
}

/**
 * Format permissions in symbolic form like -rwxr-xr-x
 */
function formatSymbolicMode(mode: number, isDirectory: boolean): string {
  const perms = mode & 0o777;
  let result = isDirectory ? "d" : "-";

  // Owner
  result += perms & 0o400 ? "r" : "-";
  result += perms & 0o200 ? "w" : "-";
  result += perms & 0o100 ? "x" : "-";

  // Group
  result += perms & 0o040 ? "r" : "-";
  result += perms & 0o020 ? "w" : "-";
  result += perms & 0o010 ? "x" : "-";

  // Other
  result += perms & 0o004 ? "r" : "-";
  result += perms & 0o002 ? "w" : "-";
  result += perms & 0o001 ? "x" : "-";

  return result;
}

/**
 * Format date in ctime format: "Wed Dec 25 12:34:56 2024"
 */
function formatCtimeDate(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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

  const day = days[date.getDay()];
  const month = months[date.getMonth()];
  const dayNum = String(date.getDate()).padStart(2, " ");
  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");
  const secs = String(date.getSeconds()).padStart(2, "0");
  const year = date.getFullYear();

  return `${day} ${month} ${dayNum} ${hours}:${mins}:${secs} ${year}`;
}

/**
 * Format time with %T directive format character
 */
function formatTimeDirective(date: Date, format: string): string {
  switch (format) {
    case "@":
      // Seconds since epoch (with fractional part)
      return String(date.getTime() / 1000);
    case "Y":
      // Year with century
      return String(date.getFullYear());
    case "m":
      // Month (01-12)
      return String(date.getMonth() + 1).padStart(2, "0");
    case "d":
      // Day of month (01-31)
      return String(date.getDate()).padStart(2, "0");
    case "H":
      // Hour (00-23)
      return String(date.getHours()).padStart(2, "0");
    case "M":
      // Minute (00-59)
      return String(date.getMinutes()).padStart(2, "0");
    case "S":
      // Second (00-59)
      return String(date.getSeconds()).padStart(2, "0");
    case "T":
      // Time as HH:MM:SS
      return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
    case "F":
      // Date as YYYY-MM-DD
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    default:
      return `%T${format}`;
  }
}
