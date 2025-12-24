import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const grepHelp = {
  name: "grep",
  summary: "print lines that match patterns",
  usage: "grep [OPTION]... PATTERN [FILE]...",
  options: [
    "-E, --extended-regexp    PATTERN is an extended regular expression",
    "-F, --fixed-strings      PATTERN is a set of newline-separated strings",
    "-i, --ignore-case        ignore case distinctions",
    "-v, --invert-match       select non-matching lines",
    "-w, --word-regexp        match only whole words",
    "-c, --count              print only a count of matching lines",
    "-l, --files-with-matches print only names of files with matches",
    "-L, --files-without-match print names of files with no matches",
    "-n, --line-number        print line number with output lines",
    "-h, --no-filename        suppress the file name prefix on output",
    "-o, --only-matching      show only nonempty parts of lines that match",
    "-q, --quiet, --silent    suppress all normal output",
    "-r, -R, --recursive      search directories recursively",
    "-A NUM                   print NUM lines of trailing context",
    "-B NUM                   print NUM lines of leading context",
    "-C NUM                   print NUM lines of context",
    "-e PATTERN               use PATTERN for matching",
    "    --include=GLOB       search only files matching GLOB",
    "    --exclude=GLOB       skip files matching GLOB",
    "    --exclude-dir=DIR    skip directories matching DIR",
    "    --help               display this help and exit",
  ],
};

