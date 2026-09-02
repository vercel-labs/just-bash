import { decodeBytesToUtf8 } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { UserRegex } from "../../regex/index.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { matchGlob } from "../../utils/glob.js";
import { showHelp, unknownOption } from "../help.js";
import {
  buildRegex,
  type RegexMode,
  searchContent,
} from "../search-engine/index.js";

/**
 * The name GNU grep prints for the `-` operand. It appears wherever a real
 * file name would: the multi-file `file:line` prefix, `-l`/`-L` listings and
 * `-c` counts.
 */
const STDIN_FILENAME = "(standard input)";

/** File entry with optional type info from glob expansion */
interface FileEntry {
  path: string;
  isFile?: boolean; // undefined means we need to stat
  /** True for the `-` operand, which names standard input instead of a file. */
  isStdin?: boolean;
  /**
   * True when an earlier `-` already drained stdin. stdin is a stream, so the
   * second `-` of `grep pat - -` reads EOF and contributes nothing.
   */
  stdinAtEof?: boolean;
}

interface GrepTraversalBudget {
  operations: number;
  results: number;
  maxOperations: number;
  maxResults: number;
}

function getMatcherWorkLimit(ctx: RuntimeCommandContext): number {
  const loopLimit = ctx.limits.maxLoopIterations;
  const arrayLimit = ctx.limits.maxArrayElements;
  return Math.max(loopLimit, Math.min(arrayLimit, loopLimit * 10));
}

function useTraversalOperation(budget: GrepTraversalBudget): void {
  if (++budget.operations > budget.maxOperations) {
    throw new ExecutionLimitError(
      `grep: glob operation limit exceeded (${budget.maxOperations})`,
      "glob_operations",
    );
  }
}

function addTraversalResult(budget: GrepTraversalBudget): void {
  if (budget.results >= budget.maxResults) {
    throw new ExecutionLimitError(
      `grep: array element limit exceeded (${budget.maxResults})`,
      "array_elements",
    );
  }
  budget.results++;
}

/**
 * A regex that can never match anything, used when the pattern list is empty
 * (e.g. `grep -f /dev/null`). `[^\s\S]` is the empty character class: no
 * codepoint is both non-whitespace and non-non-whitespace. Wrapping it for
 * -w (`\b(?:...)\b`) or -x (`^(?:...)$`) keeps it unmatchable.
 */
const NEVER_MATCHES = "[^\\s\\S]";

/**
 * Split a `-e`/positional PATTERNS operand into individual patterns.
 *
 * GNU grep documents PATTERNS as "one or more patterns separated by newline
 * characters", so a trailing newline yields a trailing empty pattern (which
 * matches every line). Verified against GNU grep 3.12:
 *   grep -e $'cherry\n' FILE   # prints every line
 */
function splitPatternOperand(value: string): string[] {
  return value.split("\n");
}

/**
 * Split the contents of a `-f FILE` pattern file into individual patterns.
 *
 * Unlike `-e`, the final newline of a pattern file is a terminator rather than
 * a separator, so it does not produce a trailing empty pattern. An empty file
 * contributes no patterns at all. Interior empty lines are kept: an empty
 * pattern matches every line. Verified against GNU grep 3.12.
 */
