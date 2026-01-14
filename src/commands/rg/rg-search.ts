/**
 * Core search logic for rg command
 */

import { gunzipSync } from "node:zlib";
import type { CommandContext, ExecResult } from "../../types.js";
import { buildRegex, searchContent } from "../search-engine/index.js";
import { matchesType } from "./file-types.js";
import { GitignoreManager, loadGitignores } from "./gitignore.js";
import type { RgOptions } from "./rg-options.js";

/**
 * Check if data is gzip compressed (magic bytes)
 */
function isGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

export interface SearchContext {
  ctx: CommandContext;
  options: RgOptions;
  paths: string[];
  explicitLineNumbers: boolean;
}

/**
 * Execute the search with parsed options
 */
export async function executeSearch(
  searchCtx: SearchContext,
): Promise<ExecResult> {
  const { ctx, options, paths: inputPaths, explicitLineNumbers } = searchCtx;

  // Combine -e patterns with patterns from files
  const patterns = [...options.patterns];

  // Read patterns from files (-f/--file)
  for (const patternFile of options.patternFiles) {
    try {
      const filePath = ctx.fs.resolvePath(ctx.cwd, patternFile);
      const content = await ctx.fs.readFile(filePath);
      const filePatterns = content
        .split("\n")
        .filter((line) => line.length > 0);
      patterns.push(...filePatterns);
    } catch {
      return {
        stdout: "",
        stderr: `rg: ${patternFile}: No such file or directory\n`,
        exitCode: 2,
      };
    }
  }

  if (patterns.length === 0) {
    return {
      stdout: "",
      stderr: "rg: no pattern given\n",
      exitCode: 2,
    };
  }

  // Default to current directory
  const paths = inputPaths.length === 0 ? ["."] : inputPaths;

  // Determine case sensitivity
  const effectiveIgnoreCase = determineIgnoreCase(options, patterns);

  // Build regex
  let regex: RegExp;
  try {
    regex = buildSearchRegex(patterns, options, effectiveIgnoreCase);
  } catch {
    return {
      stdout: "",
      stderr: `rg: invalid regex: ${patterns.join(", ")}\n`,
      exitCode: 2,
    };
  }

  // Load gitignore files
  let gitignore: GitignoreManager | null = null;
  if (!options.noIgnore) {
    gitignore = await loadGitignores(ctx.fs, ctx.cwd);
  }

  // Collect files to search
  const { files, singleExplicitFile } = await collectFiles(
    ctx,
    paths,
    options,
    gitignore,
  );

  if (files.length === 0) {
    return { stdout: "", stderr: "", exitCode: 1 };
  }

  // Determine output settings
  const showFilename =
    !options.noFilename && (!singleExplicitFile || files.length > 1);

  let effectiveLineNumbers = options.lineNumber;
  if (!explicitLineNumbers) {
    if (singleExplicitFile && files.length === 1) {
      effectiveLineNumbers = false;
    }
    if (options.onlyMatching) {
      effectiveLineNumbers = false;
    }
  }

  // Search files
  return searchFiles(
    ctx,
    files,
    regex,
    options,
    showFilename,
    effectiveLineNumbers,
  );
}

/**
 * Determine effective case sensitivity based on options
 */
function determineIgnoreCase(options: RgOptions, patterns: string[]): boolean {
  if (options.caseSensitive) {
    return false;
  }
  if (options.ignoreCase) {
    return true;
  }
  if (options.smartCase) {
    return !patterns.some((p) => /[A-Z]/.test(p));
  }
  return false;
}

/**
 * Build the search regex from patterns
 */
