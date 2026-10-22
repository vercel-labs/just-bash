/**
 * Core search logic for rg command
 */

import { gunzipSync } from "node:zlib";
import { BoundedStringBuilder } from "../../bounded-builder.js";
import {
  decodeBytesToUtf8,
  encodeUtf8ToBytes,
  latin1FromBytes,
  readBytesFrom,
  unsafeBytesFromLatin1,
  utf8ByteLength,
} from "../../encoding.js";
import type { ResourceLease } from "../../execution-scope.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { FileTraversalBudget } from "../../fs/traversal.js";
import { shellJoinArgs } from "../../helpers/shell-quote.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { createUserRegex, type UserRegex } from "../../regex/index.js";
import { readCommandStdin } from "../../streams/command-stdio.js";
import type { ExecResult, RuntimeCommandContext } from "../../types.js";
import {
  buildRegex,
  convertReplacement,
  type RegexResult,
  searchContent,
} from "../search-engine/index.js";
import { FileTypeRegistry } from "./file-types.js";
import { GitignoreManager, loadGitignores } from "./gitignore.js";
import type { RgOptions } from "./rg-options.js";

/**
 * Check if data is gzip compressed (magic bytes)
 */
function isGzip(data: Uint8Array): boolean {
  return data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
}

/**
 * Validate glob pattern for errors (e.g., unclosed character class)
 * Returns error message if invalid, null if valid
 */
function validateGlob(glob: string): string | null {
  // Check for unclosed character class
  let inClass = false;
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === "[" && !inClass) {
      inClass = true;
    } else if (char === "]" && inClass) {
      inClass = false;
    }
  }
  if (inClass) {
    return `rg: glob '${glob}' has an unclosed character class`;
  }
  return null;
}

export interface SearchContext {
  ctx: RuntimeCommandContext;
  options: RgOptions;
  paths: string[];
  explicitLineNumbers: boolean;
}

function reservePatternSource(
  ctx: RuntimeCommandContext,
  bytes: number,
): ResourceLease {
  // The raw bytes, decoded string, and retained per-line strings can coexist
  // until the combined regex is compiled. Reject prospectively before the
  // filesystem allocates any of them.
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    bytes > ctx.limits.maxStringLength ||
    bytes > Math.floor(ctx.limits.maxLiveBytes / 3)
  ) {
    throw new ExecutionLimitError(
      bytes > ctx.limits.maxStringLength
        ? `rg: pattern file exceeds string limit (${ctx.limits.maxStringLength} bytes)`
        : `rg: live byte limit exceeded (${ctx.limits.maxLiveBytes} bytes)`,
      "string_length",
    );
  }
  return (
    ctx.executionScope?.reserveBytes("rg pattern files", bytes * 3, "rg") ?? {
      release: () => undefined,
    }
  );
}

function appendPatternLines(
  patterns: string[],
  content: string,
  ctx: RuntimeCommandContext,
): void {
  let lineStart = 0;
  for (let index = 0; index <= content.length; index++) {
    if (index < content.length && content.charCodeAt(index) !== 10) continue;
    if (index > lineStart) {
      if (patterns.length >= ctx.limits.maxArrayElements) {
        throw new ExecutionLimitError(
          `rg: pattern limit exceeded (${ctx.limits.maxArrayElements})`,
          "iterations",
        );
      }
      ctx.executionScope?.consumeWork(1, "rg pattern insertion");
      patterns.push(content.slice(lineStart, index));
    }
    lineStart = index + 1;
  }
}

function accountPatternInput(
  ctx: RuntimeCommandContext,
  bytes: number,
  aggregateBytes: number,
): number {
  if (bytes > ctx.limits.maxInputBytes - aggregateBytes) {
    throw new ExecutionLimitError(
      `rg: aggregate input size limit exceeded (${ctx.limits.maxInputBytes} bytes)`,
      "string_length",
    );
  }
  ctx.executionScope?.consumeInput(bytes, "rg pattern files");
  return aggregateBytes + bytes;
}

/**
 * Execute the search with parsed options
 */
