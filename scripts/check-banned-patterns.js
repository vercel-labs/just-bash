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
  {
    name: "Empty object literal assignment",
    // Match: const/let/var NAME = {} or NAME: TYPE = {}
    // Does NOT match: type definitions, interfaces, or object patterns
    pattern: /(?:const|let|var)\s+\w+\s*(?::\s*[^=]+)?\s*=\s*\{\s*\}/,
    message:
      "Empty object literals {} have a prototype chain and are vulnerable to\n" +
      "prototype pollution when populated with user-controlled keys.",
    solutions: [
      "Use new Map() instead (recommended)",
      "Use Object.create(null) for a prototype-free object",
      "Initialize with known static keys: { knownKey: value }",
    ],
    autoSafe: [/Object\.create\s*\(\s*null\s*\)/],
  },
  {
    name: "eval() usage",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\beval\s*\(/,
    message: "eval() executes arbitrary code and is a security risk.",
    solutions: [
      "Use JSON.parse() for parsing JSON data",
      "Use a proper parser for structured data",
      "Refactor to avoid dynamic code execution",
    ],
  },
  {
    name: "new Function() constructor",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*new\s+Function\s*\(/,
    message:
      "The Function constructor is equivalent to eval() and executes arbitrary code.",
    solutions: [
      "Use a proper parser or interpreter",
      "Refactor to avoid dynamic code generation",
    ],
  },
  {
    name: "for...in loop",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*for\s*\(\s*(?:const|let|var)?\s*\w+\s+in\s+/,
    message:
      "for...in iterates over the prototype chain and can expose inherited properties\n" +
      "like __proto__. It's also slower than alternatives.",
    solutions: [
      "Use Object.keys(obj).forEach() or for...of Object.keys(obj)",
      "Use Object.entries(obj) for key-value pairs",
      "Use for...of with arrays",
    ],
    autoSafe: [/Object\.hasOwn/, /\.hasOwnProperty\s*\(/],
  },
  {
    name: "Direct __proto__ access",
    // Match __proto__ in code, not in comments or strings used for validation
    // Skip lines that are comments (// or * at start after whitespace)
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*(?<!['"]\s*)__proto__(?!\s*['"])/,
    message:
      "__proto__ is a deprecated way to access/modify prototypes and is a\n" +
      "prototype pollution vector. It should never appear in production code.",
    solutions: [
      "Use Object.getPrototypeOf() to read the prototype",
      "Use Object.setPrototypeOf() to set the prototype (rarely needed)",
      "Use Object.create() to create objects with a specific prototype",
    ],
    // Allow __proto__ in string literals (for validation sets like DANGEROUS_KEYS)
    autoSafe: [/["']__proto__["']/],
  },
  {
    name: "constructor.prototype access",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\.constructor\.prototype/,
    message:
      "Accessing constructor.prototype can be used for prototype pollution attacks\n" +
      "and should be avoided with user-controlled data.",
    solutions: [
      "Use Object.getPrototypeOf() if you need prototype access",
      "Validate that the object is not user-controlled",
    ],
  },
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
 * @typedef {Object} IgnoreComment
 * @property {string} file
 * @property {number} line
 * @property {string} content
 * @property {boolean} used
 */

/** @type {IgnoreComment[]} */
const ignoreComments = [];

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
 * @param {string} filePath
 * @returns {{safe: boolean, usedIgnoreComment: IgnoreComment | null}}
 */
function isLineSafe(lines, lineIndex, pattern, filePath) {
  const line = lines[lineIndex];

  // Check for @banned-pattern-ignore comment on current line or up to 2 lines before
  // (to allow for other ignore comments like biome-ignore between)
  for (let offset = 0; offset <= 2; offset++) {
    const checkIndex = lineIndex - offset;
    if (checkIndex < 0) break;
    if (IGNORE_COMMENT.test(lines[checkIndex])) {
      const comment = ignoreComments.find(
        (c) => c.file === filePath && c.line === checkIndex + 1,
      );
      return { safe: true, usedIgnoreComment: comment || null };
    }
  }

  // Check auto-safe patterns on current line
  if (pattern.autoSafe) {
    for (const safePat of pattern.autoSafe) {
      if (safePat.test(line)) {
        return { safe: true, usedIgnoreComment: null };
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
          return { safe: true, usedIgnoreComment: null };
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

  return { safe: false, usedIgnoreComment: null };
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

  // First pass: collect all ignore comments in this file
  for (let i = 0; i < lines.length; i++) {
    if (IGNORE_COMMENT.test(lines[i])) {
      ignoreComments.push({
        file: filePath,
        line: i + 1,
        content: lines[i].trim(),
        used: false,
      });
    }
  }

  // Second pass: check for pattern violations
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
        const result = isLineSafe(lines, i, pattern, filePath);
        if (!result.safe) {
          violations.push({
            file: filePath,
            line: i + 1,
            content: line.trim(),
            context: getContext(lines, i),
            pattern,
          });
        } else if (result.usedIgnoreComment) {
          result.usedIgnoreComment.used = true;
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

// Check for unused ignore comments
const unusedIgnores = ignoreComments.filter((c) => !c.used);

let hasErrors = false;

if (violations.length > 0) {
  hasErrors = true;
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
}

if (unusedIgnores.length > 0) {
  hasErrors = true;
  console.error("\n\x1b[31m✖ Unused @banned-pattern-ignore Comments\x1b[0m\n");
  console.error(
    "The following ignore comments don't suppress any banned pattern.\n" +
      "Remove them or ensure the pattern they're meant to suppress is correct.\n",
  );

  for (const ignore of unusedIgnores) {
    const relPath = relative(rootDir, ignore.file);
    console.error(`\x1b[36m${relPath}:${ignore.line}\x1b[0m`);
    console.error(`  ${ignore.content}`);
    console.error("");
  }

  console.error(
    `\x1b[31m✖ ${unusedIgnores.length} unused ignore comment(s) found\x1b[0m\n`,
  );
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log("\x1b[32m✓ No banned patterns detected\x1b[0m");
  process.exit(0);
}