function buildSearchRegex(
  patterns: string[],
  options: RgOptions,
  ignoreCase: boolean,
): RegExp {
  let combinedPattern: string;
  if (patterns.length === 1) {
    combinedPattern = patterns[0];
  } else {
    combinedPattern = patterns
      .map((p) =>
        options.fixedStrings
          ? p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          : `(?:${p})`,
      )
      .join("|");
  }

  return buildRegex(combinedPattern, {
    mode: options.fixedStrings && patterns.length === 1 ? "fixed" : "perl",
    ignoreCase,
    wholeWord: options.wordRegexp,
    lineRegexp: options.lineRegexp,
    multiline: options.multiline,
  });
}

interface CollectFilesResult {
  files: string[];
  singleExplicitFile: boolean;
}

/**
 * Collect files to search based on paths and options
 */
async function collectFiles(
  ctx: CommandContext,
  paths: string[],
  options: RgOptions,
  gitignore: GitignoreManager | null,
): Promise<CollectFilesResult> {
  const files: string[] = [];
  let explicitFileCount = 0;
  let directoryCount = 0;

  for (const path of paths) {
    const fullPath = ctx.fs.resolvePath(ctx.cwd, path);

    try {
      const stat = await ctx.fs.stat(fullPath);

      if (stat.isFile) {
        explicitFileCount++;
        if (shouldIncludeFile(path, options, gitignore, fullPath)) {
          files.push(path);
        }
      } else if (stat.isDirectory) {
        directoryCount++;
        await walkDirectory(ctx, path, fullPath, 0, options, gitignore, files);
      }
    } catch {
      // Path doesn't exist - skip silently
    }
  }

  const sortedFiles = options.sort === "path" ? files.sort() : files;

  return {
    files: sortedFiles,
    singleExplicitFile: explicitFileCount === 1 && directoryCount === 0,
  };
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
  if (depth >= options.maxDepth) {
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

      if (!options.hidden && name.startsWith(".")) {
        continue;
      }

      if (!options.noIgnore && GitignoreManager.isCommonIgnored(name)) {
        continue;
      }

      const entryRelativePath =
        relativePath === "." ? name : `${relativePath}/${name}`;
      const entryAbsolutePath = ctx.fs.resolvePath(absolutePath, name);

      let isFile: boolean;
      let isDirectory: boolean;
      let isSymlink = false;

      // Check if entry has type info from readdirWithFileTypes
      const hasTypeInfo = entry.isFile !== undefined && "isDirectory" in entry;

      if (hasTypeInfo) {
        // Use type info from readdirWithFileTypes
        const dirent = entry as {
          name: string;
          isFile: boolean;
          isDirectory: boolean;
          isSymbolicLink?: boolean;
        };
        isSymlink = dirent.isSymbolicLink === true;

        if (isSymlink && !options.followSymlinks) {
          continue; // Skip symlinks unless -L is specified
        }

        if (isSymlink && options.followSymlinks) {
          // For symlinks with -L, stat the target to get actual type
          try {
            const stat = await ctx.fs.stat(entryAbsolutePath);
            isFile = stat.isFile;
            isDirectory = stat.isDirectory;
          } catch {
            continue; // Broken symlink, skip
          }
        } else {
          isFile = dirent.isFile;
          isDirectory = dirent.isDirectory;
        }
      } else {
        try {
          // Use lstat to detect symlinks
          const lstat = ctx.fs.lstat
            ? await ctx.fs.lstat(entryAbsolutePath)
            : await ctx.fs.stat(entryAbsolutePath);
          isSymlink = lstat.isSymbolicLink === true;

          if (isSymlink && !options.followSymlinks) {
            continue; // Skip symlinks unless -L is specified
          }

          // For symlinks with -L, stat the target
          const stat =
            isSymlink && options.followSymlinks
              ? await ctx.fs.stat(entryAbsolutePath)
              : lstat;
          isFile = stat.isFile;
          isDirectory = stat.isDirectory;
        } catch {
          continue;
        }
      }

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

  if (gitignore?.matches(absolutePath, false)) {
    return false;
  }

  if (options.types.length > 0 && !matchesType(filename, options.types)) {
    return false;
  }

  if (options.typesNot.length > 0 && matchesType(filename, options.typesNot)) {
    return false;
  }

  if (options.globs.length > 0) {
    const positiveGlobs = options.globs.filter((g) => !g.startsWith("!"));
    const negativeGlobs = options.globs
      .filter((g) => g.startsWith("!"))
      .map((g) => g.slice(1));

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

    for (const glob of negativeGlobs) {
      if (glob.startsWith("/")) {
        const rootedGlob = glob.slice(1);
        if (matchGlob(relativePath, rootedGlob)) {
          return false;
        }
      } else if (matchGlob(filename, glob) || matchGlob(relativePath, glob)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Simple glob matching
 */
function matchGlob(str: string, pattern: string): boolean {
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

  return new RegExp(regexStr).test(str);
}

/**
 * Read file content, handling gzip decompression if needed
 */
async function readFileContent(
  ctx: CommandContext,
  filePath: string,
  file: string,
  options: RgOptions,
): Promise<{ content: string; isBinary: boolean } | null> {
  try {
    // For -z option, try to decompress gzip files
    if (options.searchZip && file.endsWith(".gz")) {
      const buffer = await ctx.fs.readFileBuffer(filePath);
      if (isGzip(buffer)) {
        try {
          const decompressed = gunzipSync(buffer);
          const content = new TextDecoder().decode(decompressed);
          const sample = content.slice(0, 8192);
          return { content, isBinary: sample.includes("\0") };
        } catch {
          return null; // Decompression failed
        }
      }
    }

    // Regular file read
    const content = await ctx.fs.readFile(filePath);
    const sample = content.slice(0, 8192);
    return { content, isBinary: sample.includes("\0") };
  } catch {
    return null;
  }
}

/**
 * Format a single match for JSON output
 */
interface JsonSubmatch {
  match: { text: string };
  start: number;
  end: number;
  replacement?: { text: string };
}

interface JsonMatch {
  type: "match";
  data: {
    path: { text: string };
    lines: { text: string };
    line_number: number;
    absolute_offset: number;
    submatches: JsonSubmatch[];
  };
}

/**
 * Search files and produce output
 */
async function searchFiles(
  ctx: CommandContext,
  files: string[],
  regex: RegExp,
  options: RgOptions,
  showFilename: boolean,
  effectiveLineNumbers: boolean,
): Promise<ExecResult> {
  let stdout = "";
  let anyMatch = false;

  // JSON mode tracking
  const jsonMessages: string[] = [];
  let totalMatches = 0;
  let filesWithMatch = 0;
  let bytesSearched = 0;

  const BATCH_SIZE = 50;
  outer: for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async (file) => {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        const fileData = await readFileContent(ctx, filePath, file, options);

        if (!fileData) return null;

        const { content, isBinary } = fileData;
        bytesSearched += content.length;

        // Skip binary files unless -a/--text is specified
        if (isBinary && !options.searchBinary) {
          return null;
        }

        const filenameForSearch = showFilename && !options.heading ? file : "";

        const result = searchContent(content, regex, {
          invertMatch: options.invertMatch,
          showLineNumbers: effectiveLineNumbers,
          countOnly: options.count,
          countMatches: options.countMatches,
          filename: filenameForSearch,
          onlyMatching: options.onlyMatching,
          beforeContext: options.beforeContext,
          afterContext: options.afterContext,
          maxCount: options.maxCount,
          contextSeparator: options.contextSeparator,
          showColumn: options.column,
          vimgrep: options.vimgrep,
          showByteOffset: options.byteOffset,
          replace: options.replace,
          passthru: options.passthru,
          multiline: options.multiline,
        });

        // For JSON mode, we need to track matches differently
        if (options.json && result.matched) {
          return { file, result, content, isBinary: false };
        }

        return { file, result };
      }),
    );

    for (const res of results) {
      if (!res) continue;

      const { file, result } = res;

      if (result.matched) {
        anyMatch = true;
        filesWithMatch++;
        totalMatches += result.matchCount;

        if (options.quiet && !options.json) {
          // Quiet mode without JSON: exit early on first match
          break outer;
        }

        if (options.json && !options.quiet) {
          // JSON mode without quiet: output begin/match/end messages
          const content = (res as { content?: string }).content || "";
          jsonMessages.push(
            JSON.stringify({ type: "begin", data: { path: { text: file } } }),
          );

          // Find matches and output them
          const lines = content.split("\n");
          regex.lastIndex = 0;
          let lineOffset = 0;
          for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            regex.lastIndex = 0;
            const submatches: JsonSubmatch[] = [];

            for (
              let match = regex.exec(line);
              match !== null;
              match = regex.exec(line)
            ) {
              const submatch: JsonSubmatch = {
                match: { text: match[0] },
                start: match.index,
                end: match.index + match[0].length,
              };
              if (options.replace !== null) {
                submatch.replacement = { text: options.replace };
              }
              submatches.push(submatch);
              if (match[0].length === 0) regex.lastIndex++;
            }

            if (submatches.length > 0) {
              const matchMsg: JsonMatch = {
                type: "match",
                data: {
                  path: { text: file },
                  lines: { text: `${line}\n` },
                  line_number: lineIdx + 1,
                  absolute_offset: lineOffset,
                  submatches,
                },
              };
              jsonMessages.push(JSON.stringify(matchMsg));
            }
            lineOffset += line.length + 1;
          }

          jsonMessages.push(
            JSON.stringify({
              type: "end",
              data: {
                path: { text: file },
                binary_offset: null,
                stats: {
                  elapsed: { secs: 0, nanos: 0, human: "0s" },
                  searches: 1,
                  searches_with_match: 1,
                  bytes_searched: content.length,
                  bytes_printed: 0,
                  matched_lines: result.matchCount,
                  matches: result.matchCount,
                },
              },
            }),
          );
        } else if (options.filesWithMatches) {
          const sep = options.nullSeparator ? "\0" : "\n";
          stdout += `${file}${sep}`;
        } else if (!options.filesWithoutMatch) {
          if (options.heading && showFilename) {
            stdout += `${file}\n`;
          }
          stdout += result.output;
        }
      } else if (options.filesWithoutMatch) {
        const sep = options.nullSeparator ? "\0" : "\n";
        stdout += `${file}${sep}`;
      } else if (
        options.includeZero &&
        (options.count || options.countMatches)
      ) {
        stdout += result.output;
      }
    }
  }

  // Finalize JSON output
  if (options.json) {
    jsonMessages.push(
      JSON.stringify({
        type: "summary",
        data: {
          elapsed_total: { secs: 0, nanos: 0, human: "0s" },
          stats: {
            elapsed: { secs: 0, nanos: 0, human: "0s" },
            searches: files.length,
            searches_with_match: filesWithMatch,
            bytes_searched: bytesSearched,
            bytes_printed: 0,
            matched_lines: totalMatches,
            matches: totalMatches,
          },
        },
      }),
    );
    stdout = `${jsonMessages.join("\n")}\n`;
  }

  // In JSON + quiet mode, output only the summary (already built above)
  // In non-JSON quiet mode, output nothing
  const finalStdout = options.quiet && !options.json ? "" : stdout;

  // Exit codes:
  // - For --files-without-match: 0 if files without matches found, 1 otherwise
  // - For normal mode: 0 if any matches found, 1 otherwise
  let exitCode: number;
  if (options.filesWithoutMatch) {
    // Success means we found files without matches (stdout has content)
    exitCode = stdout.length > 0 ? 0 : 1;
  } else {
    exitCode = anyMatch ? 0 : 1;
  }

  return {
    stdout: finalStdout,
    stderr: "",
    exitCode,
  };
}
