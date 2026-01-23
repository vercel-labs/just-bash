/**
 * Glob Expander - Expands glob patterns to matching file paths
 *
 * Handles:
 * - * (matches any characters except /)
 * - ** (matches any characters including /)
 * - ? (matches single character)
 * - [...] (character classes)
 */

import type { IFileSystem } from "../fs/interface.js";
import { DEFAULT_BATCH_SIZE } from "../utils/constants.js";

export interface GlobOptions {
  globstar?: boolean;
  nullglob?: boolean;
  failglob?: boolean;
  dotglob?: boolean;
  extglob?: boolean;
}

export class GlobExpander {
  private globignorePatterns: string[] = [];
  private hasGlobignore = false;
  private globstar = false;
  private nullglob = false;
  private failglob = false;
  private dotglob = false;
  private extglob = false;

  constructor(
    private fs: IFileSystem,
    private cwd: string,
    env?: Record<string, string>,
    options?: GlobOptions | boolean, // boolean for backwards compatibility (globstar)
  ) {
    if (typeof options === "boolean") {
      this.globstar = options;
    } else if (options) {
      this.globstar = options.globstar ?? false;
      this.nullglob = options.nullglob ?? false;
      this.failglob = options.failglob ?? false;
      this.dotglob = options.dotglob ?? false;
      this.extglob = options.extglob ?? false;
    }
    // Parse GLOBIGNORE if set
    const globignore = env?.GLOBIGNORE;
    if (globignore !== undefined && globignore !== "") {
      this.hasGlobignore = true;
      this.globignorePatterns = globignore.split(":");
    }
  }

  /**
   * Check if nullglob is enabled (return empty for non-matching patterns)
   */
  hasNullglob(): boolean {
    return this.nullglob;
  }

  /**
   * Check if failglob is enabled (throw error for non-matching patterns)
   */
  hasFailglob(): boolean {
    return this.failglob;
  }