function splitPatternFile(content: string): string[] {
  if (content === "") return [];
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * OR-combine several patterns into one regex source.
 *
 * A single pattern is returned untouched so the common case keeps its original
 * mode (and the literal pre-filter fast path). Multiple fixed strings are
 * escaped and lifted into an extended regex, since POSIX BRE/ERE have no way to
 * express "any of these literals" without escaping first.
 */
function combinePatterns(
  patterns: string[],
  mode: RegexMode,
): { pattern: string; mode: RegexMode } {
  if (patterns.length === 1) {
    return { pattern: patterns[0], mode };
  }
  if (mode === "fixed") {
    return {
      pattern: patterns
        .map((p) => `(?:${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`)
        .join("|"),
      mode: "extended",
    };
  }
  if (mode === "basic") {
    // BRE spells alternation `\|`; escapeRegexForBasicGrep turns it into `|`.
    return { pattern: patterns.join("\\|"), mode };
  }
  return { pattern: patterns.map((p) => `(?:${p})`).join("|"), mode };
}

const grepHelp = {
  name: "grep",
  summary: "print lines that match patterns",
  usage: "grep [OPTION]... PATTERN [FILE]...",
  description: [
    "Search for PATTERN in each FILE.",
    "With no FILE, or when FILE is -, read standard input.",
  ],
  options: [
    "-E, --extended-regexp    PATTERN is an extended regular expression",
    "-P, --perl-regexp        PATTERN is a Perl regular expression",
    "-F, --fixed-strings      PATTERN is a set of newline-separated strings",
    "-i, --ignore-case        ignore case distinctions",
    "-v, --invert-match       select non-matching lines",
    "-w, --word-regexp        match only whole words",
    "-x, --line-regexp        match only whole lines",
    "-c, --count              print only a count of matching lines",
    "-l, --files-with-matches print only names of files with matches",
    "-L, --files-without-match print names of files with no matches",
    "-m NUM, --max-count=NUM  stop after NUM matches",
    "-n, --line-number        print line number with output lines",
    "-h, --no-filename        suppress the file name prefix on output",
    "-o, --only-matching      show only nonempty parts of lines that match",
    "-q, --quiet, --silent    suppress all normal output",
    "-r, -R, --recursive      search directories recursively",
    "-A NUM                   print NUM lines of trailing context",
    "-B NUM                   print NUM lines of leading context",
    "-C NUM                   print NUM lines of context",
    "-e PATTERN               use PATTERN for matching",
    "-f FILE, --file=FILE     obtain patterns from FILE, one per line",
    "    --include=GLOB       search only files matching GLOB",
    "    --exclude=GLOB       skip files matching GLOB",
    "    --exclude-dir=DIR    skip directories matching DIR",
    "    --help               display this help and exit",
  ],
};

export const grepCommand: RuntimeCommand = {
  name: "grep",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    let ignoreCase = false;
    let showLineNumbers = false;
    let invertMatch = false;
    let countOnly = false;
    let filesWithMatches = false;
    let filesWithoutMatch = false;
    let recursive = false;
    let wholeWord = false;
    let lineRegexp = false;
    let extendedRegex = false;
    let perlRegex = false;
    let fixedStrings = false;
    let onlyMatching = false;
    let noFilename = false;
    let quietMode = false;
    let maxCount = 0; // 0 means unlimited
    let beforeContext = 0;
    let afterContext = 0;
    const includePatterns: string[] = [];
    const excludePatterns: string[] = [];
    const excludeDirPatterns: string[] = [];
    let pattern: string | null = null;
    /** Paths given to -f/--file, in argument order. "-" means stdin. */
    const patternFiles: string[] = [];
    const operands: string[] = [];
    let parseOptions = true;

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (parseOptions && arg === "--") {
        parseOptions = false;
        continue;
      }

      if (parseOptions && arg === "--help") {
        return showHelp(grepHelp);
      }

      if (parseOptions && arg.startsWith("-") && arg !== "-") {
        if (arg === "-e" && i + 1 < args.length) {
          pattern = args[++i];
          continue;
        }

        // Handle --file=FILE (can be specified multiple times)
        if (arg.startsWith("--file=")) {
          patternFiles.push(arg.slice("--file=".length));
          continue;
        }

        // Handle --include=pattern (can be specified multiple times)
        if (arg.startsWith("--include=")) {
          includePatterns.push(arg.slice("--include=".length));
          continue;
        }

        // Handle --exclude=pattern (can be specified multiple times)
        if (arg.startsWith("--exclude=")) {
          excludePatterns.push(arg.slice("--exclude=".length));
          continue;
        }

        // Handle --exclude-dir=pattern (can be specified multiple times)
        if (arg.startsWith("--exclude-dir=")) {
          excludeDirPatterns.push(arg.slice("--exclude-dir=".length));
          continue;
        }

        // Handle --max-count=N
        if (arg.startsWith("--max-count=")) {
          maxCount = parseInt(arg.slice("--max-count=".length), 10);
          continue;
        }

        // Handle -m N or -mN
        const maxCountMatch = arg.match(/^-m(\d+)$/);
        if (maxCountMatch) {
          maxCount = parseInt(maxCountMatch[1], 10);
          continue;
        }
        if (arg === "-m" && i + 1 < args.length) {
          maxCount = parseInt(args[++i], 10);
          continue;
        }

        // Handle -A, -B, -C with numbers
        const contextMatch = arg.match(/^-([ABC])(\d+)$/);
        if (contextMatch) {
          const num = parseInt(contextMatch[2], 10);
          if (contextMatch[1] === "A") afterContext = num;
          else if (contextMatch[1] === "B") beforeContext = num;
          else if (contextMatch[1] === "C") {
            beforeContext = num;
            afterContext = num;
          }
          continue;
        }

        // Handle -A n, -B n, -C n
        if (
          (arg === "-A" || arg === "-B" || arg === "-C") &&
          i + 1 < args.length
        ) {
          const num = parseInt(args[++i], 10);
          if (arg === "-A") afterContext = num;
          else if (arg === "-B") beforeContext = num;
          else {
            beforeContext = num;
            afterContext = num;
          }
          continue;
        }

        const flags = arg.startsWith("--") ? [arg] : arg.slice(1).split("");

        for (let f = 0; f < flags.length; f++) {
          const flag = flags[f];
          if (flag === "f" || flag === "--file") {
            // `-fFILE` and `-vxfFILE` attach the value to the same argument;
            // `-f FILE`, `-vxf FILE` and `--file FILE` take the next one.
            const attached = flag === "f" ? flags.slice(f + 1).join("") : "";
            if (attached.length > 0) {
              patternFiles.push(attached);
            } else if (i + 1 < args.length) {
              patternFiles.push(args[++i]);
            } else {
              return {
                stdout: "",
                stderr:
                  flag === "f"
                    ? "grep: option requires an argument -- 'f'\n"
                    : "grep: option '--file' requires an argument\n",
                exitCode: 2,
              };
            }
            break;
          }
          if (flag === "i" || flag === "--ignore-case") ignoreCase = true;
          else if (flag === "n" || flag === "--line-number")
            showLineNumbers = true;
          else if (flag === "v" || flag === "--invert-match")
            invertMatch = true;
          else if (flag === "c" || flag === "--count") countOnly = true;
          else if (flag === "l" || flag === "--files-with-matches")
            filesWithMatches = true;
          else if (flag === "L" || flag === "--files-without-match")
            filesWithoutMatch = true;
          else if (flag === "r" || flag === "R" || flag === "--recursive")
            recursive = true;
          else if (flag === "w" || flag === "--word-regexp") wholeWord = true;
          else if (flag === "x" || flag === "--line-regexp") lineRegexp = true;
          else if (flag === "E" || flag === "--extended-regexp")
            extendedRegex = true;
          else if (flag === "P" || flag === "--perl-regexp") perlRegex = true;
          else if (flag === "F" || flag === "--fixed-strings")
            fixedStrings = true;
          else if (flag === "o" || flag === "--only-matching")
            onlyMatching = true;
          else if (flag === "h" || flag === "--no-filename") noFilename = true;
          else if (flag === "q" || flag === "--quiet" || flag === "--silent")
            quietMode = true;
          else if (flag.startsWith("--")) {
            return unknownOption("grep", flag);
          } else if (flag.length === 1) {
            return unknownOption("grep", `-${flag}`);
          }
        }
      } else {
        operands.push(arg);
      }
    }

    // The first operand is the pattern only when no -e/-f pattern was given.
    if (pattern === null && patternFiles.length === 0) {
      pattern = operands.shift() ?? null;
      if (pattern === null) {
        return {
          stdout: "",
          stderr: "grep: missing pattern\n",
          exitCode: 2,
        };
      }
    }
    const files = operands;

    // Collect patterns: -e/positional first, then each -f file in order.
    // All of them OR-combine, exactly like GNU grep.
    const patterns: string[] =
      pattern === null ? [] : splitPatternOperand(pattern);
    /** True once `-f -` has drained stdin, so it can't also be searched. */
    let stdinUsedForPatterns = false;
    for (const patternFile of patternFiles) {
      let content: string;
      if (patternFile === "") {
        // `-f ""` / `--file=` never names a file; GNU reports the empty name
        // rather than resolving it relative to the working directory.
        return {
          stdout: "",
          stderr: "grep: : No such file or directory\n",
          exitCode: 2,
        };
      }
      if (patternFile === "-") {
        // stdin is a stream: the first `-f -` drains it, any later one reads
        // EOF and contributes nothing.
        content = stdinUsedForPatterns ? "" : decodeBytesToUtf8(ctx.stdin);
        stdinUsedForPatterns = true;
      } else {
        try {
          const path = ctx.fs.resolvePath(ctx.cwd, patternFile);
          const stat = await ctx.fs.stat(path);
          if (stat.isDirectory) {
            return {
              stdout: "",
              stderr: `grep: ${patternFile}: Is a directory\n`,
              exitCode: 2,
            };
          }
          content = await ctx.fs.readFile(path);
        } catch (error) {
          rethrowFatalExecutionError(error);
          return {
            stdout: "",
            stderr: `grep: ${patternFile}: No such file or directory\n`,
            exitCode: 2,
          };
        }
      }
      const filePatterns = splitPatternFile(content);
      if (patterns.length + filePatterns.length > ctx.limits.maxArrayElements) {
        throw new ExecutionLimitError(
          `grep: array element limit exceeded (${ctx.limits.maxArrayElements})`,
          "array_elements",
        );
      }
      patterns.push(...filePatterns);
    }

    // An empty pattern list (e.g. `grep -f /dev/null`) selects no lines at all.
    // GNU grep short-circuits: no output, no per-file counts, no "no such file"
    // diagnostics, exit 1. With -v every line is selected instead, and -L still
    // has to visit the files, so both keep the normal path with a regex that
    // can never match.
    if (patterns.length === 0 && !invertMatch && !filesWithoutMatch) {
      return { stdout: "", stderr: "", exitCode: 1 };
    }

    // Build regex using shared search-engine
    const regexMode: RegexMode = fixedStrings
      ? "fixed"
      : extendedRegex
        ? "extended"
        : perlRegex
          ? "perl"
          : "basic";
    // GNU's PCRE backend cannot express an alternation of independent
    // patterns, so it refuses more than one under -P. Duplicates are folded
    // first, matching GNU: `-P -e apple -e apple` is accepted.
    if (regexMode === "perl" && new Set(patterns).size > 1) {
      return {
        stdout: "",
        stderr: "grep: the -P option only supports a single pattern\n",
        exitCode: 2,
      };
    }

    // Alternatives are concatenated textually, so a malformed pattern could
    // otherwise swallow the separator and silently absorb its neighbour
    // (`a\` + `banana` becoming the literal `a|banana`). Compile each pattern
    // on its own first so a syntax error is reported instead. Fixed strings
    // are escaped before joining and can never be malformed.
    if (patterns.length > 1 && regexMode !== "fixed") {
      for (const p of patterns) {
        try {
          buildRegex(p, { mode: regexMode });
        } catch {
          return {
            stdout: "",
            stderr: `grep: invalid regular expression: ${p}\n`,
            exitCode: 2,
          };
        }
      }
    }

    const combined =
      patterns.length === 0
        ? { pattern: NEVER_MATCHES, mode: "extended" as RegexMode }
        : combinePatterns(patterns, regexMode);

    let regex: UserRegex;
    let kResetGroup: number | undefined;
    let preFilter: import("../search-engine/regex.js").PreFilter | undefined;
    try {
      const regexResult = buildRegex(combined.pattern, {
        mode: combined.mode,
        ignoreCase,
        wholeWord,
        lineRegexp,
      });
      regex = regexResult.regex;
      kResetGroup = regexResult.kResetGroup;
      preFilter = regexResult.preFilter;
    } catch {
      return {
        stdout: "",
        stderr: `grep: invalid regular expression: ${patterns.join("\n")}\n`,
        exitCode: 2,
      };
    }

    // If no files and stdin is provided (including empty string), read from
    // stdin. grep runs regex over text — decode bytes to UTF-8 so multibyte
    // codepoints match `.` / character classes correctly.
    if (files.length === 0 && ctx.stdin !== undefined) {
      const input = stdinUsedForPatterns ? "" : decodeBytesToUtf8(ctx.stdin);
      const result = searchContent(input, regex, {
        invertMatch,
        showLineNumbers,
        countOnly,
        filename: "",
        onlyMatching,
        beforeContext,
        afterContext,
        maxCount,
        kResetGroup,
        preFilter,
        maxWork: getMatcherWorkLimit(ctx),
        maxMatches: ctx.limits.maxArrayElements,
        signal: ctx.signal,
        budget: ctx.executionScope,
      });
      if (quietMode) {
        return { stdout: "", stderr: "", exitCode: result.matched ? 0 : 1 };
      }
      // grep emits text; the pipeline handles encoding.
      return {
        stdout: result.output,
        stderr: "",
        exitCode: result.matched ? 0 : 1,
      };
    }

    if (files.length === 0) {
      return {
        stdout: "",
        stderr: "grep: no input files\n",
        exitCode: 2,
      };
    }

    let stdout = "";
    let stderr = "";
    let anyMatch = false;
    let anyError = false;

    // Collect all files to search (expand globs first)
    // FileEntry includes type info when available to skip stat calls
    const filesToSearch: FileEntry[] = [];
    const traversalBudget: GrepTraversalBudget = {
      operations: 0,
      results: 0,
      maxOperations: ctx.limits.maxGlobOperations,
      maxResults: ctx.limits.maxArrayElements,
    };
    const appendFiles = (entries: FileEntry[]): void => {
      if (entries.length > traversalBudget.maxResults - filesToSearch.length) {
        throw new ExecutionLimitError(
          `grep: array element limit exceeded (${traversalBudget.maxResults})`,
          "array_elements",
        );
      }
      filesToSearch.push(...entries);
    };
    /**
     * True once a `-` operand has claimed stdin. stdin is a stream, so only the
     * first reader sees its contents.
     */
    let stdinConsumed = false;
    /**
     * True once a real path is queued. GNU only forces the file-name prefix
     * under -r when recursion can actually descend into a directory, and `-` is
     * never a directory: `grep -r pat -` prints bare lines.
     */
    let hasFileTarget = false;
    for (const file of files) {
      if (file === "-") {
        // GNU treats `-` as an operand naming standard input. It bypasses glob
        // expansion, recursion and --include/--exclude entirely: those all
        // filter on a file name, and stdin has none.
        if (filesToSearch.length >= traversalBudget.maxResults) {
          throw new ExecutionLimitError(
            `grep: array element limit exceeded (${traversalBudget.maxResults})`,
            "array_elements",
          );
        }
        filesToSearch.push({
          path: STDIN_FILENAME,
          isFile: true,
          isStdin: true,
          stdinAtEof: stdinConsumed,
        });
        stdinConsumed = true;
        continue;
      }
      hasFileTarget = true;
      // Check if this is a glob pattern
      if (file.includes("*") || file.includes("?") || file.includes("[")) {
        const expanded = await expandGlobPatternWithTypes(
          file,
          ctx,
          traversalBudget,
        );
        if (recursive) {
          for (const f of expanded) {
            const recursiveExpanded = await expandRecursiveWithTypes(
              f.path,
              ctx,
              includePatterns,
              excludePatterns,
              excludeDirPatterns,
              f.isFile,
              traversalBudget,
            );
            appendFiles(recursiveExpanded);
          }
        } else {
          appendFiles(expanded);
        }
      } else if (recursive) {
        const expanded = await expandRecursiveWithTypes(
          file,
          ctx,
          includePatterns,
          excludePatterns,
          excludeDirPatterns,
          undefined,
          traversalBudget,
        );
        appendFiles(expanded);
      } else {
        if (filesToSearch.length >= traversalBudget.maxResults) {
          throw new ExecutionLimitError(
            `grep: array element limit exceeded (${traversalBudget.maxResults})`,
            "array_elements",
          );
        }
        filesToSearch.push({ path: file });
      }
    }

    // Determine if we should show filename (after glob expansion)
    const showFilename =
      (filesToSearch.length > 1 || (recursive && hasFileTarget)) && !noFilename;

    // Process files in parallel batches for better performance
    const BATCH_SIZE = 50;
    for (let i = 0; i < filesToSearch.length; i += BATCH_SIZE) {
      const batch = filesToSearch.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      const results = await Promise.all(
        batch.map(async (fileEntry) => {
          const file = fileEntry.path;
          const basename = file.split("/").pop() || file;

          // Check exclude patterns for non-recursive case
          if (excludePatterns.length > 0 && !recursive && !fileEntry.isStdin) {
            if (
              excludePatterns.some((p) =>
                matchGlob(basename, p, { stripQuotes: true }),
              )
            ) {
              return null;
            }
          }

          // Check include patterns for non-recursive case
          if (includePatterns.length > 0 && !recursive && !fileEntry.isStdin) {
            if (
              !includePatterns.some((p) =>
                matchGlob(basename, p, { stripQuotes: true }),
              )
            ) {
              return null;
            }
          }

          try {
            let content: string;
            if (fileEntry.isStdin) {
              // grep runs regex over text — decode bytes to UTF-8 so multibyte
              // codepoints match `.` / character classes correctly. A `-` that
              // arrives after stdin was already drained reads EOF.
              content =
                fileEntry.stdinAtEof || ctx.stdin === undefined
                  ? ""
                  : decodeBytesToUtf8(ctx.stdin);
            } else {
              const filePath = ctx.fs.resolvePath(ctx.cwd, file);

              // Skip stat if we already know it's a file from glob expansion
              let isDirectory = false;
              if (fileEntry.isFile === undefined) {
                const stat = await ctx.fs.stat(filePath);
                isDirectory = stat.isDirectory;
              } else {
                isDirectory = !fileEntry.isFile;
              }

              if (isDirectory) {
                if (!recursive) {
                  return { error: `grep: ${file}: Is a directory\n` };
                }
                return null;
              }

              content = await ctx.fs.readFile(filePath);
            }

            // File-level preFilter: skip searchContent entirely when no needle exists in file.
            // Avoids content.split("\n") and all per-line work for the common zero-match case.
            if (preFilter && !invertMatch) {
              const haystack = preFilter.ignoreCase
                ? content.toLowerCase()
                : content;
              if (!preFilter.needles.some((n) => haystack.includes(n))) {
                ctx.executionScope?.throwIfAborted("grep");
                if (countOnly) {
                  const countStr = showFilename ? `${file}:0` : "0";
                  return {
                    file,
                    result: {
                      output: `${countStr}\n`,
                      matched: false,
                      matchCount: 0,
                    },
                  };
                }
                return {
                  file,
                  result: { output: "", matched: false, matchCount: 0 },
                };
              }
            }

            const result = searchContent(content, regex, {
              invertMatch,
              showLineNumbers,
              countOnly,
              filename: showFilename ? file : "",
              onlyMatching,
              beforeContext,
              afterContext,
              maxCount,
              kResetGroup,
              preFilter,
              maxWork: getMatcherWorkLimit(ctx),
              maxMatches: ctx.limits.maxArrayElements,
              signal: ctx.signal,
              budget: ctx.executionScope,
            });

            return { file, result };
          } catch (error) {
            rethrowFatalExecutionError(error);
            return { error: `grep: ${file}: No such file or directory\n` };
          }
        }),
      );

      // Process results from batch
      for (const res of results) {
        if (res === null) continue;

        if ("error" in res && res.error) {
          stderr += res.error;
          if (!res.error.includes("Is a directory")) {
            anyError = true;
          }
          continue;
        }

        if (!("file" in res) || !res.result) continue;

        const { file, result } = res;
        if (result.matched) {
          anyMatch = true;
          if (quietMode) {
            // In quiet mode, exit immediately on first match
            return { stdout: "", stderr: "", exitCode: 0 };
          }
          if (filesWithMatches) {
            stdout += `${file}\n`;
          } else if (!filesWithoutMatch) {
            stdout += result.output;
          }
        } else {
          // No match in this file
          if (filesWithoutMatch) {
            stdout += `${file}\n`;
          } else if (countOnly && !filesWithMatches) {
            stdout += result.output;
          }
        }
      }
    }

    // Exit codes: 0 = a line was selected, 1 = no line was selected, 2 = error.
    //
    // -L deliberately does NOT get its own rule. GNU grep's status reports
    // whether a line was *selected*, never whether a filename was *printed*, so
    // `grep -L` exits 0 when every file matched (and it printed nothing) and 1
    // when no file matched (and it listed them all). Verified against GNU grep
    // 3.12 and BSD grep 2.6.0-FreeBSD; note that ripgrep 15.1.0's
    // --files-without-match really does invert this, which is why
    // src/commands/rg/rg-search.ts keeps the opposite rule on purpose.
    let exitCode: number;
    if (anyError) {
      exitCode = 2;
    } else {
      exitCode = anyMatch ? 0 : 1;
    }

    if (quietMode) {
      return { stdout: "", stderr: "", exitCode };
    }

    return {
      stdout,
      stderr,
      exitCode,
    };
  },
};

