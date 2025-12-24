import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp } from "../help.js";
import { collectNewerRefs, evaluateExpression } from "./matcher.js";
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
    "-not, !          negate the following expression",
    "-a, -and         logical AND (default)",
    "-o, -or          logical OR",
    "-exec CMD {} ;   execute CMD on each file ({} is replaced by filename)",
    "-exec CMD {} +   execute CMD with multiple files at once",
    "-print           print the full file name (default action)",
    "-print0          print the full file name followed by a null character",
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

    let searchPath = ".";
    let maxDepth: number | null = null;
    let minDepth: number | null = null;

    // Find the path argument and parse -maxdepth/-mindepth
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-maxdepth" && i + 1 < args.length) {
        maxDepth = parseInt(args[++i], 10);
      } else if (arg === "-mindepth" && i + 1 < args.length) {
        minDepth = parseInt(args[++i], 10);
      } else if (arg === "-exec") {
        // Skip -exec and all arguments until terminator (; or +)
        i++;
        while (i < args.length && args[i] !== ";" && args[i] !== "+") {
          i++;
        }
        // i now points to the terminator, loop will increment past it
      } else if (!arg.startsWith("-") && arg !== ";" && arg !== "+") {
        searchPath = arg;
      } else if (PREDICATES_WITH_ARGS_SET.has(arg)) {
        // Skip value arguments for predicates that take arguments
        i++;
      }
    }

    // Parse expressions
    const { expr, error, actions } = parseExpressions(args, 0);

    // Return error for unknown predicates
    if (error) {
      return { stdout: "", stderr: error, exitCode: 1 };
    }

    // Determine if we should print results (default) or just execute commands
    const shouldPrint = actions.length === 0;

    const basePath = ctx.fs.resolvePath(ctx.cwd, searchPath);

    // Check if path exists
    try {
      await ctx.fs.stat(basePath);
    } catch {
      return {
        stdout: "",
        stderr: `find: ${searchPath}: No such file or directory\n`,
        exitCode: 1,
      };
    }

    const results: string[] = [];

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
            ? `./${currentPath.slice(basePath.length + 1)}`
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

      // Check if this entry matches our criteria
      // Only apply tests if we're at or beyond mindepth
      const atOrBeyondMinDepth = minDepth === null || depth >= minDepth;
      let matches = atOrBeyondMinDepth;

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
        matches = evaluateExpression(expr, evalCtx);
      }

      if (matches) {
        results.push(relativePath);
      }

      // Recurse into directories (reuse entries from above)
      if (entries !== null) {
        for (const entry of entries) {
          const childPath =
            currentPath === "/" ? `/${entry}` : `${currentPath}/${entry}`;
          await findRecursive(childPath, depth + 1);
        }
      }
    }

    await findRecursive(basePath, 0);

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    // Execute actions if any
    if (actions.length > 0) {
      for (const action of actions) {
        switch (action.type) {
          case "print":
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
              const result = await ctx.exec(cmd);
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
                const result = await ctx.exec(cmd);
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
    } else if (shouldPrint) {
      // Default: print with newline separator
      stdout = results.length > 0 ? `${results.join("\n")}\n` : "";
    }

    return { stdout, stderr, exitCode };
  },
};