  /**
   * Filter results based on GLOBIGNORE patterns
   * When GLOBIGNORE is set, . and .. are always filtered
   */
  private filterGlobignore(results: string[]): string[] {
    if (!this.hasGlobignore) {
      return results;
    }

    return results.filter((path) => {
      // Get the basename for matching
      const basename = path.split("/").pop() || path;

      // Always filter . and .. when GLOBIGNORE is set
      if (basename === "." || basename === "..") {
        return false;
      }

      // Check if path matches any GLOBIGNORE pattern
      for (const ignorePattern of this.globignorePatterns) {
        if (this.matchGlobignorePattern(path, ignorePattern)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Match a path against a GLOBIGNORE pattern
   * GLOBIGNORE patterns are matched against the complete result path.
   * Unlike regular glob matching, * does NOT match / in GLOBIGNORE patterns.
   * This means *.txt filters "foo.txt" but NOT "dir/foo.txt".
   */
  private matchGlobignorePattern(path: string, pattern: string): boolean {
    const regex = this.globignorePatternToRegex(pattern);
    return regex.test(path);
  }

  /**
   * Convert a GLOBIGNORE pattern to a RegExp.
   * Unlike regular glob patterns, * does NOT match /.
   */
  private globignorePatternToRegex(pattern: string): RegExp {
    let regex = "^";

    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];

      if (c === "*") {
        // In GLOBIGNORE, * does NOT match /
        regex += "[^/]*";
      } else if (c === "?") {
        // ? matches any single character except /
        regex += "[^/]";
      } else if (c === "[") {
        // Character class - find the closing bracket
        let j = i + 1;
        let classContent = "[";

        // Handle negation
        if (j < pattern.length && (pattern[j] === "^" || pattern[j] === "!")) {
          classContent += "^";
          j++;
        }

        // Handle ] as first character (literal])
        if (j < pattern.length && pattern[j] === "]") {
          classContent += "\\]";
          j++;
        }

        // Parse until closing ]
        while (j < pattern.length && pattern[j] !== "]") {
          // Check for POSIX character class [[:name:]]
          if (
            pattern[j] === "[" &&
            j + 1 < pattern.length &&
            pattern[j + 1] === ":"
          ) {
            const posixEnd = pattern.indexOf(":]", j + 2);
            if (posixEnd !== -1) {
              const posixClass = pattern.slice(j + 2, posixEnd);
              const regexClass = this.posixClassToRegex(posixClass);
              classContent += regexClass;
              j = posixEnd + 2;
              continue;
            }
          }

          // Handle escaped characters in character class
          if (pattern[j] === "\\" && j + 1 < pattern.length) {
            classContent += `\\${pattern[j + 1]}`;
            j += 2;
            continue;
          }

          // Handle - as literal if at start/end
          if (pattern[j] === "-") {
            classContent += "\\-";
          } else {
            classContent += pattern[j];
          }
          j++;
        }

        classContent += "]";
        regex += classContent;
        i = j;
      } else if (c === "\\" && i + 1 < pattern.length) {
        // Escaped character - treat next char as literal
        const nextChar = pattern[i + 1];
        if (/[.+^${}()|\\*?[\]]/.test(nextChar)) {
          regex += `\\${nextChar}`;
        } else {
          regex += nextChar;
        }
        i++;
      } else if (/[.+^${}()|]/.test(c)) {
        // Escape regex special characters
        regex += `\\${c}`;
      } else {
        regex += c;
      }
    }

    regex += "$";
    return new RegExp(regex);
  }

  /**
   * Check if a string contains glob characters
   */
  isGlobPattern(str: string): boolean {
    if (str.includes("*") || str.includes("?") || /\[.*\]/.test(str)) {
      return true;
    }
    // Check for extglob patterns: @(...), *(...), +(...), ?(...), !(...)
    if (this.extglob && /[@*+?!]\(/.test(str)) {
      return true;
    }
    return false;
  }

  /**
   * Expand an array of arguments, replacing glob patterns with matched files
   * @param args - Array of argument strings
   * @param quotedFlags - Optional array indicating which args were quoted (should not expand)
   */
  async expandArgs(args: string[], quotedFlags?: boolean[]): Promise<string[]> {
    // Identify which args need glob expansion
    const expansionPromises: (Promise<string[]> | null)[] = args.map(
      (arg, i) => {
        const isQuoted = quotedFlags?.[i] ?? false;
        if (isQuoted || !this.isGlobPattern(arg)) {
          return null; // No expansion needed
        }
        return this.expand(arg);
      },
    );

    // Run all glob expansions in parallel
    const expandedResults = await Promise.all(
      expansionPromises.map((p) => (p ? p : Promise.resolve(null))),
    );

    // Build result array preserving order
    const result: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const expanded = expandedResults[i];
      if (expanded === null) {
        result.push(args[i]);
      } else if (expanded.length > 0) {
        result.push(...expanded);
      } else {
        // If no matches, keep the original pattern (bash default behavior)
        result.push(args[i]);
      }
    }

    return result;
  }

  /**
   * Expand a single glob pattern
   */
  async expand(pattern: string): Promise<string[]> {
    let results: string[];

    // Handle ** (recursive) patterns - only when globstar is enabled
    // ** must be a complete path segment (surrounded by / or at boundaries)
    if (
      pattern.includes("**") &&
      this.globstar &&
      this.isGlobstarValid(pattern)
    ) {
      results = await this.expandRecursive(pattern);
    } else {
      // When globstar is disabled or ** is not a complete segment, treat ** as *
      const normalizedPattern = pattern.replace(/\*\*+/g, "*");
      results = await this.expandSimple(normalizedPattern);
    }

    // Apply GLOBIGNORE filtering
    return this.filterGlobignore(results);
  }

  /**
   * Check if ** is used as a complete path segment (not adjacent to other chars).
   * ** only recurses when it appears as a standalone segment like:
   *   - ** at start
   *   - / ** / in middle (no spaces)
   *   - / ** at end (no spaces)
   * NOT when adjacent to other characters like d** or **y
   */
  private isGlobstarValid(pattern: string): boolean {
    // Check if all ** occurrences are valid complete segments
    // A ** is valid if it's:
    //   - At the start and followed by / or end
    //   - In the middle surrounded by /
    //   - At the end preceded by /
    const segments = pattern.split("/");
    for (const segment of segments) {
      if (segment.includes("**")) {
        // If segment is not exactly ** (possibly with more *), it's invalid
        // e.g., "d**" or "**y" or "d**y" are invalid
        if (segment !== "**") {
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Check if a path segment contains glob characters
   */
  private hasGlobChars(str: string): boolean {
    if (str.includes("*") || str.includes("?") || /\[.*\]/.test(str)) {
      return true;
    }
    // Check for extglob patterns: @(...), *(...), +(...), ?(...), !(...)
    if (this.extglob && /[@*+?!]\(/.test(str)) {
      return true;
    }
    return false;
  }

  /**
   * Expand a simple glob pattern (no **).
   * Handles multi-segment patterns like /dm/star/star.json
   */
  private async expandSimple(pattern: string): Promise<string[]> {
    // Split pattern into segments
    const isAbsolute = pattern.startsWith("/");
    const segments = pattern.split("/").filter((s) => s !== "");

    // Find the first segment with glob characters
    let firstGlobIndex = -1;
    for (let i = 0; i < segments.length; i++) {
      if (this.hasGlobChars(segments[i])) {
        firstGlobIndex = i;
        break;
      }
    }

    // No glob characters - return pattern as-is (shouldn't happen but be safe)
    if (firstGlobIndex === -1) {
      return [pattern];
    }

    // Build the base path for filesystem operations (may include cwd for relative paths)
    // Also track the result prefix (what appears in the output)
    let fsBasePath: string;
    let resultPrefix: string;

    if (firstGlobIndex === 0) {
      if (isAbsolute) {
        fsBasePath = "/";
        resultPrefix = "/";
      } else {
        fsBasePath = this.cwd;
        resultPrefix = ""; // Results should be relative, no prefix
      }
    } else {
      const baseSegments = segments.slice(0, firstGlobIndex);
      if (isAbsolute) {
        fsBasePath = `/${baseSegments.join("/")}`;
        resultPrefix = `/${baseSegments.join("/")}`;
      } else {
        fsBasePath = this.fs.resolvePath(this.cwd, baseSegments.join("/"));
        resultPrefix = baseSegments.join("/");
      }
    }

    // Get the remaining segments to match (from firstGlobIndex onwards)
    const remainingSegments = segments.slice(firstGlobIndex);

    // Recursively expand the pattern
    const results = await this.expandSegments(
      fsBasePath,
      resultPrefix,
      remainingSegments,
    );

    return results.sort();
  }

  /**
   * Recursively expand path segments with glob patterns
   * @param fsPath - The actual filesystem path to read from
   * @param resultPrefix - The prefix to use when building result paths
   * @param segments - Remaining glob segments to match
   */
  private async expandSegments(
    fsPath: string,
    resultPrefix: string,
    segments: string[],
  ): Promise<string[]> {
    if (segments.length === 0) {
      return [resultPrefix];
    }

    const [currentSegment, ...remainingSegments] = segments;
    const results: string[] = [];

    try {
      // Use readdirWithFileTypes if available to avoid stat calls
      if (this.fs.readdirWithFileTypes) {
        const entriesWithTypes = await this.fs.readdirWithFileTypes(fsPath);
        const matchPromises: Promise<string[]>[] = [];

        for (const entry of entriesWithTypes) {
          // Skip hidden files unless pattern explicitly matches them or dotglob is enabled
          if (
            entry.name.startsWith(".") &&
            !currentSegment.startsWith(".") &&
            !this.dotglob
          ) {
            continue;
          }

          if (this.matchPattern(entry.name, currentSegment)) {
            // Build the new filesystem path
            const newFsPath =
              fsPath === "/" ? `/${entry.name}` : `${fsPath}/${entry.name}`;

            // Build the new result prefix
            let newResultPrefix: string;
            if (resultPrefix === "") {
              newResultPrefix = entry.name;
            } else if (resultPrefix === "/") {
              newResultPrefix = `/${entry.name}`;
            } else {
              newResultPrefix = `${resultPrefix}/${entry.name}`;
            }

            if (remainingSegments.length === 0) {
              // No more segments - add this path to results
              matchPromises.push(Promise.resolve([newResultPrefix]));
            } else if (entry.isDirectory) {
              // More segments to match and this is a directory - recurse
              matchPromises.push(
                this.expandSegments(
                  newFsPath,
                  newResultPrefix,
                  remainingSegments,
                ),
              );
            }
            // If not a directory and more segments remain, skip this entry
          }
        }

        const allResults = await Promise.all(matchPromises);
        for (const pathList of allResults) {
          results.push(...pathList);
        }
      } else {
        // Fall back to readdir + stat
        const entries = await this.fs.readdir(fsPath);
        const matchPromises: Promise<string[]>[] = [];

        for (const entry of entries) {
          // Skip hidden files unless pattern explicitly matches them or dotglob is enabled
          if (
            entry.startsWith(".") &&
            !currentSegment.startsWith(".") &&
            !this.dotglob
          ) {
            continue;
          }

          if (this.matchPattern(entry, currentSegment)) {
            // Build the new filesystem path
            const newFsPath =
              fsPath === "/" ? `/${entry}` : `${fsPath}/${entry}`;

            // Build the new result prefix
            let newResultPrefix: string;
            if (resultPrefix === "") {
              newResultPrefix = entry;
            } else if (resultPrefix === "/") {
              newResultPrefix = `/${entry}`;
            } else {
              newResultPrefix = `${resultPrefix}/${entry}`;
            }

            if (remainingSegments.length === 0) {
              // No more segments - add this path to results
              matchPromises.push(Promise.resolve([newResultPrefix]));
            } else {
              // More segments to match - check if this is a directory and recurse
              matchPromises.push(
                (async (): Promise<string[]> => {
                  try {
                    const stat = await this.fs.stat(newFsPath);
                    if (stat.isDirectory) {
                      return this.expandSegments(
                        newFsPath,
                        newResultPrefix,
                        remainingSegments,
                      );
                    }
                  } catch {
                    // Entry doesn't exist or can't be stat'd
                  }
                  return [];
                })(),
              );
            }
          }
        }

        const allResults = await Promise.all(matchPromises);
        for (const pathList of allResults) {
          results.push(...pathList);
        }
      }
    } catch {
      // Directory doesn't exist - return empty
    }

    return results;
  }

  /**
   * Expand a recursive glob pattern (contains **)
   */
  private async expandRecursive(pattern: string): Promise<string[]> {
    const results: string[] = [];

    // Split pattern at **
    const doubleStarIndex = pattern.indexOf("**");
    const beforeDoubleStar =
      pattern.slice(0, doubleStarIndex).replace(/\/$/, "") || ".";
    const afterDoubleStar = pattern.slice(doubleStarIndex + 2);

    // Get the file pattern after **
    const filePattern = afterDoubleStar.replace(/^\//, "");

    await this.walkDirectory(beforeDoubleStar, filePattern, results);

    return results.sort();
  }

  /**
   * Recursively walk a directory and collect matching files
   */
  private async walkDirectory(
    dir: string,
    filePattern: string,
    results: string[],
  ): Promise<void> {
    const fullPath = this.fs.resolvePath(this.cwd, dir);

    try {
      // Use readdirWithFileTypes if available to avoid stat calls
      if (this.fs.readdirWithFileTypes) {
        const entriesWithTypes = await this.fs.readdirWithFileTypes(fullPath);

        // Separate files and directories
        const files: string[] = [];
        const dirs: string[] = [];

        for (const entry of entriesWithTypes) {
          const entryPath = dir === "." ? entry.name : `${dir}/${entry.name}`;
          if (entry.isDirectory) {
            dirs.push(entryPath);
          } else if (
            filePattern &&
            this.matchPattern(entry.name, filePattern)
          ) {
            files.push(entryPath);
          }
        }

        // Add matched files to results
        results.push(...files);

        // Process directories in parallel batches
        for (let i = 0; i < dirs.length; i += DEFAULT_BATCH_SIZE) {
          const batch = dirs.slice(i, i + DEFAULT_BATCH_SIZE);
          await Promise.all(
            batch.map((dirPath) =>
              this.walkDirectory(dirPath, filePattern, results),
            ),
          );
        }
      } else {
        // Fall back to readdir + parallel stat
        const entries = await this.fs.readdir(fullPath);

        // Get entry info in parallel batches
        interface EntryInfo {
          name: string;
          path: string;
          isDirectory: boolean;
        }
        const entryInfos: EntryInfo[] = [];

        for (let i = 0; i < entries.length; i += DEFAULT_BATCH_SIZE) {
          const batch = entries.slice(i, i + DEFAULT_BATCH_SIZE);
          const batchResults = await Promise.all(
            batch.map(async (entry) => {
              const entryPath = dir === "." ? entry : `${dir}/${entry}`;
              const fullEntryPath = this.fs.resolvePath(this.cwd, entryPath);
              try {
                const stat = await this.fs.stat(fullEntryPath);
                return {
                  name: entry,
                  path: entryPath,
                  isDirectory: stat.isDirectory,
                };
              } catch {
                return null;
              }
            }),
          );
          entryInfos.push(
            ...(batchResults.filter((r) => r !== null) as EntryInfo[]),
          );
        }

        // Process files
        for (const entry of entryInfos) {
          if (!entry.isDirectory && filePattern) {
            if (this.matchPattern(entry.name, filePattern)) {
              results.push(entry.path);
            }
          }
        }

        // Recurse into directories in parallel batches
        const dirs = entryInfos.filter((e) => e.isDirectory);
        for (let i = 0; i < dirs.length; i += DEFAULT_BATCH_SIZE) {
          const batch = dirs.slice(i, i + DEFAULT_BATCH_SIZE);
          await Promise.all(
            batch.map((entry) =>
              this.walkDirectory(entry.path, filePattern, results),
            ),
          );
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  /**
   * Match a filename against a glob pattern
   */
  matchPattern(name: string, pattern: string): boolean {
    const regex = this.patternToRegex(pattern);
    return regex.test(name);
  }

  /**
   * Convert a glob pattern to a RegExp
   */
  private patternToRegex(pattern: string): RegExp {
    const regex = this.patternToRegexStr(pattern);
    return new RegExp(`^${regex}$`);
  }

  /**
   * Convert a glob pattern to a regex string (without anchors)
   */
  private patternToRegexStr(pattern: string): string {
    let regex = "";

    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];

      // Check for extglob patterns: @(...), *(...), +(...), ?(...), !(...)
      if (
        this.extglob &&
        (c === "@" || c === "*" || c === "+" || c === "?" || c === "!") &&
        i + 1 < pattern.length &&
        pattern[i + 1] === "("
      ) {
        // Find the matching closing paren (handle nesting)
        const closeIdx = this.findMatchingParen(pattern, i + 1);
        if (closeIdx !== -1) {
          const content = pattern.slice(i + 2, closeIdx);
          // Split on | but handle nested extglob patterns
          const alternatives = this.splitExtglobAlternatives(content);
          // Convert each alternative recursively
          const altRegexes = alternatives.map((alt) =>
            this.patternToRegexStr(alt),
          );
          const altGroup =
            altRegexes.length > 0 ? altRegexes.join("|") : "(?:)";

          if (c === "@") {
            // @(...) - match exactly one of the patterns
            regex += `(?:${altGroup})`;
          } else if (c === "*") {
            // *(...) - match zero or more occurrences
            regex += `(?:${altGroup})*`;
          } else if (c === "+") {
            // +(...) - match one or more occurrences
            regex += `(?:${altGroup})+`;
          } else if (c === "?") {
            // ?(...) - match zero or one occurrence
            regex += `(?:${altGroup})?`;
          } else if (c === "!") {
            // !(...) - match anything except the patterns
            // This is tricky - we need a negative lookahead anchored to the end
            regex += `(?!(?:${altGroup})$).*`;
          }
          i = closeIdx;
          continue;
        }
      }

      if (c === "*") {
        regex += ".*";
      } else if (c === "?") {
        regex += ".";
      } else if (c === "[") {
        // Character class - find the closing bracket
        // Handle negation [^...] or [!...]
        // Handle POSIX classes [[:alpha:]], [[:punct:]], etc.
        let j = i + 1;
        let classContent = "[";

        // Handle negation
        if (j < pattern.length && (pattern[j] === "^" || pattern[j] === "!")) {
          classContent += "^";
          j++;
        }

        // Handle ] as first character (literal])
        if (j < pattern.length && pattern[j] === "]") {
          classContent += "\\]";
          j++;
        }

        // Parse until closing ]
        while (j < pattern.length && pattern[j] !== "]") {
          // Check for POSIX character class [[:name:]]
          if (
            pattern[j] === "[" &&
            j + 1 < pattern.length &&
            pattern[j + 1] === ":"
          ) {
            const posixEnd = pattern.indexOf(":]", j + 2);
            if (posixEnd !== -1) {
              const posixClass = pattern.slice(j + 2, posixEnd);
              const regexClass = this.posixClassToRegex(posixClass);
              classContent += regexClass;
              j = posixEnd + 2;
              continue;
            }
          }

          // Handle escaped characters in character class
          if (pattern[j] === "\\" && j + 1 < pattern.length) {
            classContent += `\\${pattern[j + 1]}`;
            j += 2;
            continue;
          }

          // Handle - as literal if at start/end
          if (pattern[j] === "-") {
            classContent += "\\-";
          } else {
            classContent += pattern[j];
          }
          j++;
        }

        classContent += "]";
        regex += classContent;
        i = j;
      } else if (c === "\\" && i + 1 < pattern.length) {
        // Escaped character - treat next char as literal
        const nextChar = pattern[i + 1];
        if (/[.+^${}()|\\*?[\]]/.test(nextChar)) {
          regex += `\\${nextChar}`;
        } else {
          regex += nextChar;
        }
        i++;
      } else if (/[.+^${}()|]/.test(c)) {
        // Escape regex special characters
        regex += `\\${c}`;
      } else {
        regex += c;
      }
    }

    return regex;
  }

  /**
   * Find the matching closing parenthesis, handling nesting
   */
  private findMatchingParen(pattern: string, openIdx: number): number {
    let depth = 1;
    let i = openIdx + 1;
    while (i < pattern.length && depth > 0) {
      const c = pattern[i];
      if (c === "\\") {
        i += 2; // Skip escaped char
        continue;
      }
      if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
      i++;
    }
    return -1;
  }

  /**
   * Split extglob pattern content on | handling nested patterns
   */
  private splitExtglobAlternatives(content: string): string[] {
    const alternatives: string[] = [];
    let current = "";
    let depth = 0;
    let i = 0;

    while (i < content.length) {
      const c = content[i];
      if (c === "\\") {
        // Escaped character
        current += c;
        if (i + 1 < content.length) {
          current += content[i + 1];
          i += 2;
        } else {
          i++;
        }
        continue;
      }
      if (c === "(") {
        depth++;
        current += c;
      } else if (c === ")") {
        depth--;
        current += c;
      } else if (c === "|" && depth === 0) {
        alternatives.push(current);
        current = "";
      } else {
        current += c;
      }
      i++;
    }
    alternatives.push(current);
    return alternatives;
  }

  /**
   * Convert POSIX character class name to regex equivalent
   */
  private posixClassToRegex(className: string): string {
    const posixClasses: Record<string, string> = {
      alnum: "a-zA-Z0-9",
      alpha: "a-zA-Z",
      ascii: "\\x00-\\x7F",
      blank: " \\t",
      cntrl: "\\x00-\\x1F\\x7F",
      digit: "0-9",
      graph: "!-~",
      lower: "a-z",
      print: " -~",
      punct: "!-/:-@\\[-`{-~",
      space: " \\t\\n\\r\\f\\v",
      upper: "A-Z",
      word: "a-zA-Z0-9_",
      xdigit: "0-9a-fA-F",
    };
    return posixClasses[className] || "";
  }
}