export async function executeSearch(
  searchCtx: SearchContext,
): Promise<ExecResult> {
  const { ctx, options, paths: inputPaths, explicitLineNumbers } = searchCtx;

  // Validate glob patterns for errors
  for (const glob of [...options.globs, ...options.iglobs]) {
    const globToValidate = glob.startsWith("!") ? glob.slice(1) : glob;
    const error = validateGlob(globToValidate);
    if (error) {
      return { stdout: "", stderr: `${error}\n`, exitCode: 2 };
    }
  }

  // Validate types after applying custom definitions, but before searching.
  const typeRegistry = new FileTypeRegistry();
  for (const name of options.typeClear) typeRegistry.clearType(name);
  for (const spec of options.typeAdd) typeRegistry.addType(spec);
  for (const type of [...options.types, ...options.typesNot]) {
    if (type !== "all" && !typeRegistry.getType(type)) {
      return {
        stdout: "",
        stderr: `rg: unrecognized file type: ${type}\n`,
        exitCode: 2,
      };
    }
  }

  // In --files mode, positional args (including the pattern) are paths.
  if (options.files) {
    const filesPaths = [...options.patterns, ...inputPaths];
    return listFiles(ctx, filesPaths, options, typeRegistry);
  }

  if (options.patterns.length > ctx.limits.maxArrayElements) {
    throw new ExecutionLimitError(
      `rg: pattern limit exceeded (${ctx.limits.maxArrayElements})`,
      "iterations",
    );
  }

  // Combine -e patterns with patterns from files. Pattern-file source and its
  // decoded lines remain live until regex compilation completes, so keep a
  // conservative lease for every source and release all of them together.
  const patterns = options.patterns.slice();
  let patternStdin: Awaited<ReturnType<typeof readCommandStdin>> | undefined;
  const patternSourceLeases: ResourceLease[] = [];
  let aggregatePatternInputBytes = 0;
  let regex: UserRegex;
  let kResetGroup: number | undefined;
  try {
    // Read patterns from files (-f/--file). Patterns are regex source — decode
    // bytes to UTF-8 so unicode-class patterns work. Scan incrementally instead
    // of split/filter/spread, which would create multiple unbounded arrays and
    // could overflow the argument stack on a large pattern file.
    for (const patternFile of options.patternFiles) {
      try {
        let rawContent: Parameters<typeof decodeBytesToUtf8>[0];
        let contentBytes: number;

        if (patternFile === "-") {
          patternStdin ??= await readCommandStdin(ctx);
          rawContent = patternStdin;
          contentBytes = latin1FromBytes(rawContent).length;
          aggregatePatternInputBytes = accountPatternInput(
            ctx,
            contentBytes,
            aggregatePatternInputBytes,
          );
        } else {
          const filePath = ctx.fs.resolvePath(ctx.cwd, patternFile);
          const stat = await ctx.fs.stat(filePath);
          contentBytes = stat.size;
          aggregatePatternInputBytes = accountPatternInput(
            ctx,
            contentBytes,
            aggregatePatternInputBytes,
          );
          const lease = reservePatternSource(ctx, contentBytes);
          patternSourceLeases.push(lease);
          rawContent = await readBytesFrom(ctx.fs, filePath);
          const actualBytes = latin1FromBytes(rawContent).length;
          if (actualBytes > contentBytes) {
            throw new ExecutionLimitError(
              "rg: pattern file grew while being read",
              "string_length",
            );
          }
          contentBytes = actualBytes;
        }

        if (patternFile === "-") {
          patternSourceLeases.push(reservePatternSource(ctx, contentBytes));
        }

        const content = decodeBytesToUtf8(
          rawContent,
          ctx.limits.maxStringLength,
        );
        ctx.executionScope?.consumeWork(
          content.length,
          "rg pattern file parsing",
        );
        appendPatternLines(patterns, content, ctx);
      } catch (error) {
        rethrowFatalExecutionError(error);
        return {
          stdout: "",
          stderr: `rg: ${patternFile}: No such file or directory\n`,
          exitCode: 2,
        };
      }
    }

    if (patterns.length === 0) {
      // If patterns came from files but all were empty, return no-match (exit 1)
      // Otherwise return error for no pattern given (exit 2)
      if (options.patternFiles.length > 0) {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      return {
        stdout: "",
        stderr: "rg: no pattern given\n",
        exitCode: 2,
      };
    }

    // An omitted limit is unlimited; an explicit zero makes matches impossible.
    // https://github.com/BurntSushi/ripgrep/blob/15.2.0/crates/core/flags/hiargs.rs#L516-L528
    if (options.maxCount === 0) {
      return { stdout: "", stderr: "", exitCode: 1 };
    }

    // Determine case sensitivity and compile while pattern storage is leased.
    const effectiveIgnoreCase = determineIgnoreCase(options, patterns);
    try {
      const regexResult = buildSearchRegex(
        patterns,
        options,
        effectiveIgnoreCase,
      );
      regex = regexResult.regex;
      kResetGroup = regexResult.kResetGroup;
    } catch {
      return {
        stdout: "",
        stderr: `rg: invalid regex: ${patterns.join(", ")}\n`,
        exitCode: 2,
      };
    }
  } finally {
    for (const lease of patternSourceLeases) lease.release();
  }

  // If no paths are given and stdin was provided, search stdin (like real rg).
  // Pipeline stages and explicit redirections can provide an empty stdin, which
  // must still suppress rg's fallback recursive search of the current directory.
  // Skip when `-f -` already consumed stdin for patterns to avoid
  // double-consuming it as both pattern source and search input.
  const stdinConsumedByPatternFile = options.patternFiles.includes("-");
  const stdinText =
    inputPaths.length === 0 && !stdinConsumedByPatternFile
      ? decodeBytesToUtf8(await readCommandStdin(ctx))
      : "";
  if (
    inputPaths.length === 0 &&
    (ctx.stdinProvided || stdinText.length > 0) &&
    !ctx.stdinUnavailable &&
    !stdinConsumedByPatternFile
  ) {
    const content = stdinText;
    const result = searchContent(content, regex, {
      invertMatch: options.invertMatch,
      showLineNumbers: options.lineNumber,
      countOnly: options.count,
      countMatches: options.countMatches,
      filename: "",
      onlyMatching: options.onlyMatching,
      beforeContext: options.beforeContext,
      afterContext: options.afterContext,
      maxCount: options.maxCount,
      contextSeparator: options.contextSeparator,
      showColumn: options.column,
      vimgrep: options.vimgrep,
      showByteOffset: options.byteOffset,
      replace:
        options.replace !== null ? convertReplacement(options.replace) : null,
      passthru: options.passthru,
      multiline: options.multiline,
      kResetGroup,
      maxWork: ctx.limits.maxLoopIterations,
      maxMatches: ctx.limits.maxArrayElements,
      signal: ctx.signal,
    });

    if (options.quiet) {
      return { stdout: "", stderr: "", exitCode: result.matched ? 0 : 1 };
    }

    if (options.filesWithMatches) {
      return {
        stdout: result.matched ? "(standard input)\n" : "",
        stderr: "",
        exitCode: result.matched ? 0 : 1,
      };
    }

    if (options.filesWithoutMatch) {
      return {
        stdout: result.matched ? "" : "(standard input)\n",
        stderr: "",
        exitCode: result.matched ? 1 : 0,
      };
    }

    return {
      stdout: result.output,
      stderr: "",
      exitCode: result.matched ? 0 : 1,
    };
  }

  // Explicit "." keeps the ./ prefix; an implicit current directory does not.
  // https://github.com/BurntSushi/ripgrep/blob/15.2.0/crates/core/flags/hiargs.rs#L1051-L1064
  const paths =
    inputPaths.length === 0
      ? ["."]
      : inputPaths.map((path) => (path === "." ? "./" : path));

  // Load gitignore files
  let gitignore: GitignoreManager | null = null;
  if (!options.noIgnore) {
    gitignore = await loadGitignores(
      ctx.fs,
      ctx.cwd,
      options.noIgnoreDot,
      options.noIgnoreVcs,
      options.ignoreFiles,
    );
  }

  // Ordinary pipelines consume the same globally ordered discovery lazily.
  if (ctx.stdio && !options.json && !options.stats) {
    const { files, singleExplicitFile, errors } = await discoverFiles(
      ctx,
      paths,
      options,
      gitignore,
      typeRegistry,
    );
    return searchFiles(
      ctx,
      files,
      regex,
      options,
      !options.noFilename && (options.withFilename || !singleExplicitFile),
      options.lineNumber &&
        (explicitLineNumbers || (!singleExplicitFile && !options.onlyMatching)),
      errors,
      kResetGroup,
    );
  }

  // Collect files to search
  const { files, singleExplicitFile, errors } = await collectFiles(
    ctx,
    paths,
    options,
    gitignore,
    typeRegistry,
  );

  if (files.length === 0) {
    return {
      stdout: "",
      stderr: errors.build(),
      exitCode: errors.byteLength ? 2 : 1,
    };
  }

  // Determine output settings
  const showFilename =
    !options.noFilename &&
    (options.withFilename || !singleExplicitFile || files.length > 1);

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
    errors,
    kResetGroup,
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
): RegexResult {
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
    multilineDotall: options.multilineDotall,
  });
}

