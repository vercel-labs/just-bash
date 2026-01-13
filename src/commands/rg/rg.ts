/**
 * rg - ripgrep-like recursive search
 *
 * Fast recursive search with smart defaults:
 * - Recursive by default (unlike grep)
 * - Respects .gitignore
 * - Skips hidden files by default
 * - Skips binary files by default
 * - Smart case sensitivity (case-insensitive unless pattern has uppercase)
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";
import { buildRegex, searchContent } from "../search-engine/index.js";
import { FILE_TYPES, formatTypeList, matchesType } from "./file-types.js";
import { GitignoreManager, loadGitignores } from "./gitignore.js";

const rgHelp = {
  name: "rg",
  summary: "recursively search for a pattern",
  usage: "rg [OPTIONS] PATTERN [PATH ...]",
  description: `rg (ripgrep) recursively searches directories for a regex pattern.
Unlike grep, rg is recursive by default and respects .gitignore files.

EXAMPLES:
  rg foo                    Search for 'foo' in current directory
  rg foo src/               Search in src/ directory
  rg -i foo                 Case-insensitive search
  rg -w foo                 Match whole words only
  rg -t js foo              Search only JavaScript files
  rg -g '*.ts' foo          Search files matching glob
  rg --hidden foo           Include hidden files
  rg -l foo                 List files with matches only`,
  options: [
    "-i, --ignore-case       case-insensitive search",
    "-S, --smart-case        smart case (default: case-insensitive unless pattern has uppercase)",
    "-F, --fixed-strings     treat pattern as literal string",
    "-w, --word-regexp       match whole words only",
    "-x, --line-regexp       match whole lines only",
    "-v, --invert-match      select non-matching lines",
    "-c, --count             print count of matching lines per file",
    "-l, --files-with-matches print only file names with matches",
    "-L, --files-without-match print file names without matches",
    "-o, --only-matching     print only matching parts",
    "-n, --line-number       print line numbers (default: on)",
    "-N, --no-line-number    do not print line numbers",
    "-A NUM                  print NUM lines after each match",
    "-B NUM                  print NUM lines before each match",
    "-C NUM                  print NUM lines before and after each match",
    "-g, --glob GLOB         include files matching GLOB",
    "-t, --type TYPE         only search files of TYPE (e.g., js, py, ts)",
    "-T, --type-not TYPE     exclude files of TYPE",
    "    --hidden            search hidden files and directories",
    "    --no-ignore         don't respect .gitignore files",
    "    --max-depth NUM     maximum search depth",
    "    --type-list         list all available file types",
    "    --help              display this help and exit",
  ],
};

interface RgOptions {
  // Pattern matching
  ignoreCase: boolean;
  smartCase: boolean;
  fixedStrings: boolean;
  wordRegexp: boolean;
  lineRegexp: boolean;
  invertMatch: boolean;

  // Output control
  count: boolean;
  filesWithMatches: boolean;
  filesWithoutMatch: boolean;
  onlyMatching: boolean;
  lineNumber: boolean;
  afterContext: number;
  beforeContext: number;

  // File selection
  globs: string[];
  types: string[];
  typesNot: string[];
  hidden: boolean;
  noIgnore: boolean;
  maxDepth: number;
}

export const rgCommand: Command = {
  name: "rg",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(rgHelp);
    }

    // Check for --type-list
    if (args.includes("--type-list")) {
      return {
        stdout: formatTypeList(),
        stderr: "",
        exitCode: 0,
      };
    }

    const options: RgOptions = {
      ignoreCase: false,
      smartCase: true,
      fixedStrings: false,
      wordRegexp: false,
      lineRegexp: false,
      invertMatch: false,
      count: false,
      filesWithMatches: false,
      filesWithoutMatch: false,
      onlyMatching: false,
      lineNumber: true,
      afterContext: 0,
      beforeContext: 0,
      globs: [],
      types: [],
      typesNot: [],
      hidden: false,
      noIgnore: false,
      maxDepth: Infinity,
    };

    let pattern: string | null = null;
    const paths: string[] = [];

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg.startsWith("-") && arg !== "-") {
        // Handle -A, -B, -C with numbers
        const contextMatch = arg.match(/^-([ABC])(\d+)$/);
        if (contextMatch) {
          const num = parseInt(contextMatch[2], 10);
          if (contextMatch[1] === "A") options.afterContext = num;
          else if (contextMatch[1] === "B") options.beforeContext = num;
          else {
            options.beforeContext = num;
            options.afterContext = num;
          }
          continue;
        }

        if (
          (arg === "-A" || arg === "-B" || arg === "-C") &&
          i + 1 < args.length
        ) {
          const num = parseInt(args[++i], 10);
          if (arg === "-A") options.afterContext = num;
          else if (arg === "-B") options.beforeContext = num;
          else {
            options.beforeContext = num;
            options.afterContext = num;
          }
          continue;
        }

        // Handle -g/--glob
        if (arg === "-g" || arg === "--glob") {
          if (i + 1 < args.length) {
            options.globs.push(args[++i]);
          }
          continue;
        }
        if (arg.startsWith("--glob=")) {
          options.globs.push(arg.slice("--glob=".length));
          continue;
        }

        // Handle -t/--type
        if (arg === "-t" || arg === "--type") {
          if (i + 1 < args.length) {
            const typeName = args[++i];
            if (!FILE_TYPES[typeName]) {
              return {
                stdout: "",
                stderr: `rg: unknown type: ${typeName}\nUse --type-list to see available types.\n`,
                exitCode: 1,
              };
            }
            options.types.push(typeName);
          }
          continue;
        }
        if (arg.startsWith("--type=")) {
          const typeName = arg.slice("--type=".length);
          if (!FILE_TYPES[typeName]) {
            return {
              stdout: "",
              stderr: `rg: unknown type: ${typeName}\nUse --type-list to see available types.\n`,
              exitCode: 1,
            };
          }
          options.types.push(typeName);
          continue;
        }

        // Handle -T/--type-not
        if (arg === "-T" || arg === "--type-not") {
          if (i + 1 < args.length) {
            const typeName = args[++i];
            if (!FILE_TYPES[typeName]) {
              return {
                stdout: "",
                stderr: `rg: unknown type: ${typeName}\nUse --type-list to see available types.\n`,
                exitCode: 1,
              };
            }
            options.typesNot.push(typeName);
          }
          continue;
        }
        if (arg.startsWith("--type-not=")) {
          const typeName = arg.slice("--type-not=".length);
          if (!FILE_TYPES[typeName]) {
            return {
              stdout: "",
              stderr: `rg: unknown type: ${typeName}\nUse --type-list to see available types.\n`,
              exitCode: 1,
            };
          }
          options.typesNot.push(typeName);
          continue;
        }

        // Handle --max-depth
        if (arg === "--max-depth" && i + 1 < args.length) {
          options.maxDepth = parseInt(args[++i], 10);
          continue;
        }
        if (arg.startsWith("--max-depth=")) {
          options.maxDepth = parseInt(arg.slice("--max-depth=".length), 10);
          continue;
        }

        // Boolean flags
        const flags = arg.startsWith("--") ? [arg] : arg.slice(1).split("");

        for (const flag of flags) {
          if (flag === "i" || flag === "--ignore-case") {
            options.ignoreCase = true;
            options.smartCase = false;
          } else if (flag === "S" || flag === "--smart-case") {
            options.smartCase = true;
            options.ignoreCase = false;
          } else if (flag === "F" || flag === "--fixed-strings") {
            options.fixedStrings = true;
          } else if (flag === "w" || flag === "--word-regexp") {
            options.wordRegexp = true;
          } else if (flag === "x" || flag === "--line-regexp") {
            options.lineRegexp = true;
          } else if (flag === "v" || flag === "--invert-match") {
            options.invertMatch = true;
          } else if (flag === "c" || flag === "--count") {
            options.count = true;
          } else if (flag === "l" || flag === "--files-with-matches") {
            options.filesWithMatches = true;
          } else if (flag === "L" || flag === "--files-without-match") {
            options.filesWithoutMatch = true;
          } else if (flag === "o" || flag === "--only-matching") {
            options.onlyMatching = true;
          } else if (flag === "n" || flag === "--line-number") {
            options.lineNumber = true;
          } else if (flag === "N" || flag === "--no-line-number") {
            options.lineNumber = false;
          } else if (flag === "--hidden") {
            options.hidden = true;
          } else if (flag === "--no-ignore") {
            options.noIgnore = true;
          } else if (flag.startsWith("--")) {
            return unknownOption("rg", flag);
          } else if (flag.length === 1) {
            return unknownOption("rg", `-${flag}`);
          }
        }
      } else if (pattern === null) {
        pattern = arg;
      } else {
        paths.push(arg);
      }
    }

    if (pattern === null) {
      return {
        stdout: "",
        stderr: "rg: no pattern given\n",
        exitCode: 2,
      };
    }

    // Default to current directory
    if (paths.length === 0) {
      paths.push(".");
    }

    // Smart case: case-insensitive unless pattern has uppercase
    let effectiveIgnoreCase = options.ignoreCase;
    if (options.smartCase && !options.ignoreCase) {
      effectiveIgnoreCase = !/[A-Z]/.test(pattern);
    }

    // Build regex
    let regex: RegExp;
    try {
      regex = buildRegex(pattern, {
        mode: options.fixedStrings ? "fixed" : "perl",
        ignoreCase: effectiveIgnoreCase,
        wholeWord: options.wordRegexp,
        lineRegexp: options.lineRegexp,
      });
    } catch {
      return {
        stdout: "",
        stderr: `rg: invalid regex: ${pattern}\n`,
        exitCode: 2,
      };
    }

    // Load gitignore files
    let gitignore: GitignoreManager | null = null;
    if (!options.noIgnore) {
      gitignore = await loadGitignores(ctx.fs, ctx.cwd);
    }

    // Collect files to search
    const files = await collectFiles(ctx, paths, options, gitignore);

    if (files.length === 0) {
      return {
        stdout: "",
        stderr: "",
        exitCode: 1,
      };
    }

    // Search files
    let stdout = "";
    let anyMatch = false;

    const BATCH_SIZE = 50;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      const results = await Promise.all(
        batch.map(async (file) => {
          try {
            const filePath = ctx.fs.resolvePath(ctx.cwd, file);
            const content = await ctx.fs.readFile(filePath);

            // Skip binary files (check for null bytes in first 8KB)
            const sample = content.slice(0, 8192);
            if (sample.includes("\0")) {
              return null;
            }

            const result = searchContent(content, regex, {
              invertMatch: options.invertMatch,
              showLineNumbers: options.lineNumber,
              countOnly: options.count,
              filename: file,
              onlyMatching: options.onlyMatching,
              beforeContext: options.beforeContext,
              afterContext: options.afterContext,
            });

            return { file, result };
          } catch {
            return null;
          }
        }),
      );

      for (const res of results) {
        if (!res) continue;

        const { file, result } = res;
        if (result.matched) {
          anyMatch = true;
          if (options.filesWithMatches) {
            stdout += `${file}\n`;
          } else if (!options.filesWithoutMatch) {
            stdout += result.output;
          }
        } else if (options.filesWithoutMatch) {
          stdout += `${file}\n`;
        }
      }
    }

    return {
      stdout,
      stderr: "",
      exitCode: anyMatch ? 0 : 1,
    };
  },
};

/**
 * Collect files to search based on paths and options
 */