/** Safety limit to prevent stack overflow on deeply nested directories */
const MAX_GREP_DEPTH = 256;

async function expandRecursiveGlob(
  baseDir: string,
  afterGlob: string,
  ctx: RuntimeCommandContext,
  result: string[],
  budget: GrepTraversalBudget,
  depth = 0,
): Promise<void> {
  if (depth >= MAX_GREP_DEPTH) return;
  const fullBasePath = ctx.fs.resolvePath(ctx.cwd, baseDir);

  try {
    useTraversalOperation(budget);
    const stat = await ctx.fs.stat(fullBasePath);

    if (!stat.isDirectory) {
      // Check if the file matches afterGlob pattern
      const filename = baseDir.split("/").pop() || "";
      if (afterGlob) {
        const pattern = afterGlob.replace(/^\//, "");
        if (matchGlob(filename, pattern, { stripQuotes: true })) {
          addTraversalResult(budget);
          result.push(baseDir);
        }
      }
      return;
    }

    // Check files in current directory
    useTraversalOperation(budget);
    const entries = await ctx.fs.readdir(fullBasePath);
    for (const entry of entries) {
      const entryPath = baseDir === "." ? entry : `${baseDir}/${entry}`;
      const fullEntryPath = ctx.fs.resolvePath(ctx.cwd, entryPath);
      useTraversalOperation(budget);
      const entryStat = await ctx.fs.stat(fullEntryPath);

      if (entryStat.isDirectory) {
        // Recurse into directory
        await expandRecursiveGlob(
          entryPath,
          afterGlob,
          ctx,
          result,
          budget,
          depth + 1,
        );
      } else if (afterGlob) {
        // Check if file matches afterGlob pattern
        const pattern = afterGlob.replace(/^\//, "");
        if (matchGlob(entry, pattern, { stripQuotes: true })) {
          addTraversalResult(budget);
          result.push(entryPath);
        }
      }
    }
  } catch (error) {
    rethrowFatalExecutionError(error);
    // Ignore errors
  }
}

/**
 * Optimized glob expansion that returns FileEntry with type info
 * Uses readdirWithFileTypes when available to avoid stat calls
 */
async function expandGlobPatternWithTypes(
  pattern: string,
  ctx: RuntimeCommandContext,
  budget: GrepTraversalBudget,
): Promise<FileEntry[]> {
  const result: FileEntry[] = [];

  // Find the directory part and the glob part
  const lastSlash = pattern.lastIndexOf("/");
  let dirPath: string;
  let globPart: string;

  if (lastSlash === -1) {
    dirPath = ctx.cwd;
    globPart = pattern;
  } else {
    dirPath = pattern.slice(0, lastSlash) || "/";
    globPart = pattern.slice(lastSlash + 1);
  }

  // Handle ** (recursive glob) - fall back to old method
  if (pattern.includes("**")) {
    const oldResult: string[] = [];
    const parts = pattern.split("**");
    const baseDir = parts[0].replace(/\/$/, "") || ".";
    const afterGlob = parts[1] || "";
    await expandRecursiveGlob(baseDir, afterGlob, ctx, oldResult, budget);
    return oldResult.map((p) => ({ path: p }));
  }

  // Resolve the directory path
  const fullDirPath = ctx.fs.resolvePath(ctx.cwd, dirPath);

  try {
    // Use readdirWithFileTypes if available for better performance
    if (ctx.fs.readdirWithFileTypes) {
      useTraversalOperation(budget);
      const entries = await ctx.fs.readdirWithFileTypes(fullDirPath);
      for (const entry of entries) {
        useTraversalOperation(budget);
        if (matchGlob(entry.name, globPart, { stripQuotes: true })) {
          const fullPath =
            lastSlash === -1 ? entry.name : `${dirPath}/${entry.name}`;
          addTraversalResult(budget);
          result.push({
            path: fullPath,
            isFile: entry.isFile,
          });
        }
      }
    } else {
      // Fall back to regular readdir
      useTraversalOperation(budget);
      const entries = await ctx.fs.readdir(fullDirPath);
      for (const entry of entries) {
        useTraversalOperation(budget);
        if (matchGlob(entry, globPart, { stripQuotes: true })) {
          const fullPath = lastSlash === -1 ? entry : `${dirPath}/${entry}`;
          addTraversalResult(budget);
          result.push({ path: fullPath });
        }
      }
    }
  } catch (error) {
    rethrowFatalExecutionError(error);
    // Directory doesn't exist - return empty
  }

  return result.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Optimized recursive expansion that returns FileEntry with type info
 * Uses readdirWithFileTypes when available to avoid stat calls
 */
async function expandRecursiveWithTypes(
  path: string,
  ctx: RuntimeCommandContext,
  includePatterns: string[] = [],
  excludePatterns: string[] = [],
  excludeDirPatterns: string[] = [],
  knownIsFile?: boolean,
  budget: GrepTraversalBudget = {
    operations: 0,
    results: 0,
    maxOperations: ctx.limits.maxGlobOperations,
    maxResults: ctx.limits.maxArrayElements,
  },
  result: FileEntry[] = [],
  depth = 0,
): Promise<FileEntry[]> {
  if (depth >= MAX_GREP_DEPTH) return result;
  const fullPath = ctx.fs.resolvePath(ctx.cwd, path);

  try {
    // Determine if it's a file or directory
    let isFile: boolean;
    let isDirectory: boolean;

    if (knownIsFile !== undefined) {
      isFile = knownIsFile;
      isDirectory = !knownIsFile;
    } else {
      useTraversalOperation(budget);
      const stat = await ctx.fs.stat(fullPath);
      isFile = stat.isFile;
      isDirectory = stat.isDirectory;
    }

    if (isFile) {
      const basename = path.split("/").pop() || path;

      // Check exclude patterns
      if (excludePatterns.length > 0) {
        if (
          excludePatterns.some((p) =>
            matchGlob(basename, p, { stripQuotes: true }),
          )
        ) {
          return result;
        }
      }

      // Check include patterns
      if (includePatterns.length > 0) {
        if (
          !includePatterns.some((p) =>
            matchGlob(basename, p, { stripQuotes: true }),
          )
        ) {
          return result;
        }
      }
      addTraversalResult(budget);
      result.push({ path, isFile: true });
      return result;
    }

    if (!isDirectory) {
      return result;
    }

    // Check if directory should be excluded
    const dirName = path.split("/").pop() || path;
    if (excludeDirPatterns.length > 0) {
      if (
        excludeDirPatterns.some((p) =>
          matchGlob(dirName, p, { stripQuotes: true }),
        )
      ) {
        return result;
      }
    }

    // Use readdirWithFileTypes if available
    if (ctx.fs.readdirWithFileTypes) {
      useTraversalOperation(budget);
      const entries = await ctx.fs.readdirWithFileTypes(fullPath);
      for (const entry of entries) {
        useTraversalOperation(budget);
        if (entry.name.startsWith(".")) continue; // Skip hidden files

        const entryPath = path === "." ? entry.name : `${path}/${entry.name}`;
        await expandRecursiveWithTypes(
          entryPath,
          ctx,
          includePatterns,
          excludePatterns,
          excludeDirPatterns,
          entry.isFile,
          budget,
          result,
          depth + 1,
        );
      }
    } else {
      useTraversalOperation(budget);
      const entries = await ctx.fs.readdir(fullPath);
      for (const entry of entries) {
        useTraversalOperation(budget);
        if (entry.startsWith(".")) continue; // Skip hidden files

        const entryPath = path === "." ? entry : `${path}/${entry}`;
        await expandRecursiveWithTypes(
          entryPath,
          ctx,
          includePatterns,
          excludePatterns,
          excludeDirPatterns,
          undefined,
          budget,
          result,
          depth + 1,
        );
      }
    }
  } catch (error) {
    rethrowFatalExecutionError(error);
    // Ignore errors
  }

  return result;
}

// fgrep is equivalent to grep -F
export const fgrepCommand: RuntimeCommand = {
  name: "fgrep",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    // Insert -F at the beginning of args
    return grepCommand.execute(["-F", ...args], ctx);
  },
};

// egrep is equivalent to grep -E
export const egrepCommand: RuntimeCommand = {
  name: "egrep",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    // Insert -E at the beginning of args
    return grepCommand.execute(["-E", ...args], ctx);
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "grep",
  flags: [
    { flag: "-E", type: "boolean" },
    { flag: "-F", type: "boolean" },
    { flag: "-P", type: "boolean" },
    { flag: "-i", type: "boolean" },
    { flag: "-v", type: "boolean" },
    { flag: "-w", type: "boolean" },
    { flag: "-x", type: "boolean" },
    { flag: "-c", type: "boolean" },
    { flag: "-l", type: "boolean" },
    { flag: "-L", type: "boolean" },
    { flag: "-n", type: "boolean" },
    { flag: "-h", type: "boolean" },
    { flag: "-o", type: "boolean" },
    { flag: "-q", type: "boolean" },
    { flag: "-r", type: "boolean" },
    { flag: "-m", type: "value", valueHint: "number" },
    { flag: "-A", type: "value", valueHint: "number" },
    { flag: "-B", type: "value", valueHint: "number" },
    { flag: "-C", type: "value", valueHint: "number" },
    { flag: "-e", type: "value", valueHint: "pattern" },
    { flag: "-f", type: "value", valueHint: "path" },
  ],
  stdinType: "text",
  needsArgs: true,
};

export const fgrepFlagsForFuzzing: CommandFuzzInfo = {
  name: "fgrep",
  flags: [],
  stdinType: "text",
  needsArgs: true,
};

export const egrepFlagsForFuzzing: CommandFuzzInfo = {
  name: "egrep",
  flags: [],
  stdinType: "text",
  needsArgs: true,
};