interface CollectFilesResult {
  files: string[];
  singleExplicitFile: boolean;
  errors: BoundedStringBuilder;
}

/**
 * Collect files to search based on paths and options
 */
async function collectFiles(
  ctx: RuntimeCommandContext,
  paths: string[],
  options: RgOptions,
  gitignore: GitignoreManager | null,
  typeRegistry: FileTypeRegistry,
): Promise<CollectFilesResult> {
  const discovered = await discoverFiles(
    ctx,
    paths,
    options,
    gitignore,
    typeRegistry,
  );
  const files: string[] = [];
  for await (const file of discovered.files) {
    if (files.length >= ctx.limits.maxArrayElements) {
      throw new ExecutionLimitError(
        `rg: file collection limit exceeded (${ctx.limits.maxArrayElements})`,
        "array_elements",
      );
    }
    files.push(file);
  }
  return {
    files,
    singleExplicitFile: discovered.singleExplicitFile,
    errors: discovered.errors,
  };
}

async function discoverFiles(
  ctx: RuntimeCommandContext,
  paths: string[],
  options: RgOptions,
  gitignore: GitignoreManager | null,
  typeRegistry: FileTypeRegistry,
): Promise<{
  files: AsyncGenerator<string>;
  singleExplicitFile: boolean;
  errors: BoundedStringBuilder;
}> {
  const sources: AsyncGenerator<string>[] = [];
  const errors = new BoundedStringBuilder(
    Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength),
    "rg",
  );

  const traversalBudget = new FileTraversalBudget({
    limits: ctx.limits,
    signal: ctx.signal,
    executionScope: ctx.executionScope,
    site: "rg",
  });
  const admittedExplicitFiles = new Set<string>();
  let explicitFileCount = 0;
  let directoryCount = 0;
  for (const path of paths) {
    traversalBudget.checkpoint();
    const fullPath = ctx.fs.resolvePath(ctx.cwd, path);
    try {
      const stat = await ctx.fs.stat(fullPath);
      if (stat.isFile) {
        explicitFileCount++;
        if (options.maxFilesize <= 0 || stat.size <= options.maxFilesize) {
          admittedExplicitFiles.add(path);
          sources.push(
            (async function* () {
              yield path;
            })(),
          );
        }
      } else if (stat.isDirectory) {
        directoryCount++;
        sources.push(
          walkDirectory(
            ctx,
            path,
            fullPath,
            0,
            options,
            gitignore,
            typeRegistry,
            errors,
            traversalBudget,
            new Set(),
          ),
        );
      }
    } catch (error) {
      rethrowFatalExecutionError(error);
      errors.append(`rg: ${path}: Unable to access path\n`);
    }
  }
  const files = mergeFileSources(sources, options.sort === "path");
  return {
    files:
      directoryCount > 0
        ? filterFileSizes(ctx, files, options, errors, admittedExplicitFiles)
        : files,
    singleExplicitFile:
      paths.length === 1 && explicitFileCount === 1 && directoryCount === 0,
    errors,
  };
}