async function collectFiles(
  ctx: CommandContext,
  paths: string[],
  options: RgOptions,
  gitignore: GitignoreManager | null,
): Promise<string[]> {
  const files: string[] = [];

  for (const path of paths) {
    const fullPath = ctx.fs.resolvePath(ctx.cwd, path);

    try {
      const stat = await ctx.fs.stat(fullPath);

      if (stat.isFile) {
        // Single file - check filters
        if (shouldIncludeFile(path, options, gitignore, fullPath)) {
          files.push(path);
        }
      } else if (stat.isDirectory) {
        // Directory - recurse
        await walkDirectory(ctx, path, fullPath, 0, options, gitignore, files);
      }
    } catch {
      // Path doesn't exist - skip silently
    }
  }

  return files.sort();
}

/**
 * Recursively walk a directory and collect matching files
 */
async function walkDirectory(
  ctx: CommandContext,
  relativePath: string,
  absolutePath: string,
  depth: number,
  options: RgOptions,
  gitignore: GitignoreManager | null,
  files: string[],
): Promise<void> {
  if (depth > options.maxDepth) {
    return;
  }

  try {
    const entries = ctx.fs.readdirWithFileTypes
      ? await ctx.fs.readdirWithFileTypes(absolutePath)
      : (await ctx.fs.readdir(absolutePath)).map((name) => ({
          name,
          isFile: undefined as boolean | undefined,
        }));

    for (const entry of entries) {
      const name = entry.name;

      // Skip hidden files unless --hidden
      if (!options.hidden && name.startsWith(".")) {
        continue;
      }

      // Skip common ignored directories early (optimization)
      if (!options.noIgnore && GitignoreManager.isCommonIgnored(name)) {
        continue;
      }

      const entryRelativePath =
        relativePath === "." ? name : `${relativePath}/${name}`;
      const entryAbsolutePath = ctx.fs.resolvePath(absolutePath, name);

      // Determine if file or directory
      let isFile: boolean;
      let isDirectory: boolean;

      if (entry.isFile !== undefined) {
        isFile = entry.isFile;
        isDirectory = !entry.isFile;
      } else {
        try {
          const stat = await ctx.fs.stat(entryAbsolutePath);
          isFile = stat.isFile;
          isDirectory = stat.isDirectory;
        } catch {
          continue;
        }
      }

      // Check gitignore
      if (gitignore?.matches(entryAbsolutePath, isDirectory)) {
        continue;
      }

      if (isDirectory) {
        await walkDirectory(
          ctx,
          entryRelativePath,
          entryAbsolutePath,
          depth + 1,
          options,
          gitignore,
          files,
        );
      } else if (isFile) {
        if (
          shouldIncludeFile(
            entryRelativePath,
            options,
            gitignore,
            entryAbsolutePath,
          )
        ) {
          files.push(entryRelativePath);
        }
      }
    }
  } catch {
    // Directory read failed - skip
  }
}

