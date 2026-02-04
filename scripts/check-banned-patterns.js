#!/usr/bin/env node
/**
 * Lint script to detect potentially unsafe code patterns.
 *
 * This script scans TypeScript files for patterns that could lead to
 * security vulnerabilities or common bugs.
 *
 * Opt-out: Add a comment on the same line or line above:
 *   // @banned-pattern-ignore: <reason>
 *
 * Example:
 *   // @banned-pattern-ignore: static keys only, never user input
 *   const COLORS: Record<string, string> = { red: "#f00" };
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * @typedef {Object} BannedPattern
 * @property {string} name - Human-readable name for the pattern
 * @property {RegExp} pattern - Regex to match the banned pattern
 * @property {string} message - Explanation of why it's banned
 * @property {string[]} solutions - Suggested fixes
 * @property {RegExp[]} [autoSafe] - Patterns that make a line automatically safe
 */

/** @type {BannedPattern[]} */
const BANNED_PATTERNS = [
  {
    name: "Record<string, T> variable declaration",
    // Match: const/let/var NAME: Record<string, or NAME = {} as Record<string,
    // This targets actual object creation, not type annotations
    pattern:
      /(?:const|let|var)\s+\w+\s*(?::\s*Record\s*<\s*string\s*,|=\s*\{[^}]*\}\s*as\s*Record\s*<\s*string\s*,)/,
    message:
      "Record<string, T> objects are vulnerable to prototype pollution when\n" +
      "accessed with user-controlled keys (e.g., obj[userInput] could access __proto__).",
    solutions: [
      "Use Map<string, T> instead (recommended)",
      "Use Object.create(null) when creating the object",
      "Add Object.hasOwn() check before bracket notation access",
    ],
    autoSafe: [/Object\.create\s*\(\s*null\s*\)/],
  },
  // Add more banned patterns here as needed
  // Example:
  // {
  //   name: "eval()",
  //   pattern: /\beval\s*\(/,
  //   message: "eval() can execute arbitrary code and is a security risk.",
  //   solutions: ["Use JSON.parse() for JSON data", "Use Function constructor if absolutely necessary"],
  // },
];

const IGNORE_COMMENT = /@banned-pattern-ignore:/;

// Directories to scan
const SCAN_DIRS = ["src"];

// Files/patterns to skip entirely
const SKIP_PATTERNS = [
  /\.test\.ts$/, // Test files are generally safe (hardcoded test data)
  /\.comparison\.test\.ts$/,
  /spec-tests/,
  /prototype-pollution\.test/, // These test the protection
];

/**
 * @typedef {Object} Violation
 * @property {string} file
 * @property {number} line
 * @property {string} content
 * @property {string} context
 * @property {BannedPattern} pattern
 */

/** @type {Violation[]} */
const violations = [];

/**
 * Check if a file should be skipped
 * @param {string} filePath
 * @returns {boolean}
 */
function shouldSkipFile(filePath) {
  return SKIP_PATTERNS.some((pattern) => pattern.test(filePath));
}

/**
 * Check if a line is safe for a specific pattern
 * @param {string[]} lines
 * @param {number} lineIndex
 * @param {BannedPattern} pattern
 * @returns {boolean}
 */
function isLineSafe(lines, lineIndex, pattern) {
  const line = lines[lineIndex];
  const prevLine = lineIndex > 0 ? lines[lineIndex - 1] : "";

  // Check for @banned-pattern-ignore comment on current or previous line
  if (IGNORE_COMMENT.test(line) || IGNORE_COMMENT.test(prevLine)) {
    return true;
  }

  // Check auto-safe patterns on current line
  if (pattern.autoSafe) {
    for (const safePat of pattern.autoSafe) {
      if (safePat.test(line)) {
        return true;
      }
    }
  }

  // Check next few lines for auto-safe patterns (multi-line declarations)
  if (pattern.autoSafe) {
    for (
      let i = lineIndex + 1;
      i < Math.min(lineIndex + 3, lines.length);
      i++
    ) {
      for (const safePat of pattern.autoSafe) {
        if (safePat.test(lines[i])) {
          return true;
        }
      }
      // Stop if we hit a semicolon or closing brace (end of statement)
      if (/[;{}]/.test(lines[i])) {
        const hasAutoSafe = pattern.autoSafe.some((p) => p.test(lines[i]));
        if (!hasAutoSafe) {
          break;
        }
      }
    }
  }

  return false;
}