/** Merge sorted roots without collecting their complete directory trees. */
async function* mergeFileSources(
  sources: AsyncGenerator<string>[],
  sorted: boolean,
): AsyncGenerator<string> {
  try {
    if (!sorted) {
      for (const source of sources) yield* source;
      return;
    }
    const heap: { path: string; source: number }[] = [];
    const before = (a: (typeof heap)[number], b: (typeof heap)[number]) =>
      a.path < b.path || (a.path === b.path && a.source < b.source);
    const push = (entry: (typeof heap)[number]) => {
      let i = heap.length;
      heap.push(entry);
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (!before(entry, heap[parent])) break;
        heap[i] = heap[parent];
        i = parent;
      }
      heap[i] = entry;
    };
    for (let i = 0; i < sources.length; i++) {
      const head = await sources[i].next();
      if (!head.done) push({ path: head.value, source: i });
    }
    while (heap.length) {
      const first = heap[0];
      const last = heap.pop();
      if (heap.length && last) {
        let i = 0;
        while (2 * i + 1 < heap.length) {
          let child = 2 * i + 1;
          if (child + 1 < heap.length && before(heap[child + 1], heap[child]))
            child++;
          if (!before(heap[child], last)) break;
          heap[i] = heap[child];
          i = child;
        }
        heap[i] = last;
      }
      yield first.path;
      const next = await sources[first.source].next();
      if (!next.done) push({ path: next.value, source: first.source });
    }
  } finally {
    for (const source of sources) await source.return(undefined);
  }
}

/**
 * Recursively walk a directory and collect matching files
 */