/**
 * Check if a file should be included based on filters
 */
function shouldIncludeFile(
  relativePath: string,
  options: RgOptions,
  gitignore: GitignoreManager | null,
  absolutePath: string,
): boolean {
  const filename = relativePath.split("/").pop() || relativePath;

  // Check gitignore (for single files specified directly)
  if (gitignore?.matches(absolutePath, false)) {
    return false;
  }

  // Check type filters
  if (options.types.length > 0) {
    if (!matchesType(filename, options.types)) {
      return false;
    }
  }

  // Check type-not filters
  if (options.typesNot.length > 0) {
    if (matchesType(filename, options.typesNot)) {
      return false;
    }
  }

  // Check glob filters
  // Separate positive and negative globs
  if (options.globs.length > 0) {
    const positiveGlobs = options.globs.filter((g) => !g.startsWith("!"));
    const negativeGlobs = options.globs
      .filter((g) => g.startsWith("!"))
      .map((g) => g.slice(1));

    // If there are positive globs, file must match at least one
    if (positiveGlobs.length > 0) {
      let matchesPositive = false;
      for (const glob of positiveGlobs) {
        if (matchGlob(filename, glob) || matchGlob(relativePath, glob)) {
          matchesPositive = true;
          break;
        }
      }
      if (!matchesPositive) {
        return false;
      }
    }

    // If there are negative globs, file must not match any
    for (const glob of negativeGlobs) {
      if (matchGlob(filename, glob) || matchGlob(relativePath, glob)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Simple glob matching (negation handled by caller)
 */
function matchGlob(str: string, pattern: string): boolean {
  // Convert glob to regex
  let regexStr = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        regexStr += ".*";
        i++;
      } else {
        regexStr += "[^/]*";
      }
    } else if (char === "?") {
      regexStr += "[^/]";
    } else if (char === "[") {
      // Find closing ]
      let j = i + 1;
      if (j < pattern.length && pattern[j] === "!") j++;
      if (j < pattern.length && pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") j++;
      if (j < pattern.length) {
        let charClass = pattern.slice(i, j + 1);
        if (charClass.startsWith("[!")) {
          charClass = `[^${charClass.slice(2)}`;
        }
        regexStr += charClass;
        i = j;
      } else {
        regexStr += "\\[";
      }
    } else {
      regexStr += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  regexStr += "$";

  return new RegExp(regexStr, "i").test(str);
}
