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
 * @property {RegExp} [filePattern] - Optional file path regex to scope the rule
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
    name: "Empty object literal in expression",
    // Match: ?? {}, || {}, return {}, ( {} ), , {}, : {} (ternary)
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*(?:\?\?|\|\||return\s|[,(:])\s*\{\s*\}(?:\s*[;,)\]]|$)/,
    message:
      "Empty object literals {} have Object.prototype and are vulnerable to\n" +
      "prototype pollution. Use Object.create(null) instead.",
    solutions: [
      "Use Object.create(null) for a prototype-free object",
      "Use nullPrototypeCopy() or nullPrototypeMerge() from safe-object.ts",
    ],
    autoSafe: [
      /Object\.create\s*\(\s*null\s*\)/,
      /nullPrototypeCopy\s*\(/,
      /nullPrototypeMerge\s*\(/,
      /mergeToNullPrototype\s*\(/,
      /Object\.entries\s*\(/,
      /Object\.keys\s*\(/,
      /new Headers\s*\(/,
    ],
  },
  {
    name: "Object.fromEntries() without null-prototype wrapper",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*Object\.fromEntries\s*\(/,
    message:
      "Object.fromEntries() creates plain objects with Object.prototype.\n" +
      "When keys are user-controlled, this can introduce prototype pollution risks.",
    solutions: [
      "Wrap with Object.assign(Object.create(null), Object.fromEntries(...))",
      "Use mergeToNullPrototype() if combining with other objects",
      "Use Map when possible for dynamic keys",
    ],
    autoSafe: [
      /Object\.assign\s*\(\s*Object\.create\s*\(\s*null\s*\)\s*,/,
      /mergeToNullPrototype\s*\(/,
      /nullPrototypeMerge\s*\(/,
    ],
  },
  {
    name: "Array containing empty object literal",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\[\s*\{\s*\}\s*\]/,
    message:
      "[{}] creates plain objects with Object.prototype. For dynamic data paths,\n" +
      "use Object.create(null) to avoid prototype-chain surprises.",
    solutions: [
      "Use [Object.create(null)] instead of [{}]",
      "Use nullPrototypeCopy() for object values copied from input",
    ],
    autoSafe: [/Object\.create\s*\(\s*null\s*\)/],
  },
  {
    name: "Metadata spread merge into plain object",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*\b(?:meta|metadata)\s*=\s*\{\s*\.\.\.\s*(?:meta|metadata)\s*,\s*\.\.\./,
    message:
      "Merging metadata via object spread creates a plain object with Object.prototype.\n" +
      "Prefer null-prototype merges for defensive consistency.",
    solutions: [
      "Use mergeToNullPrototype(meta, nextMetadata)",
      "Use Object.assign(Object.create(null), meta, nextMetadata)",
    ],
    autoSafe: [
      /mergeToNullPrototype\s*\(/,
      /Object\.assign\s*\(\s*Object\.create\s*\(\s*null\s*\)\s*,/,
    ],
  },
  {
    name: "Object.assign({}, ...) plain-object merge",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*Object\.assign\s*\(\s*\{\s*\}\s*,/,
    message:
      "Object.assign({}, ...) creates an object with Object.prototype.\n" +
      "When merging user-influenced data, this can preserve prototype pollution risk.",
    solutions: [
      "Use Object.assign(Object.create(null), ...sources)",
      "Use mergeToNullPrototype() or nullPrototypeMerge() helpers",
      "Use Map for dynamic key collections",
    ],
    autoSafe: [
      /Object\.assign\s*\(\s*Object\.create\s*\(\s*null\s*\)\s*,/,
      /mergeToNullPrototype\s*\(/,
      /nullPrototypeMerge\s*\(/,
    ],
  },
  {
    name: "Direct obj.hasOwnProperty() call",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\.hasOwnProperty\s*\(/,
    message:
      "Direct obj.hasOwnProperty() can fail on null-prototype objects and can be\n" +
      "shadowed by user-controlled properties.",
    solutions: [
      "Use Object.hasOwn(obj, key) (recommended)",
      "Or use Object.prototype.hasOwnProperty.call(obj, key)",
    ],
    autoSafe: [
      /Object\.prototype\.hasOwnProperty\.call\s*\(/,
      /Object\.hasOwn\s*\(/,
    ],
  },
  {
    name: "Raw error.message forwarded to stderr",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*\bstderr\b[^\n]*\$\{[^}]*\.message[^}]*\}/,
    message:
      "Forwarding raw error.message to stderr can leak host paths, internal module\n" +
      "names, and stack details. Sanitize before exposing to untrusted scripts.",
    solutions: [
      "Wrap message with sanitizeErrorMessage(...) before writing to stderr",
      "Map to stable user-facing errors (ENOENT/EACCES/etc.) instead of raw engine errors",
      "Use @banned-pattern-ignore only with a concrete safety reason",
    ],
    autoSafe: [/sanitizeErrorMessage\s*\(/],
  },
  {
    name: "Raw error.message in structured error payload",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*\berror\s*:\s*(?:`[^`]*\$\{[^}]*\.message[^}]*\}[^`]*`|[^,;]*\.message\b)/,
    message:
      "Forwarding raw error.message in structured payloads can leak host/internal\n" +
      "details if surfaced later. Sanitize or map to controlled error strings.",
    solutions: [
      "Use sanitizeErrorMessage(...) on error text before storing in error payloads",
      "Convert to typed error codes and stable user-facing messages",
      "Use @banned-pattern-ignore only with a concrete safety reason",
    ],
    autoSafe: [/sanitizeErrorMessage\s*\(/],
  },
  {
    name: "throw new Error(...error.message...) forwarding",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*throw\s+new\s+Error\s*\([^)]*\.message\b/,
    message:
      "Throwing new Error with raw nested error.message can preserve sensitive\n" +
      "host/internal details across abstraction boundaries.",
    solutions: [
      "Sanitize nested error text with sanitizeErrorMessage(...) before wrapping",
      "Wrap with stable message and attach original error as cause when needed",
      "Use @banned-pattern-ignore only with a concrete safety reason",
    ],
    autoSafe: [/sanitizeErrorMessage\s*\(/],
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
    name: "Proxy.revocable() usage",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\bProxy\.revocable\s*\(/,
    message:
      "Proxy.revocable can recreate raw proxy capabilities and has known bypass\n" +
      "interactions with defense wrappers when used in untrusted execution paths.",
    solutions: [
      "Avoid Proxy.revocable in runtime paths handling untrusted input",
      "Prefer plain objects and explicit validation over revocable proxy control flow",
      "Use @banned-pattern-ignore only with a concrete audited safety reason",
    ],
  },
  {
    name: "Dangerous global constructor shadowing",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*(?:delete\s+globalThis\.(?:Function|eval|Proxy)\b|globalThis\.(?:Function|eval|Proxy)\s*=|Object\.defineProperty\s*\(\s*globalThis\s*,\s*["'`](?:Function|eval|Proxy)["'`])/,
    message:
      "Shadowing/deleting global Function/eval/Proxy can disable security wrappers\n" +
      "and re-enable dynamic code-execution primitives.",
    solutions: [
      "Do not mutate global constructors in runtime command/interpreter paths",
      "Use local dependency injection instead of global monkey-patching",
      "Use @banned-pattern-ignore only for tightly-audited defense internals/tests",
    ],
  },
  {
    name: "Dynamic import() with non-literal specifier",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\bimport\s*\(\s*(?!["'`])/,
    message:
      "Dynamic import() with non-literal specifiers can become a module-loading\n" +
      "code-execution primitive if the specifier is tainted.",
    solutions: [
      "Use static literal import specifiers",
      "Use an explicit allowlist map from known keys to literal imports",
      "Reject unknown module keys before dispatch",
    ],
  },
  {
    name: "Dynamic require() with non-literal specifier",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\brequire\s*\(\s*(?!["'`])/,
    message:
      "Dynamic require() with non-literal specifiers can become a module-loading\n" +
      "code-execution primitive if the specifier is tainted.",
    solutions: [
      "Use static literal require specifiers: require('module-name')",
      "Use an explicit allowlist map from known keys to literal imports",
      "Reject unknown module keys before dispatch",
    ],
  },
  {
    name: "createRequire() usage outside approved worker module",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\bcreateRequire\s*\(/,
    filePattern: /src\/(?!commands\/python3\/worker\.ts$).*\.ts$/,
    message:
      "createRequire can expose unrestricted module-loading behavior and should be\n" +
      "confined to audited worker bootstrap code.",
    solutions: [
      "Use static imports for known dependencies",
      "If truly needed, confine to an audited module and document the threat model",
      "Use @banned-pattern-ignore only with concrete approval rationale",
    ],
  },
  {
    name: "Module._load/_resolveFilename access outside approved worker module",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\._(?:load|resolveFilename)\s*\(/,
    filePattern: /src\/(?!commands\/python3\/worker\.ts$).*\.ts$/,
    message:
      "Direct Module._load/_resolveFilename access bypasses normal module boundaries\n" +
      "and can reintroduce dangerous host-module execution paths.",
    solutions: [
      "Use normal static imports",
      "If unavoidable, isolate in one audited module with clear invariants",
      "Use @banned-pattern-ignore only with concrete approval rationale",
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
  {
    name: "Dynamic Reflect property key",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*Reflect\.(?:get|set|deleteProperty)\s*\(\s*[^,]+,\s*(?!["'`0-9])[a-zA-Z_$][\w$]*/,
    message:
      "Reflect.get/set/deleteProperty with dynamic keys can traverse prototype\n" +
      "gadgets (constructor/prototype/__proto__) unless keys are explicitly validated.",
    solutions: [
      "Guard keys with isSafeKey(...) before Reflect operations",
      "Use safeSet()/safeFromEntries() helpers for user-influenced key paths",
      "Use @banned-pattern-ignore only with concrete proof that keys are static",
    ],
    autoSafe: [/isSafeKey\s*\(/, /safeSet\s*\(/, /safeFromEntries\s*\(/],
  },
  {
    name: "Dynamic defineProperty/descriptor key",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*Object\.(?:defineProperty|getOwnPropertyDescriptor)\s*\(\s*[^,]+,\s*(?!["'`0-9])[a-zA-Z_$][\w$]*/,
    message:
      "Dynamic property names in Object.defineProperty/getOwnPropertyDescriptor\n" +
      "can expose prototype mutation/inspection primitives when keys are tainted.",
    solutions: [
      "Use static string literals for property names whenever possible",
      "Validate dynamic keys with isSafeKey(...) before property API calls",
      "Use @banned-pattern-ignore only with concrete proof that keys are trusted",
    ],
    autoSafe: [/isSafeKey\s*\(/],
  },
  {
    name: "Prototype mutation API",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*(?:Object|Reflect)\.setPrototypeOf\s*\(/,
    message:
      "setPrototypeOf mutates prototype chains and is a high-risk primitive for\n" +
      "prototype pollution exploit chains.",
    solutions: [
      "Avoid setPrototypeOf entirely in runtime paths handling untrusted data",
      "Prefer Object.create(null) and plain data copies over prototype mutation",
      "Use @banned-pattern-ignore only for tightly-audited hardening code",
    ],
  },
  {
    name: "Dot-path reduce chain",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*split\s*\(\s*["']\.\s*["']\s*\)\s*\.reduce\s*\(/,
    message:
      "Dot-path reducers are a common source of prototype pollution when path\n" +
      "segments include constructor/prototype/__proto__.",
    solutions: [
      "Validate each segment with isSafeKey(...) before object traversal",
      "Use null-prototype containers when materializing dynamic path objects",
      "Use @banned-pattern-ignore only with concrete proof of static segments",
    ],
    autoSafe: [/isSafeKey\s*\(/, /Object\.create\s*\(\s*null\s*\)/],
  },
  {
    name: "Reduce accumulator initialized with {}",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\.reduce\s*\([^,]*,\s*\{\s*\}\s*\)/,
    message:
      "Using {} as a reducer accumulator can reintroduce Object.prototype in\n" +
      "dynamic-key flows and enable prototype-chain surprises.",
    solutions: [
      "Use Object.create(null) as reducer seed for dynamic key accumulation",
      "Use Map as the accumulator when keys are data-driven",
      "Use @banned-pattern-ignore only with concrete proof of static keys",
    ],
    autoSafe: [/Object\.create\s*\(\s*null\s*\)/, /new Map\s*\(/],
  },
  {
    name: "Unsafe bracket notation on Record<string, T>",
    // Match: (x as Record<string, T>)[variable] where variable is not a string/number literal
    // This catches patterns like: (obj as Record<string, unknown>)[key]
    // But NOT: (obj as Record<string, unknown>)["literal"] or [0]
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*as\s+Record\s*<\s*string\s*,\s*[^>]+>\s*\)\s*\[\s*(?!["'`0-9])[a-zA-Z_]/,
    message:
      "Accessing Record<string, T> with bracket notation using a variable key can\n" +
      "expose inherited prototype properties like __proto__, constructor, __defineGetter__.\n" +
      "This is a prototype pollution vulnerability.",
    solutions: [
      "Add Object.hasOwn(obj, key) check before accessing: if (Object.hasOwn(obj, key)) { obj[key] }",
      "Use Object.keys(obj) to iterate, which only returns own properties",
      "Use the safeGet() helper from safe-object.ts",
    ],
    // Safe if Object.hasOwn is checked on same line or nearby, or if using Object.keys
    autoSafe: [/Object\.hasOwn/, /Object\.keys/, /Object\.entries/],
  },
  {
    name: "Raw await in defense-sensitive interpreters",
    // Skip comment lines
    pattern: /^(?!\s*(?:\/\/|\/?\*)).*\bawait\b/,
    filePattern:
      /src\/commands\/(?:awk\/(?:awk2|interpreter\/[^/]+)|sed\/sed|jq\/jq|yq\/yq|query-engine\/[^/]+)\.ts$/,
    message:
      "Raw await in high-risk interpreter paths can hide defense-context drift.\n" +
      "Use defense-aware await wrappers to fail closed on context loss.",
    solutions: [
      "Wrap async boundaries with awaitWithDefenseContext(...)",
      "Use a local withDefenseContext(...) helper that delegates to awaitWithDefenseContext(...)",
      "Use @banned-pattern-ignore only with a concrete safety reason",
    ],
    autoSafe: [/awaitWithDefenseContext\s*\(/, /withDefenseContext\s*\(/],
  },
  {
    name: "Inline worker.on callback in WASM command paths",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*\bworker\.on\s*\(\s*["'][^"']+["']\s*,\s*(?:\([^)]*\)\s*=>|function\s*\()/,
    filePattern: /src\/commands\/(?:python3\/python3|sqlite3\/sqlite3)\.ts$/,
    message:
      "Inline worker event callbacks in WASM command paths can lose defense context.\n" +
      "Bind callbacks via bindDefenseContextCallback(...) and pass a named handler.",
    solutions: [
      "Create a named callback with bindDefenseContextCallback(...)",
      "Register as worker.on(event, (arg) => wrapped(arg)) to catch and sanitize failures",
      "Use @banned-pattern-ignore only with a concrete safety reason",
    ],
    autoSafe: [/bindDefenseContextCallback\s*\(/],
  },
  {
    name: "Inline _setTimeout callback in WASM command paths",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*\b_setTimeout\s*\(\s*(?:\([^)]*\)\s*=>|function\s*\()/,
    filePattern: /src\/commands\/(?:python3\/python3|sqlite3\/sqlite3)\.ts$/,
    message:
      "Inline timeout callbacks in WASM command paths can run without defense context.\n" +
      "Use bindDefenseContextCallback(...) and invoke it from a guarded wrapper.",
    solutions: [
      "Create onTimeout with bindDefenseContextCallback(...)",
      "Call onTimeout() inside try/catch and sanitize failures",
      "Use @banned-pattern-ignore only with a concrete safety reason",
    ],
    autoSafe: [/bindDefenseContextCallback\s*\(/],
  },
  {
    name: "Raw Record<string, unknown> cast in query engine",
    pattern: /as\s+Record\s*<\s*string\s*,\s*unknown\s*>/,
    filePattern: /src\/commands\/query-engine\/(?!safe-object).*\.ts$/,
    message:
      "Raw Record<string, unknown> casts bypass the centralized asQueryRecord() helper.\n" +
      "Use asQueryRecord(value) for auditable, type-safe property access.",
    solutions: ["Use asQueryRecord(value) from safe-object.ts"],
    autoSafe: [/asQueryRecord/],
  },
  {
    name: "Inline WASM hook callback in worker modules",
    // Skip comment lines
    pattern:
      /^(?!\s*(?:\/\/|\/?\*)).*\b(?:print|printErr|onViolation)\s*:\s*(?:\([^)]*\)\s*=>|function\s*\()/,
    filePattern: /src\/commands\/(?:python3|sqlite3)\/worker\.ts$/,
    message:
      "Inline WASM hook callbacks in worker modules can hide unsafe callback handling.\n" +
      "Wrap these callbacks with wrapWasmCallback(...) for consistent sanitization.",
    solutions: [
      "Create a named callback via wrapWasmCallback(...)",
      "Pass the named callback into the module config instead of inline lambdas",
      "Use @banned-pattern-ignore only with a concrete safety reason",
    ],
    autoSafe: [/wrapWasmCallback\s*\(/],
  },
];

const IGNORE_COMMENT = /@banned-pattern-ignore:/;

// Directories to scan
const SCAN_DIRS = ["."];

// Directories to skip entirely
const SKIP_DIRS = new Set([
  "node_modules",
  "dist",
  "vendor",
  ".git",
  ".pnpm-store",
  ".next",
  "coverage",
]);

const SKIP_PATH_PATTERNS = [
  /(^|\/)\.pnpm-store(\/|$)/,
  /(^|\/)examples\/website\/app\/api\/agent\/_agent-data(\/|$)/,
];

// Files/patterns to skip entirely
const SKIP_PATTERNS = [
  /\.test\.ts$/, // Test files are generally safe (hardcoded test data)
  /\.comparison\.test\.ts$/,
  /spec-tests/,
  /prototype-pollution\.test/, // These test the protection
  /src\/security\//, // Security module intentionally references blocked patterns
  /src\/commands\/python3\/worker\.js$/, // Generated artifact, source is worker.ts
  /scripts\/check-banned-patterns\.js$/, // Self-lint script contains pattern definitions by design
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
  return (
    SKIP_PATH_PATTERNS.some((pattern) => pattern.test(filePath)) ||
    SKIP_PATTERNS.some((pattern) => pattern.test(filePath))
  );
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
      if (pattern.filePattern && !pattern.filePattern.test(filePath)) {
        continue;
      }
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
    if (SKIP_PATH_PATTERNS.some((pattern) => pattern.test(fullPath))) {
      continue;
    }
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Skip generated/third-party directories
      if (!SKIP_DIRS.has(entry)) {
        scanDirectory(fullPath);
      }
    } else if (
      (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) ||
      entry.endsWith(".js") ||
      entry.endsWith(".mjs") ||
      entry.endsWith(".cjs")
    ) {
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