async function* walkDirectory(
  ctx: RuntimeCommandContext,
  relativePath: string,
  absolutePath: string,
  depth: number,
  options: RgOptions,
  gitignore: GitignoreManager | null,
  typeRegistry: FileTypeRegistry,
  errors: BoundedStringBuilder,
  budget: FileTraversalBudget,
  activeDirectories: Set<string>,
): AsyncGenerator<string> {
  if (depth >= options.maxDepth) {
    return;
  }
  budget.visit(depth);

  let directoryIdentity: string | undefined;
  if (options.followSymlinks) {
    try {
      const stat = await ctx.fs.stat(absolutePath);
      directoryIdentity =
        stat.identity !== undefined
          ? `identity:${stat.identity}`
          : stat.dev !== undefined && stat.ino !== undefined
            ? `inode:${String(stat.dev)}:${String(stat.ino)}`
            : `path:${await ctx.fs.realpath(absolutePath)}`;
      if (activeDirectories.has(directoryIdentity)) return;
      activeDirectories.add(directoryIdentity);
    } catch (error) {
      rethrowFatalExecutionError(error);
      return;
    }
  }

  // Load ignore files for this directory (per-directory ignore loading)
  if (gitignore) {
    await gitignore.loadForDirectory(absolutePath);
  }

  try {
    const entries = ctx.fs.readdirWithFileTypes
      ? await ctx.fs.readdirWithFileTypes(absolutePath)
      : (await ctx.fs.readdir(absolutePath)).map((name) => ({
          name,
          isFile: undefined as boolean | undefined,
        }));

    if (options.sort === "path") {
      if (entries.length > ctx.limits.maxArrayElements) {
        throw new ExecutionLimitError(
          `rg: directory entry limit exceeded (${ctx.limits.maxArrayElements})`,
          "array_elements",
        );
      }
      const keys = new Map<string, string>();
      for (const entry of entries) {
        budget.checkpoint(0);
        let isDirectory = "isDirectory" in entry && entry.isDirectory === true;
        if (
          entry.isFile === undefined ||
          (options.followSymlinks &&
            "isSymbolicLink" in entry &&
            entry.isSymbolicLink)
        ) {
          try {
            isDirectory = (
              await ctx.fs.stat(ctx.fs.resolvePath(absolutePath, entry.name))
            ).isDirectory;
          } catch (error) {
            rethrowFatalExecutionError(error);
          }
        }
        keys.set(entry.name, entry.name + (isDirectory ? "/" : ""));
      }
      entries.sort((a, b) => {
        const left = keys.get(a.name) as string;
        const right = keys.get(b.name) as string;
        return left < right ? -1 : left > right ? 1 : 0;
      });
    }

    for (const entry of entries) {
      budget.checkpoint();
      const name = entry.name;

      // Skip common ignored directories (VCS, node_modules, etc.)
      if (!options.noIgnore && GitignoreManager.isCommonIgnored(name)) {
        continue;
      }

      // Hidden file check is done after gitignore to allow negation patterns
      // to whitelist specific hidden files (e.g., "!.foo" in .gitignore)
      const isHidden = name.startsWith(".");

      const entryRelativePath =
        relativePath === "."
          ? name
          : relativePath === "./"
            ? `./${name}`
            : relativePath.endsWith("/")
              ? `${relativePath}${name}`
              : `${relativePath}/${name}`;
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
          } catch (error) {
            rethrowFatalExecutionError(error);
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
        } catch (error) {
          rethrowFatalExecutionError(error);
          if (!isSymlink) {
            errors.append(`rg: ${entryRelativePath}: Unable to access path\n`);
          }
          continue;
        }
      }

      const globOverride = matchGlobOverride(entryRelativePath, options);
      if (globOverride === false) continue;
      const gitignoreIgnored = gitignore?.matches(
        entryAbsolutePath,
        isDirectory,
      );
      if (gitignoreIgnored && globOverride !== true) {
        continue;
      }

      // Skip hidden files unless:
      // - --hidden is set, OR
      // - gitignore explicitly whitelists this file with a negation pattern (e.g., "!.foo")
      if (isHidden && !options.hidden && globOverride !== true) {
        const isWhitelisted = gitignore?.isWhitelisted(
          entryAbsolutePath,
          isDirectory,
        );
        if (!isWhitelisted) {
          continue;
        }
      }

      if (isDirectory) {
        yield* walkDirectory(
          ctx,
          entryRelativePath,
          entryAbsolutePath,
          depth + 1,
          options,
          gitignore,
          typeRegistry,
          errors,
          budget,
          activeDirectories,
        );
      } else if (isFile) {
        budget.visit(depth + 1);

        if (
          shouldIncludeFile(
            entryRelativePath,
            options,
            gitignore,
            entryAbsolutePath,
            typeRegistry,
          )
        ) {
          yield entryRelativePath;
        }
      }
    }
  } catch (error) {
    rethrowFatalExecutionError(error);
    errors.append(`rg: ${relativePath}: Unable to read directory\n`);
  } finally {
    if (directoryIdentity !== undefined) {
      activeDirectories.delete(directoryIdentity);
    }
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
  typeRegistry: FileTypeRegistry,
): boolean {
  const filename = relativePath.split("/").pop() || relativePath;

  const globOverride = matchGlobOverride(relativePath, options);
  if (globOverride !== undefined) return globOverride;
  if (
    options.globs.some((glob) => !glob.startsWith("!")) ||
    options.iglobs.some((glob) => !glob.startsWith("!"))
  )
    return false;

  if (gitignore?.matches(absolutePath, false)) return false;
  if (
    options.types.length > 0 &&
    !typeRegistry.matchesType(filename, options.types)
  )
    return false;
  if (
    options.typesNot.length > 0 &&
    typeRegistry.matchesType(filename, options.typesNot)
  )
    return false;

  return true;
}