export const grepCommand: Command = {
  name: "grep",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(grepHelp);
    }

    let ignoreCase = false;
    let showLineNumbers = false;
    let invertMatch = false;
    let countOnly = false;
    let filesWithMatches = false;
    let filesWithoutMatch = false;
    let recursive = false;
    let wholeWord = false;
    let extendedRegex = false;
    let fixedStrings = false;
    let onlyMatching = false;
    let noFilename = false;
    let quietMode = false;
    let beforeContext = 0;
    let afterContext = 0;
    const includePatterns: string[] = [];
    const excludePatterns: string[] = [];
    const excludeDirPatterns: string[] = [];
    let pattern: string | null = null;
    const files: string[] = [];

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg.startsWith("-") && arg !== "-") {
        if (arg === "-e" && i + 1 < args.length) {
          pattern = args[++i];
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

        for (const flag of flags) {
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
          else if (flag === "E" || flag === "--extended-regexp")
            extendedRegex = true;
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
      } else if (pattern === null) {
        pattern = arg;
      } else {
        files.push(arg);
      }
    }

    if (pattern === null) {
      return {
        stdout: "",
        stderr: "grep: missing pattern\n",
        exitCode: 2,
      };
    }

    // Build regex
    let regexPattern: string;
    if (fixedStrings) {
      // -F: escape all regex special characters for literal match
      regexPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (extendedRegex) {
      regexPattern = pattern;
    } else {
      regexPattern = escapeRegexForBasicGrep(pattern);
    }
    if (wholeWord) {
      regexPattern = `\\b${regexPattern}\\b`;
    }

    let regex: RegExp;
    try {
      regex = new RegExp(regexPattern, ignoreCase ? "gi" : "g");
    } catch {
      return {
        stdout: "",
        stderr: `grep: invalid regular expression: ${pattern}\n`,
        exitCode: 2,
      };
    }

    // If no files and no stdin, read from stdin
    if (files.length === 0 && ctx.stdin) {
      const result = grepContent(
        ctx.stdin,
        regex,
        invertMatch,
        showLineNumbers,
        countOnly,
        "",
        onlyMatching,
        beforeContext,
        afterContext,
      );
      if (quietMode) {
        return { stdout: "", stderr: "", exitCode: result.matched ? 0 : 1 };
      }
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
    const filesToSearch: string[] = [];
    for (const file of files) {
      // Check if this is a glob pattern
      if (file.includes("*") || file.includes("?") || file.includes("[")) {
        const expanded = await expandGlobPattern(file, ctx);
        if (recursive) {
          for (const f of expanded) {
            const recursiveExpanded = await expandRecursive(
              f,
              ctx,
              includePatterns,
              excludePatterns,
              excludeDirPatterns,
            );
            filesToSearch.push(...recursiveExpanded);
          }
        } else {
          filesToSearch.push(...expanded);
        }
      } else if (recursive) {
        const expanded = await expandRecursive(
          file,
          ctx,
          includePatterns,
          excludePatterns,
          excludeDirPatterns,
        );
        filesToSearch.push(...expanded);
      } else {
        filesToSearch.push(file);
      }
    }

    // Determine if we should show filename (after glob expansion)
    const showFilename = (filesToSearch.length > 1 || recursive) && !noFilename;

    for (const file of filesToSearch) {
      const basename = file.split("/").pop() || file;

      // Check exclude patterns for non-recursive case
      if (excludePatterns.length > 0 && !recursive) {
        if (excludePatterns.some((p) => matchGlob(basename, p))) {
          continue;
        }
      }

      // Check include patterns for non-recursive case
      if (includePatterns.length > 0 && !recursive) {
        if (!includePatterns.some((p) => matchGlob(basename, p))) {
          continue;
        }
      }

      try {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        const stat = await ctx.fs.stat(filePath);

        if (stat.isDirectory) {
          if (!recursive) {
            stderr += `grep: ${file}: Is a directory\n`;
          }
          continue;
        }

        const content = await ctx.fs.readFile(filePath);
        const result = grepContent(
          content,
          regex,
          invertMatch,
          showLineNumbers,
          countOnly,
          showFilename ? file : "",
          onlyMatching,
          beforeContext,
          afterContext,
        );

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
      } catch {
        stderr += `grep: ${file}: No such file or directory\n`;
        anyError = true;
      }
    }

    // Exit codes: 0 = match found (or files without match for -L), 1 = no match, 2 = error
    // For -L, success means we found files without matches (stdout has content)
    let exitCode: number;
    if (anyError) {
      exitCode = 2;
    } else if (filesWithoutMatch) {
      exitCode = stdout.length > 0 ? 0 : 1;
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

function escapeRegexForBasicGrep(str: string): string {
  // Basic grep (BRE) uses different escaping than JavaScript regex
  // In BRE: \| is alternation, \( \) are groups, \{ \} are quantifiers
  // We need to convert BRE to JavaScript regex

  let result = "";
  let i = 0;

  while (i < str.length) {
    const char = str[i];

    if (char === "\\" && i + 1 < str.length) {
      const nextChar = str[i + 1];
      // BRE: \| becomes | (alternation)
      // BRE: \( \) become ( ) (grouping)
      // BRE: \{ \} become { } (quantifiers) - but we'll treat as literal for simplicity
      if (nextChar === "|" || nextChar === "(" || nextChar === ")") {
        result += nextChar;
        i += 2;
        continue;
      } else if (nextChar === "{" || nextChar === "}") {
        // Keep as escaped for now (literal)
        result += `\\${nextChar}`;
        i += 2;
        continue;
      }
    }

    // Escape characters that are special in JavaScript regex but not in BRE
    if (
      char === "+" ||
      char === "?" ||
      char === "|" ||
      char === "(" ||
      char === ")" ||
      char === "{" ||
      char === "}"
    ) {
      result += `\\${char}`;
    } else {
      result += char;
    }
    i++;
  }

  return result;
}

function grepContent(
  content: string,
  regex: RegExp,
  invertMatch: boolean,
  showLineNumbers: boolean,
  countOnly: boolean,
  filename: string,
  onlyMatching: boolean = false,
  beforeContext: number = 0,
  afterContext: number = 0,
): { output: string; matched: boolean } {
  const lines = content.split("\n");
  const lineCount = lines.length;
  // Handle trailing empty line from split if content ended with newline
  const lastIdx =
    lineCount > 0 && lines[lineCount - 1] === "" ? lineCount - 1 : lineCount;

  // Fast path: count only mode
  if (countOnly) {
    let matchCount = 0;
    for (let i = 0; i < lastIdx; i++) {
      regex.lastIndex = 0;
      if (regex.test(lines[i]) !== invertMatch) {
        matchCount++;
      }
    }
    const countStr = filename
      ? `${filename}:${matchCount}`
      : String(matchCount);
    return { output: `${countStr}\n`, matched: matchCount > 0 };
  }

  // Fast path: no context needed (most common case)
  if (beforeContext === 0 && afterContext === 0) {
    const outputLines: string[] = [];
    let hasMatch = false;

    for (let i = 0; i < lastIdx; i++) {
      const line = lines[i];
      regex.lastIndex = 0;
      const matches = regex.test(line);

      if (matches !== invertMatch) {
        hasMatch = true;
        if (onlyMatching) {
          regex.lastIndex = 0;
          for (
            let match = regex.exec(line);
            match !== null;
            match = regex.exec(line)
          ) {
            outputLines.push(filename ? `${filename}:${match[0]}` : match[0]);
            if (match[0].length === 0) regex.lastIndex++;
          }
        } else if (showLineNumbers) {
          outputLines.push(
            filename ? `${filename}:${i + 1}:${line}` : `${i + 1}:${line}`,
          );
        } else {
          outputLines.push(filename ? `${filename}:${line}` : line);
        }
      }
    }

    return {
      output: outputLines.length > 0 ? `${outputLines.join("\n")}\n` : "",
      matched: hasMatch,
    };
  }

  // Slow path: context lines needed
  const outputLines: string[] = [];
  let matchCount = 0;
  const printedLines = new Set<number>();

  // First pass: find all matching lines
  const matchingLineNumbers: number[] = [];
  for (let i = 0; i < lastIdx; i++) {
    regex.lastIndex = 0;
    if (regex.test(lines[i]) !== invertMatch) {
      matchingLineNumbers.push(i);
      matchCount++;
    }
  }

  // Second pass: output with context
  for (const lineNum of matchingLineNumbers) {
    // Before context
    for (let i = Math.max(0, lineNum - beforeContext); i < lineNum; i++) {
      if (!printedLines.has(i)) {
        printedLines.add(i);
        let outputLine = lines[i];
        if (showLineNumbers) outputLine = `${i + 1}-${outputLine}`;
        if (filename) outputLine = `${filename}-${outputLine}`;
        outputLines.push(outputLine);
      }
    }

    // The matching line
    if (!printedLines.has(lineNum)) {
      printedLines.add(lineNum);
      const line = lines[lineNum];

      if (onlyMatching) {
        regex.lastIndex = 0;
        for (
          let match = regex.exec(line);
          match !== null;
          match = regex.exec(line)
        ) {
          outputLines.push(filename ? `${filename}:${match[0]}` : match[0]);
          if (match[0].length === 0) regex.lastIndex++;
        }
      } else {
        let outputLine = line;
        if (showLineNumbers) outputLine = `${lineNum + 1}:${outputLine}`;
        if (filename) outputLine = `${filename}:${outputLine}`;
        outputLines.push(outputLine);
      }
    }

    // After context
    const maxAfter = Math.min(lastIdx - 1, lineNum + afterContext);
    for (let i = lineNum + 1; i <= maxAfter; i++) {
      if (!printedLines.has(i)) {
        printedLines.add(i);
        let outputLine = lines[i];
        if (showLineNumbers) outputLine = `${i + 1}-${outputLine}`;
        if (filename) outputLine = `${filename}-${outputLine}`;
        outputLines.push(outputLine);
      }
    }
  }

  return {
    output: outputLines.length > 0 ? `${outputLines.join("\n")}\n` : "",
    matched: matchCount > 0,
  };
}

async function expandRecursive(
  path: string,
  ctx: CommandContext,
  includePatterns: string[] = [],
  excludePatterns: string[] = [],
  excludeDirPatterns: string[] = [],
): Promise<string[]> {
  const fullPath = ctx.fs.resolvePath(ctx.cwd, path);
  const result: string[] = [];

  try {
    const stat = await ctx.fs.stat(fullPath);

    if (!stat.isDirectory) {
      const basename = path.split("/").pop() || path;

      // Check exclude patterns - skip if file matches any exclude pattern
      if (excludePatterns.length > 0) {
        if (excludePatterns.some((p) => matchGlob(basename, p))) {
          return [];
        }
      }

      // Check include patterns - file must match at least one pattern (if any are specified)
      if (includePatterns.length > 0) {
        if (!includePatterns.some((p) => matchGlob(basename, p))) {
          return [];
        }
      }
      return [path];
    }

    // Check if directory should be excluded
    const dirName = path.split("/").pop() || path;
    if (excludeDirPatterns.length > 0) {
      if (excludeDirPatterns.some((p) => matchGlob(dirName, p))) {
        return [];
      }
    }

    const entries = await ctx.fs.readdir(fullPath);
    for (const entry of entries) {
      if (entry.startsWith(".")) continue; // Skip hidden files

      const entryPath = path === "." ? entry : `${path}/${entry}`;
      const expanded = await expandRecursive(
        entryPath,
        ctx,
        includePatterns,
        excludePatterns,
        excludeDirPatterns,
      );
      result.push(...expanded);
    }
  } catch {
    // Ignore errors
  }

  return result;
}

function matchGlob(filename: string, pattern: string): boolean {
  // Convert glob pattern to regex
  // Remove surrounding quotes if present
  let cleanPattern = pattern;
  if (
    (cleanPattern.startsWith('"') && cleanPattern.endsWith('"')) ||
    (cleanPattern.startsWith("'") && cleanPattern.endsWith("'"))
  ) {
    cleanPattern = cleanPattern.slice(1, -1);
  }

  const regexPattern = cleanPattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
    .replace(/\*/g, ".*") // * matches anything
    .replace(/\?/g, "."); // ? matches single char

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filename);
}

async function expandGlobPattern(
  pattern: string,
  ctx: CommandContext,
): Promise<string[]> {
  const result: string[] = [];

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

  // Handle ** (recursive glob)
  if (pattern.includes("**")) {
    // Split pattern at **
    const parts = pattern.split("**");
    const baseDir = parts[0].replace(/\/$/, "") || ".";
    const afterGlob = parts[1] || "";

    await expandRecursiveGlob(baseDir, afterGlob, ctx, result);
    return result;
  }

  // Resolve the directory path
  const fullDirPath = ctx.fs.resolvePath(ctx.cwd, dirPath);

  try {
    const entries = await ctx.fs.readdir(fullDirPath);

    for (const entry of entries) {
      if (matchGlob(entry, globPart)) {
        const fullPath = lastSlash === -1 ? entry : `${dirPath}/${entry}`;
        result.push(fullPath);
      }
    }
  } catch {
    // Directory doesn't exist - return empty
  }

  return result.sort();
}

async function expandRecursiveGlob(
  baseDir: string,
  afterGlob: string,
  ctx: CommandContext,
  result: string[],
): Promise<void> {
  const fullBasePath = ctx.fs.resolvePath(ctx.cwd, baseDir);

  try {
    const stat = await ctx.fs.stat(fullBasePath);

    if (!stat.isDirectory) {
      // Check if the file matches afterGlob pattern
      const filename = baseDir.split("/").pop() || "";
      if (afterGlob) {
        const pattern = afterGlob.replace(/^\//, "");
        if (matchGlob(filename, pattern)) {
          result.push(baseDir);
        }
      }
      return;
    }

    // Check files in current directory
    const entries = await ctx.fs.readdir(fullBasePath);
    for (const entry of entries) {
      const entryPath = baseDir === "." ? entry : `${baseDir}/${entry}`;
      const fullEntryPath = ctx.fs.resolvePath(ctx.cwd, entryPath);
      const entryStat = await ctx.fs.stat(fullEntryPath);

      if (entryStat.isDirectory) {
        // Recurse into directory
        await expandRecursiveGlob(entryPath, afterGlob, ctx, result);
      } else if (afterGlob) {
        // Check if file matches afterGlob pattern
        const pattern = afterGlob.replace(/^\//, "");
        if (matchGlob(entry, pattern)) {
          result.push(entryPath);
        }
      }
    }
  } catch {
    // Ignore errors
  }
}
