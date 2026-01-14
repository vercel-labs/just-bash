/**
 * .gitignore parser for rg
 *
 * Handles:
 * - Simple patterns (*.log, node_modules/)
 * - Negation patterns (!important.log)
 * - Directory-only patterns (build/)
 * - Rooted patterns (/root-only)
 * - Double-star patterns (for matching across directories)
 */

import type { IFileSystem } from "../../fs/interface.js";

interface GitignorePattern {
  /** Original pattern string */
  pattern: string;
  /** Compiled regex for matching */
  regex: RegExp;
  /** Whether this is a negation pattern (starts with !) */
  negated: boolean;
  /** Whether this only matches directories (ends with /) */
  directoryOnly: boolean;
  /** Whether this is rooted (starts with / or contains /) */
  rooted: boolean;
}

export class GitignoreParser {
  private patterns: GitignorePattern[] = [];
  private basePath: string;

  constructor(basePath: string = "/") {
    this.basePath = basePath;
  }

  /**
   * Parse .gitignore content and add patterns
   */
  parse(content: string): void {
    const lines = content.split("\n");

    for (const line of lines) {
      // Trim trailing whitespace (but not leading - significant in gitignore)
      let trimmed = line.replace(/\s+$/, "");

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      // Handle negation
      let negated = false;
      if (trimmed.startsWith("!")) {
        negated = true;
        trimmed = trimmed.slice(1);
      }

      // Handle directory-only patterns
      let directoryOnly = false;
      if (trimmed.endsWith("/")) {
        directoryOnly = true;
        trimmed = trimmed.slice(0, -1);
      }

      // Handle rooted patterns
      let rooted = false;
      if (trimmed.startsWith("/")) {
        rooted = true;
        trimmed = trimmed.slice(1);
      } else if (trimmed.includes("/") && !trimmed.startsWith("**/")) {
        // Patterns with / in the middle are rooted
        rooted = true;
      }

      // Convert gitignore pattern to regex
      const regex = this.patternToRegex(trimmed, rooted);

      this.patterns.push({
        pattern: line,
        regex,
        negated,
        directoryOnly,
        rooted,
      });
    }
  }

  /**
   * Convert a gitignore pattern to a regex
   */
  private patternToRegex(pattern: string, rooted: boolean): RegExp {
    let regexStr = "";

    // If not rooted, can match at any depth
    if (!rooted) {
      regexStr = "(?:^|/)";
    } else {
      regexStr = "^";
    }

    let i = 0;
    while (i < pattern.length) {
      const char = pattern[i];

      if (char === "*") {
        if (pattern[i + 1] === "*") {
          // ** matches any number of directories
          if (pattern[i + 2] === "/") {
            // **/ matches zero or more directories
            regexStr += "(?:.*/)?";
            i += 3;
          } else if (i + 2 >= pattern.length) {
            // ** at end matches everything
            regexStr += ".*";
            i += 2;
          } else {
            // ** in middle
            regexStr += ".*";
            i += 2;
          }
        } else {
          // * matches anything except /
          regexStr += "[^/]*";
          i++;
        }
      } else if (char === "?") {
        // ? matches any single character except /
        regexStr += "[^/]";
        i++;
      } else if (char === "[") {
        // Character class - find the closing ]
        let j = i + 1;
        if (j < pattern.length && pattern[j] === "!") j++;
        if (j < pattern.length && pattern[j] === "]") j++;
        while (j < pattern.length && pattern[j] !== "]") j++;

        if (j < pattern.length) {
          // Valid character class
          let charClass = pattern.slice(i, j + 1);
          // Convert [!...] to [^...]
          if (charClass.startsWith("[!")) {
            charClass = `[^${charClass.slice(2)}`;
          }
          regexStr += charClass;
          i = j + 1;
        } else {
          // No closing ], treat [ as literal
          regexStr += "\\[";
          i++;
        }
      } else if (char === "/") {
        regexStr += "/";
        i++;
      } else {
        // Escape regex special characters
        regexStr += char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        i++;
      }
    }

    // Pattern should match the full path component
    regexStr += "(?:/.*)?$";

    return new RegExp(regexStr);
  }

  /**
   * Check if a path should be ignored
   *
   * @param relativePath Path relative to the gitignore location
   * @param isDirectory Whether the path is a directory
   * @returns true if the path should be ignored
   */
  matches(relativePath: string, isDirectory: boolean): boolean {
    // Normalize path - remove leading ./
    let path = relativePath.replace(/^\.\//, "");

    // Ensure path starts without /
    path = path.replace(/^\//, "");

    let ignored = false;

    for (const pattern of this.patterns) {
      // Skip directory-only patterns for files
      if (pattern.directoryOnly && !isDirectory) {
        continue;
      }

      if (pattern.regex.test(path)) {
        ignored = !pattern.negated;
      }
    }

    return ignored;
  }

  /**
   * Get the base path for this gitignore
   */
  getBasePath(): string {
    return this.basePath;
  }
}

/**
 * Hierarchical gitignore manager
 *
 * Loads .gitignore and .ignore files from the root down to the current directory,
 * applying patterns in order (child patterns override parent patterns).
 */
export class GitignoreManager {
  private parsers: GitignoreParser[] = [];
  private fs: IFileSystem;
  private rootPath: string;

  constructor(fs: IFileSystem, rootPath: string) {
    this.fs = fs;
    this.rootPath = rootPath;
  }

  /**
   * Load all .gitignore and .ignore files from root to the specified path
   */
  async load(targetPath: string): Promise<void> {
    // Build list of directories from root to target
    const dirs: string[] = [];
    let current = targetPath;

    while (current.startsWith(this.rootPath) || current === this.rootPath) {
      dirs.unshift(current);
      const parent = this.fs.resolvePath(current, "..");
      if (parent === current) break;
      current = parent;
    }

    // Load .gitignore and .ignore from each directory
    // ripgrep loads them in order: .gitignore, then .ignore (ignore can override)
    for (const dir of dirs) {
      for (const filename of [".gitignore", ".ignore"]) {
        const ignorePath = this.fs.resolvePath(dir, filename);
        try {
          const content = await this.fs.readFile(ignorePath);
          const parser = new GitignoreParser(dir);
          parser.parse(content);
          this.parsers.push(parser);
        } catch {
          // No ignore file in this directory
        }
      }
    }
  }

  /**
   * Check if a path should be ignored
   *
   * @param absolutePath Absolute path to check
   * @param isDirectory Whether the path is a directory
   * @returns true if the path should be ignored
   */
  matches(absolutePath: string, isDirectory: boolean): boolean {
    for (const parser of this.parsers) {
      // Get path relative to the gitignore location
      const basePath = parser.getBasePath();
      if (!absolutePath.startsWith(basePath)) continue;

      const relativePath = absolutePath
        .slice(basePath.length)
        .replace(/^\//, "");
      if (parser.matches(relativePath, isDirectory)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Quick check for common ignored directories
   * Used for early pruning during traversal
   */
  static isCommonIgnored(name: string): boolean {
    const common = new Set([
      "node_modules",
      ".git",
      ".svn",
      ".hg",
      "__pycache__",
      ".pytest_cache",
      ".mypy_cache",
      "venv",
      ".venv",
      "dist",
      "build",
      ".next",
      ".nuxt",
      "target",
      ".cargo",
    ]);
    return common.has(name);
  }
}

/**
 * Load gitignore files for a search starting at the given path
 */
export async function loadGitignores(
  fs: IFileSystem,
  startPath: string,
): Promise<GitignoreManager> {
  const manager = new GitignoreManager(fs, startPath);
  await manager.load(startPath);
  return manager;
}