// Explicit glob matches override ignore rules, hidden filtering, and types.
// Unmatched directories must remain traversable even with positive globs.
// https://github.com/BurntSushi/ripgrep/blob/15.2.0/crates/ignore/src/dir.rs#L505-L541
function matchGlobOverride(
  path: string,
  options: RgOptions,
): boolean | undefined {
  const relativePath = path.replace(/^\.\//, "");
  const filename = relativePath.split("/").pop() || relativePath;
  // rg appends iglobs after globs, independent of their CLI ordering.
  // Scan that unified override order backwards so the last match wins.
  // https://github.com/BurntSushi/ripgrep/blob/15.2.0/crates/core/flags/hiargs.rs#L1210-L1231
  for (
    let index = options.globs.length + options.iglobs.length - 1;
    index >= 0;
    index--
  ) {
    const isIglob = index >= options.globs.length;
    const value = isIglob
      ? options.iglobs[index - options.globs.length]
      : options.globs[index];
    const ignoreCase = isIglob || options.globCaseInsensitive;
    const negative = value.startsWith("!");
    const glob = negative ? value.slice(1) : value;
    const matched = glob.startsWith("/")
      ? matchGlob(relativePath, glob.slice(1), ignoreCase)
      : matchGlob(filename, glob, ignoreCase) ||
        matchGlob(relativePath, glob, ignoreCase);
    if (matched) return !negative;
  }
  return undefined;
}

/**
 * Simple glob matching
 */
function matchGlob(str: string, pattern: string, ignoreCase = false): boolean {
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

  return createUserRegex(regexStr, ignoreCase ? "i" : "").test(str);
}

/**
 * List files that would be searched (--files mode)
 */
async function listFiles(
  ctx: RuntimeCommandContext,
  inputPaths: string[],
  options: RgOptions,
  typeRegistry: FileTypeRegistry,
): Promise<ExecResult> {
  // Load gitignore files
  let gitignore: GitignoreManager | null = null;
  if (!options.noIgnore) {
    gitignore = await loadGitignores(
      ctx.fs,
      ctx.cwd,
      options.noIgnoreDot,
      options.noIgnoreVcs,
      options.ignoreFiles,
    );
  }

  // Default to current directory
  const paths = inputPaths.length === 0 ? ["."] : inputPaths;

  const { files, errors } = await discoverFiles(
    ctx,
    paths,
    options,
    gitignore,
    typeRegistry,
  );
  const sep = options.nullSeparator ? "\0" : "\n";
  const output = new BoundedStringBuilder(
    Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength),
    "rg",
  );
  let found = false;
  for await (const file of files) {
    found = true;
    if (options.quiet) continue;
    if (ctx.stdio) {
      await ctx.stdio.write(encodeUtf8ToBytes(file + sep));
    } else {
      output.append(file).append(sep);
    }
  }
  return {
    stdout: output.build(),
    stderr: errors.build(),
    exitCode: errors.byteLength ? 2 : found ? 0 : 1,
  };
}

/**
 * Check if a file matches any pre-glob patterns
 */
function matchesPreGlob(filename: string, preGlobs: string[]): boolean {
  if (preGlobs.length === 0) return true; // No patterns = match all

  for (const glob of preGlobs) {
    if (matchGlob(filename, glob, false)) {
      return true;
    }
  }
  return false;
}

/**
 * Read file content, handling preprocessing and gzip decompression if needed
 */
async function readFileContent(
  ctx: RuntimeCommandContext,
  filePath: string,
  file: string,
  options: RgOptions,
  errors: BoundedStringBuilder,
): Promise<{
  content: string;
  isBinary: boolean;
  lease?: ResourceLease;
} | null> {
  let lease: ResourceLease | undefined;
  try {
    // Check for preprocessing with --pre
    if (options.preprocessor && ctx.exec) {
      const filename = file.split("/").pop() || file;
      if (matchesPreGlob(filename, options.preprocessorGlobs)) {
        // Run preprocessor on this file
        const result = await ctx.exec(shellJoinArgs([options.preprocessor]), {
          cwd: ctx.cwd,
          signal: ctx.signal,
          args: [filePath],
        });
        if (result.exitCode === 0 && result.stdout) {
          // Preprocessor output arrives as a latin1 byte buffer in the
          // pipeline; decode for regex matching. Empty output falls through.
          lease = ctx.executionScope?.reserveBytes(
            "rg preprocessor text",
            result.stdout.length,
            "rg preprocessor",
          );
          const content = decodeBytesToUtf8(
            unsafeBytesFromLatin1(result.stdout),
          );
          ctx.executionScope?.consumeInput(
            utf8ByteLength(content),
            "rg preprocessor",
          );
          const sample = content.slice(0, 8192);
          return { content, isBinary: sample.includes("\0"), lease };
        }
        // Preprocessing failed, fall through to normal file read
      }
    }

    // For -z option, try to decompress gzip files
    if (options.searchZip && file.endsWith(".gz")) {
      const stat = await ctx.fs.stat(filePath);
      const inputLease = ctx.executionScope?.reserveBytes(
        "rg compressed input",
        stat.size,
        "rg",
      );
      const buffer = await ctx.fs.readFileBuffer(filePath);
      if (buffer.byteLength > stat.size) {
        inputLease?.release();
        throw new ExecutionLimitError(
          "rg: file grew while being read",
          "string_length",
        );
      }
      ctx.executionScope?.consumeInput(buffer.byteLength, "rg");
      if (isGzip(buffer)) {
        let outputLease: ResourceLease | undefined;
        try {
          // The decoded string can coexist with zlib's output buffer. Reserve
          // both before invoking the whole-buffer codec.
          const outputCapacity = Math.min(
            ctx.limits.maxStringLength,
            ctx.limits.maxOutputSize,
            Math.floor(
              (ctx.executionScope?.remainingLiveBytes ??
                ctx.limits.maxLiveBytes) / 2,
            ),
          );
          outputLease = ctx.executionScope?.reserveBytes(
            "rg decompressed text",
            outputCapacity * 2,
            "rg",
          );
          // @banned-pattern-ignore: zlib maxOutputLength is derived from resolved execution byte limits
          const decompressed = gunzipSync(buffer, {
            maxOutputLength: outputCapacity,
          });
          const content = new TextDecoder().decode(decompressed);
          const sample = content.slice(0, 8192);
          return {
            content,
            isBinary: sample.includes("\0"),
            lease: compositeLease(inputLease, outputLease),
          };
        } catch (error) {
          outputLease?.release();
          inputLease?.release();
          rethrowFatalExecutionError(error);
          return null; // Decompression failed
        }
      }
      inputLease?.release();
    }

    // Regular file read
    const stat = await ctx.fs.stat(filePath);
    // A filesystem read can transiently retain its byte buffer while creating
    // the decoded string, so account for both representations prospectively.
    lease = ctx.executionScope?.reserveBytes(
      "rg file text",
      stat.size * 2,
      "rg",
    );
    const rawContent = await readBytesFrom(ctx.fs, filePath);
    const contentBytes = latin1FromBytes(rawContent).length;
    if (contentBytes > stat.size) {
      throw new ExecutionLimitError(
        "rg: file grew while being read",
        "string_length",
      );
    }
    ctx.executionScope?.consumeInput(contentBytes, "rg");
    const content = decodeBytesToUtf8(rawContent, ctx.limits.maxStringLength);
    const sample = content.slice(0, 8192);
    return { content, isBinary: sample.includes("\0"), lease };
  } catch (error) {
    lease?.release();
    rethrowFatalExecutionError(error);
    // Keep diagnostics guest-path based; filesystem messages may expose host paths.
    errors.append(`rg: ${file}: Unable to read file\n`);
    return null;
  }
}

