/**
 * Glob Expander - Expands glob patterns to matching file paths
 *
 * Handles:
 * - * (matches any characters except /)
 * - ** (matches any characters including /)
 * - ? (matches single character)
 * - [...] (character classes)
 */

import type { IFileSystem } from "../fs.js";

export class GlobExpander {
  constructor(
    private fs: IFileSystem,
    private cwd: string,
  ) {}

  /**
   * Check if a string contains glob characters
   */
  isGlobPattern(str: string): boolean {
    return str.includes("*") || str.includes("?") || /\[.*\]/.test(str);
  }

  /**
   * Expand an array of arguments, replacing glob patterns with matched files
   * @param args - Array of argument strings
   * @param quotedFlags - Optional array indicating which args were quoted (should not expand)
   */
  async expandArgs(args: string[], quotedFlags?: boolean[]): Promise<string[]> {
    const result: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const isQuoted = quotedFlags?.[i] ?? false;

      // Skip glob expansion for quoted arguments
      if (isQuoted || !this.isGlobPattern(arg)) {
        result.push(arg);
      } else {
        const expanded = await this.expand(arg);
        if (expanded.length > 0) {
          result.push(...expanded);
        } else {
          // If no matches, keep the original pattern (bash default behavior)
          result.push(arg);
        }
      }
    }

    return result;
  }

  /**
   * Expand a single glob pattern
   */
  async expand(pattern: string): Promise<string[]> {
    // Handle ** (recursive) patterns
    if (pattern.includes("**")) {
      return this.expandRecursive(pattern);
    }

    return this.expandSimple(pattern);
  }

  /**
   * Expand a simple glob pattern (no **)
   */
  private async expandSimple(pattern: string): Promise<string[]> {
    const results: string[] = [];

    // Find the directory part and the glob part
    const lastSlash = pattern.lastIndexOf("/");
    let dirPath: string;
    let globPart: string;

    if (lastSlash === -1) {
      dirPath = this.cwd;
      globPart = pattern;
    } else {
      dirPath = pattern.slice(0, lastSlash) || "/";
      globPart = pattern.slice(lastSlash + 1);
    }

    // Resolve the directory path
    const fullDirPath = this.fs.resolvePath(this.cwd, dirPath);

    try {
      const entries = await this.fs.readdir(fullDirPath);

      for (const entry of entries) {
        if (this.matchPattern(entry, globPart)) {
          const fullPath = lastSlash === -1 ? entry : `${dirPath}/${entry}`;
          results.push(fullPath);
        }
      }
    } catch {
      // Directory doesn't exist - return empty
    }

    return results.sort();
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
      const entries = await this.fs.readdir(fullPath);

      for (const entry of entries) {
        const entryPath = dir === "." ? entry : `${dir}/${entry}`;
        const fullEntryPath = this.fs.resolvePath(this.cwd, entryPath);

        try {
          const stat = await this.fs.stat(fullEntryPath);

          if (stat.isDirectory) {
            // Recurse into subdirectories
            await this.walkDirectory(entryPath, filePattern, results);
          } else if (filePattern) {
            // Check if file matches pattern
            if (this.matchPattern(entry, filePattern)) {
              results.push(entryPath);
            }
          }
        } catch {
          // Ignore errors for individual entries
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
    let regex = "^";

    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];

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

    regex += "$";
    return new RegExp(regex);
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