/**
 * Scan a file for banned patterns
 * @param {string} filePath
 */
function scanFile(filePath) {
  if (shouldSkipFile(filePath)) {
    return;
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const pattern of BANNED_PATTERNS) {
      // Use a fresh regex for each test to avoid lastIndex issues
      // biome-ignore lint/style/noRestrictedGlobals: standalone lint script doesn't use internal utilities
      const testPattern = new RegExp(
        pattern.pattern.source,
        pattern.pattern.flags,
      );
      if (testPattern.test(line)) {
        if (!isLineSafe(lines, i, pattern)) {
          violations.push({
            file: filePath,
            line: i + 1,
            content: line.trim(),
            context: getContext(lines, i),
            pattern,
          });
        }
      }
    }
  }
}

/**
 * Get surrounding context for error message
 * @param {string[]} lines
 * @param {number} lineIndex
 * @returns {string}
 */
function getContext(lines, lineIndex) {
  const start = Math.max(0, lineIndex - 1);
  const end = Math.min(lines.length, lineIndex + 2);
  const contextLines = [];

  for (let i = start; i < end; i++) {
    const prefix = i === lineIndex ? ">" : " ";
    const lineNum = String(i + 1).padStart(4);
    contextLines.push(`${prefix} ${lineNum} | ${lines[i]}`);
  }

  return contextLines.join("\n");
}

/**
 * Recursively scan directory
 * @param {string} dir
 */
function scanDirectory(dir) {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip node_modules and dist
      if (entry !== "node_modules" && entry !== "dist") {
        scanDirectory(fullPath);
      }
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      scanFile(fullPath);
    }
  }
}

// Main
const rootDir = process.cwd();

for (const dir of SCAN_DIRS) {
  const fullDir = join(rootDir, dir);
  try {
    scanDirectory(fullDir);
  } catch (err) {
    console.error(`Error scanning ${dir}: ${err.message}`);
  }
}

if (violations.length > 0) {
  // Group violations by pattern
  /** @type {Map<string, Violation[]>} */
  const byPattern = new Map();
  for (const v of violations) {
    const key = v.pattern.name;
    if (!byPattern.has(key)) {
      byPattern.set(key, []);
    }
    byPattern.get(key).push(v);
  }

  console.error("\n\x1b[31m✖ Banned Code Patterns Detected\x1b[0m\n");

  for (const [patternName, patternViolations] of byPattern) {
    const pattern = patternViolations[0].pattern;

    console.error(`\x1b[33m━━━ ${patternName} ━━━\x1b[0m\n`);
    console.error(pattern.message);
    console.error("");
    console.error("\x1b[33mSolutions:\x1b[0m");
    for (const solution of pattern.solutions) {
      console.error(`  • ${solution}`);
    }
    console.error("");
    console.error(
      "\x1b[33mTo opt-out, add a comment explaining why it's safe:\x1b[0m",
    );
    console.error(
      "  // @banned-pattern-ignore: static keys only, never accessed with user input\n",
    );
    console.error(`\x1b[31mViolations (${patternViolations.length}):\x1b[0m\n`);

    for (const v of patternViolations) {
      const relPath = relative(rootDir, v.file);
      console.error(`\x1b[36m${relPath}:${v.line}\x1b[0m`);
      console.error(v.context);
      console.error("");
    }
  }

  console.error(
    `\x1b[31m✖ ${violations.length} total violation(s) found\x1b[0m\n`,
  );
  process.exit(1);
} else {
  console.log("\x1b[32m✓ No banned patterns detected\x1b[0m");
  process.exit(0);
}