function compositeLease(
  ...leases: Array<ResourceLease | undefined>
): ResourceLease | undefined {
  const active = leases.filter(
    (item): item is ResourceLease => item !== undefined,
  );
  if (active.length === 0) return undefined;
  return {
    release: () => {
      for (const item of active) item.release();
    },
  };
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
async function* fileBatches(
  files: string[] | AsyncIterable<string>,
  size: number,
  firstBatchSize = size,
): AsyncGenerator<string[]> {
  let batch: string[] = [];
  let limit = firstBatchSize;
  for await (const file of files) {
    batch.push(file);
    if (batch.length === limit) {
      yield batch;
      batch = [];
      limit = size;
    }
  }
  if (batch.length) yield batch;
}

/** Keep lazy metadata reads in the same bounded batches as file contents. */
async function* filterFileSizes(
  ctx: RuntimeCommandContext,
  files: AsyncIterable<string>,
  options: RgOptions,
  errors: BoundedStringBuilder,
  admittedExplicitFiles: ReadonlySet<string>,
): AsyncGenerator<string> {
  if (options.maxFilesize <= 0) {
    yield* files;
    return;
  }
  for await (const batch of fileBatches(files, options.searchZip ? 2 : 50, 1)) {
    const stats = await Promise.allSettled(
      batch.map((file) =>
        admittedExplicitFiles.has(file)
          ? undefined
          : ctx.fs.stat(ctx.fs.resolvePath(ctx.cwd, file)),
      ),
    );
    for (const result of stats)
      if (result.status === "rejected")
        rethrowFatalExecutionError(result.reason);
    for (const [index, result] of stats.entries()) {
      if (result.status === "rejected") {
        errors.append(`rg: ${batch[index]}: Unable to access path\n`);
      }
      if (
        result.status === "fulfilled" &&
        (result.value === undefined || result.value.size <= options.maxFilesize)
      ) {
        yield batch[index];
      }
    }
  }
}

async function searchFiles(
  ctx: RuntimeCommandContext,
  files: string[] | AsyncIterable<string>,
  regex: UserRegex,
  options: RgOptions,
  showFilename: boolean,
  effectiveLineNumbers: boolean,
  errors: BoundedStringBuilder,
  kResetGroup?: number,
): Promise<ExecResult> {
  let stdout = "";
  let hasOutput = false;
  let searchedFiles = 0;
  const streamingOutput =
    !options.json && !options.stats ? ctx.stdio : undefined;
  let anyMatch = false;

  // JSON mode tracking
  const jsonMessages: string[] = [];
  let totalMatches = 0;
  let filesWithMatch = 0;
  let bytesSearched = 0;

  // Compressed files retain both the decompressed byte buffer and decoded
  // string while being searched. Keep their concurrency deliberately small.
  const batchSize = options.searchZip ? 2 : 50;
  outer: for await (const batch of fileBatches(
    files,
    batchSize,
    streamingOutput ? 1 : batchSize,
  )) {
    // Observe downstream closure even when the next file has no matches.
    if (streamingOutput) await streamingOutput.write(unsafeBytesFromLatin1(""));
    searchedFiles += batch.length;

    const prepared = await Promise.allSettled(
      batch.map((file) =>
        readFileContent(
          ctx,
          ctx.fs.resolvePath(ctx.cwd, file),
          file,
          options,
          errors,
        ),
      ),
    );
    try {
      for (let index = 0; index < batch.length; index++) {
        if (streamingOutput)
          await streamingOutput.write(unsafeBytesFromLatin1(""));
        const file = batch[index];
        const read = prepared[index];
        if (read.status === "rejected") throw read.reason;
        const fileData = read.value;
        const res = (() => {
          if (!fileData) return null;

          const { content, isBinary, lease } = fileData;
          bytesSearched += content.length;

          // Skip binary files unless -a/--text is specified.
          if (isBinary && !options.searchBinary) {
            lease?.release();
            return null;
          }

          const filenameForSearch =
            showFilename &&
            (!options.heading || options.count || options.countMatches)
              ? file
              : "";
          try {
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
              replace:
                options.replace !== null
                  ? convertReplacement(options.replace)
                  : null,
              passthru: options.passthru,
              multiline: options.multiline,
              kResetGroup,
              maxWork: ctx.limits.maxLoopIterations,
              maxMatches: ctx.limits.maxArrayElements,
              signal: ctx.signal,
            });

            // JSON formatting below needs the source after this task ends, so
            // transfer lease ownership with the returned batch item.
            if (options.json && result.matched) {
              return { file, result, content, isBinary: false, lease };
            }

            lease?.release();
            return { file, result };
          } catch (error) {
            lease?.release();
            throw error;
          }
        })();
        if (!res) continue;

        const { result } = res;

        if (result.matched) {
          anyMatch = true;
          filesWithMatch++;
          totalMatches += result.matchCount;

          if (options.quiet && !options.json && !options.filesWithoutMatch) {
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
            // Keep main's heading separators when previous output has been flushed.
            if (options.heading && !options.count && !options.countMatches) {
              if (hasOutput || stdout) stdout += "\n";
              if (showFilename) stdout += `${file}\n`;
            }
            stdout += result.output;
          }
        } else if (options.filesWithoutMatch) {
          hasOutput = true;
          if (options.quiet && !options.json) break outer;
          const sep = options.nullSeparator ? "\0" : "\n";
          stdout += `${file}${sep}`;
        } else if (
          options.includeZero &&
          (options.count || options.countMatches)
        ) {
          stdout += result.output;
        }
        (res as { lease?: ResourceLease }).lease?.release();
        if (stdout) {
          hasOutput = true;
          if (streamingOutput && !options.quiet) {
            await streamingOutput.write(encodeUtf8ToBytes(stdout));
            stdout = "";
          }
        }
      }
    } finally {
      for (const read of prepared)
        if (read.status === "fulfilled") read.value?.lease?.release();
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
            searches: searchedFiles,
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
  let finalStdout = options.quiet && !options.json ? "" : stdout;

  // Add stats output if requested
  if (options.stats && !options.json) {
    const statsOutput = [
      "",
      `${totalMatches} matches`,
      `${totalMatches} matched lines`,
      `${filesWithMatch} files contained matches`,
      `${searchedFiles} files searched`,
      `${bytesSearched} bytes searched`,
    ].join("\n");
    finalStdout += `${statsOutput}\n`;
  }

  // Exit codes:
  // - For --files-without-match: 0 if files without matches found, 1 otherwise
  // - For normal mode: 0 if any matches found, 1 otherwise
  //
  // The --files-without-match rule below is NOT a copy of grep's and must not
  // be "fixed" to agree with it: ripgrep really does invert the status here,
  // where GNU grep does not. Measured with ripgrep 15.1.0 against GNU grep
  // 3.12, over two files where only the first contains the pattern:
  //
  //   both files match -> rg prints nothing, exits 1; grep -L exits 0
  //   neither matches  -> rg lists both,     exits 0; grep -L exits 1
  //   mixed            -> both list the miss and exit 0
  //
  // See the matching note in src/commands/grep/grep.ts.
  let exitCode: number;
  if (options.filesWithoutMatch) {
    // Success means we found files without matches (stdout has content)
    exitCode = hasOutput || stdout.length > 0 ? 0 : 1;
  } else {
    exitCode = anyMatch ? 0 : 1;
  }

  // Errors override matches, except that quiet mode succeeds on any match.
  // https://github.com/BurntSushi/ripgrep/blob/15.2.0/tests/regression.rs#L800-L839
  const stderr = errors.build();
  if (stderr && !(options.quiet && anyMatch)) exitCode = 2;

  // rg emits text; the pipeline handles encoding.
  return {
    stdout: finalStdout,
    stderr,
    exitCode,
  };
}
