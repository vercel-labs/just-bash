/**
 * Word Expansion
 *
 * Handles shell word expansion including:
 * - Variable expansion ($VAR, ${VAR})
 * - Command substitution $(...)
 * - Arithmetic expansion $((...))
 * - Tilde expansion (~)
 * - Brace expansion {a,b,c}
 * - Glob expansion (*, ?, [...])
 */

import type {
  ArithExpr,
  InnerParameterOperation,
  ParameterExpansionPart,
  PatternRemovalOp,
  PatternReplacementOp,
  ScriptNode,
  SimpleCommandNode,
  SubstringOp,
  WordNode,
  WordPart,
} from "../ast/types.js";
import { parseArithmeticExpression } from "../parser/arithmetic-parser.js";
import { Parser } from "../parser/parser.js";
import { GlobExpander } from "../shell/glob.js";
import { evaluateArithmetic, evaluateArithmeticSync } from "./arithmetic.js";
import {
  ArithmeticError,
  BadSubstitutionError,
  ExecutionLimitError,
  ExitError,
  GlobError,
} from "./errors.js";
import {
  analyzeWordParts,
  paramExpansionNeedsAsync,
  partNeedsAsync,
  wordNeedsAsync,
} from "./expansion/analysis.js";
import { expandBraceRange } from "./expansion/brace-range.js";
import { patternToRegex } from "./expansion/pattern.js";
import {
  getArrayElements,
  getVariable,
  isArray,
  isVariableSet,
} from "./expansion/variable.js";
import { smartWordSplit } from "./expansion/word-split.js";
import {
  buildIfsCharClassPattern,
  getIfs,
  getIfsSeparator,
  isIfsEmpty,
  isIfsWhitespaceOnly,
  splitByIfsForExpansion,
} from "./helpers/ifs.js";
import {
  getNamerefTarget,
  isNameref,
  resolveNameref,
} from "./helpers/nameref.js";
import { isReadonly } from "./helpers/readonly.js";
import { escapeRegex } from "./helpers/regex.js";
import { getLiteralValue, isQuotedPart } from "./helpers/word-parts.js";
import type { InterpreterContext } from "./types.js";

// Re-export for backward compatibility
export {
  getArrayElements,
  getVariable,
  isArray,
} from "./expansion/variable.js";

/**
 * Apply pattern removal (prefix or suffix strip) to a single value.
 * Used by both scalar and vectorized array operations.
 */
function applyPatternRemoval(
  value: string,
  regexStr: string,
  side: "prefix" | "suffix",
  greedy: boolean,
): string {
  // Use 's' flag (dotall) so that . matches newlines (bash ? matches any char including newline)
  if (side === "prefix") {
    // Prefix removal: greedy matches longest from start, non-greedy matches shortest
    return value.replace(new RegExp(`^${regexStr}`, "s"), "");
  }
  // Suffix removal needs special handling because we need to find
  // the rightmost (shortest) or leftmost (longest) match
  const regex = new RegExp(`${regexStr}$`, "s");
  if (greedy) {
    // %% - longest match: use regex directly (finds leftmost match)
    return value.replace(regex, "");
  }
  // % - shortest match: find rightmost position where pattern matches to end
  for (let i = value.length; i >= 0; i--) {
    const suffix = value.slice(i);
    if (regex.test(suffix)) {
      return value.slice(0, i);
    }
  }
  return value;
}

/**
 * Get variable names that match a given prefix.
 * Used for ${!prefix*} and ${!prefix@} expansions.
 * Handles arrays properly - includes array base names from __length markers,
 * excludes internal storage keys like arr_0, arr__length.
 */
function getVarNamesWithPrefix(
  ctx: InterpreterContext,
  prefix: string,
): string[] {
  const envKeys = Object.keys(ctx.state.env);
  const matchingVars = new Set<string>();

  // Get sets of array names for filtering
  const assocArrays = ctx.state.associativeArrays ?? new Set<string>();
  const indexedArrays = new Set<string>();
  // Find indexed arrays by looking for _\d+$ patterns
  for (const k of envKeys) {
    const match = k.match(/^([a-zA-Z_][a-zA-Z0-9_]*)_\d+$/);
    if (match) {
      indexedArrays.add(match[1]);
    }
    const lengthMatch = k.match(/^([a-zA-Z_][a-zA-Z0-9_]*)__length$/);
    if (lengthMatch) {
      indexedArrays.add(lengthMatch[1]);
    }
  }

  // Helper to check if a key is an associative array element
  const isAssocArrayElement = (key: string): boolean => {
    for (const arrayName of assocArrays) {
      const elemPrefix = `${arrayName}_`;
      if (key.startsWith(elemPrefix) && key !== arrayName) {
        return true;
      }
    }
    return false;
  };

  for (const k of envKeys) {
    if (k.startsWith(prefix)) {
      // Check if this is an internal array storage key
      if (k.includes("__")) {
        // For __length markers, add the base array name
        const lengthMatch = k.match(/^([a-zA-Z_][a-zA-Z0-9_]*)__length$/);
        if (lengthMatch?.[1].startsWith(prefix)) {
          matchingVars.add(lengthMatch[1]);
        }
        // Skip other internal markers
      } else if (/_\d+$/.test(k)) {
        // Skip indexed array element storage (arr_0)
        // But add the base array name if it matches
        const match = k.match(/^([a-zA-Z_][a-zA-Z0-9_]*)_\d+$/);
        if (match?.[1].startsWith(prefix)) {
          matchingVars.add(match[1]);
        }
      } else if (isAssocArrayElement(k)) {
      } else {
        // Regular variable
        matchingVars.add(k);
      }
    }
  }

  return [...matchingVars].sort();
}

/**
 * Check if a string contains glob patterns, including extglob when enabled.
 */
function hasGlobPattern(value: string, extglob: boolean): boolean {
  // Standard glob characters
  if (/[*?[]/.test(value)) {
    return true;
  }
  // Extglob patterns: @(...), *(...), +(...), ?(...), !(...)
  if (extglob && /[@*+?!]\(/.test(value)) {
    return true;
  }
  return false;
}

/**
 * Apply tilde expansion to a string.
 * Used after brace expansion to handle cases like ~{/src,root} -> ~/src ~root -> /home/user/src /root
 * Only expands ~ at the start of the string followed by / or end of string.
 */
function applyTildeExpansion(ctx: InterpreterContext, value: string): string {
  if (!value.startsWith("~")) {
    return value;
  }

  // Use HOME if set (even if empty), otherwise fall back to /home/user
  const home =
    ctx.state.env.HOME !== undefined ? ctx.state.env.HOME : "/home/user";

  // ~/ or just ~
  if (value === "~" || value.startsWith("~/")) {
    return home + value.slice(1);
  }

  // ~username case: find where the username ends
  // Username chars are alphanumeric, underscore, and hyphen
  let i = 1;
  while (i < value.length && /[a-zA-Z0-9_-]/.test(value[i])) {
    i++;
  }
  const username = value.slice(1, i);
  const rest = value.slice(i);

  // Only expand if followed by / or end of string
  if (rest !== "" && !rest.startsWith("/")) {
    return value;
  }

  // Only support ~root expansion in sandboxed environment
  if (username === "root") {
    return `/root${rest}`;
  }

  // Unknown user - keep literal
  return value;
}

/**
 * Unescape backslashes in a glob pattern when glob expansion fails.
 * In bash, when a glob pattern like [\\]_ doesn't match any files,
 * the output is [\]_ (with processed escapes), not [\\]_ (raw pattern).
 */
function unescapeGlobPattern(pattern: string): string {
  let result = "";
  let i = 0;
  while (i < pattern.length) {
    if (pattern[i] === "\\" && i + 1 < pattern.length) {
      // Backslash escapes the next character - output just the escaped char
      result += pattern[i + 1];
      i += 2;
    } else {
      result += pattern[i];
      i++;
    }
  }
  return result;
}

/**
 * Quote a value for safe reuse as shell input (${var@Q} transformation)
 * Uses single quotes with proper escaping for special characters.
 * Follows bash's quoting behavior:
 * - Simple strings without quotes: 'value'
 * - Strings with single quotes or control characters: $'value' with \' escaping
 */
function quoteValue(value: string): string {
  // Empty string becomes ''
  if (value === "") return "''";

  // Check if we need $'...' format - for control characters OR single quotes
  const needsDollarQuote = /[\n\r\t\x00-\x1f\x7f']/.test(value);

  if (needsDollarQuote) {
    // Use $'...' format for strings with control characters or single quotes
    let result = "$'";
    for (const char of value) {
      switch (char) {
        case "'":
          result += "\\'";
          break;
        case "\\":
          result += "\\\\";
          break;
        case "\n":
          result += "\\n";
          break;
        case "\r":
          result += "\\r";
          break;
        case "\t":
          result += "\\t";
          break;
        default: {
          // Check for control characters
          const code = char.charCodeAt(0);
          if (code < 32 || code === 127) {
            // Use octal escapes like bash does (not hex)
            result += `\\${code.toString(8).padStart(3, "0")}`;
          } else {
            result += char;
          }
        }
      }
    }
    return `${result}'`;
  }

  // For simple strings without control characters or single quotes, use single quotes
  return `'${value}'`;
}

/**
 * Expand prompt escape sequences (${var@P} transformation)
 * Interprets backslash escapes used in PS1, PS2, PS3, PS4 prompt strings.
 *
 * Supported escapes:
 * - \a - bell (ASCII 07)
 * - \e - escape (ASCII 033)
 * - \n - newline
 * - \r - carriage return
 * - \\ - literal backslash
 * - \$ - $ for regular user, # for root (always $ here)
 * - \[ and \] - non-printing sequence delimiters (removed)
 * - \u - username
 * - \h - short hostname (up to first .)
 * - \H - full hostname
 * - \w - current working directory
 * - \W - basename of current working directory
 * - \d - date (Weekday Month Day format)
 * - \t - time HH:MM:SS (24-hour)
 * - \T - time HH:MM:SS (12-hour)
 * - \@ - time HH:MM AM/PM (12-hour)
 * - \A - time HH:MM (24-hour)
 * - \D{format} - strftime format
 * - \s - shell name
 * - \v - bash version (major.minor)
 * - \V - bash version (major.minor.patch)
 * - \j - number of jobs
 * - \l - terminal device basename
 * - \# - command number
 * - \! - history number
 * - \NNN - octal character code
 */
function expandPrompt(ctx: InterpreterContext, value: string): string {
  let result = "";
  let i = 0;

  // Get environment values for prompt escapes
  const user = ctx.state.env.USER || ctx.state.env.LOGNAME || "user";
  const hostname = ctx.state.env.HOSTNAME || "localhost";
  const shortHost = hostname.split(".")[0];
  const pwd = ctx.state.env.PWD || "/";
  const home = ctx.state.env.HOME || "/";

  // Replace $HOME with ~ in pwd for \w
  const tildeExpanded = pwd.startsWith(home)
    ? `~${pwd.slice(home.length)}`
    : pwd;
  const pwdBasename = pwd.split("/").pop() || pwd;

  // Get date/time values
  const now = new Date();
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];

  // Command number (we'll use a simple counter from the state if available)
  const cmdNum = ctx.state.env.__COMMAND_NUMBER || "1";

  while (i < value.length) {
    const char = value[i];

    if (char === "\\") {
      if (i + 1 >= value.length) {
        // Trailing backslash
        result += "\\";
        i++;
        continue;
      }

      const next = value[i + 1];

      // Check for octal escape \NNN (1-3 digits)
      if (next >= "0" && next <= "7") {
        let octalStr = "";
        let j = i + 1;
        while (
          j < value.length &&
          j < i + 4 &&
          value[j] >= "0" &&
          value[j] <= "7"
        ) {
          octalStr += value[j];
          j++;
        }
        // Parse octal, wrap around at 256 (e.g., \555 = 365 octal = 245 decimal, wraps to 109 = 'm')
        const code = Number.parseInt(octalStr, 8) % 256;
        result += String.fromCharCode(code);
        i = j;
        continue;
      }

      switch (next) {
        case "\\":
          result += "\\";
          i += 2;
          break;
        case "a":
          result += "\x07"; // Bell
          i += 2;
          break;
        case "e":
          result += "\x1b"; // Escape
          i += 2;
          break;
        case "n":
          result += "\n";
          i += 2;
          break;
        case "r":
          result += "\r";
          i += 2;
          break;
        case "$":
          // $ for regular user, # for root - we always use $ since we're not running as root
          result += "$";
          i += 2;
          break;
        case "[":
        case "]":
          // Non-printing sequence delimiters - just remove them
          i += 2;
          break;
        case "u":
          result += user;
          i += 2;
          break;
        case "h":
          result += shortHost;
          i += 2;
          break;
        case "H":
          result += hostname;
          i += 2;
          break;
        case "w":
          result += tildeExpanded;
          i += 2;
          break;
        case "W":
          result += pwdBasename;
          i += 2;
          break;
        case "d": {
          // Date: Weekday Month Day
          const dayStr = String(now.getDate()).padStart(2, " ");
          result += `${weekdays[now.getDay()]} ${months[now.getMonth()]} ${dayStr}`;
          i += 2;
          break;
        }
        case "t": {
          // Time: HH:MM:SS (24-hour)
          const h = String(now.getHours()).padStart(2, "0");
          const m = String(now.getMinutes()).padStart(2, "0");
          const s = String(now.getSeconds()).padStart(2, "0");
          result += `${h}:${m}:${s}`;
          i += 2;
          break;
        }
        case "T": {
          // Time: HH:MM:SS (12-hour)
          let h = now.getHours() % 12;
          if (h === 0) h = 12;
          const hStr = String(h).padStart(2, "0");
          const m = String(now.getMinutes()).padStart(2, "0");
          const s = String(now.getSeconds()).padStart(2, "0");
          result += `${hStr}:${m}:${s}`;
          i += 2;
          break;
        }
        case "@": {
          // Time: HH:MM AM/PM (12-hour)
          let h = now.getHours() % 12;
          if (h === 0) h = 12;
          const hStr = String(h).padStart(2, "0");
          const m = String(now.getMinutes()).padStart(2, "0");
          const ampm = now.getHours() < 12 ? "AM" : "PM";
          result += `${hStr}:${m} ${ampm}`;
          i += 2;
          break;
        }
        case "A": {
          // Time: HH:MM (24-hour)
          const h = String(now.getHours()).padStart(2, "0");
          const m = String(now.getMinutes()).padStart(2, "0");
          result += `${h}:${m}`;
          i += 2;
          break;
        }
        case "D":
          // strftime format: \D{format}
          if (i + 2 < value.length && value[i + 2] === "{") {
            const closeIdx = value.indexOf("}", i + 3);
            if (closeIdx !== -1) {
              const format = value.slice(i + 3, closeIdx);
              // Simple strftime implementation for common formats
              result += simpleStrftime(format, now);
              i = closeIdx + 1;
            } else {
              // No closing brace - treat literally
              result += "\\D";
              i += 2;
            }
          } else {
            result += "\\D";
            i += 2;
          }
          break;
        case "s":
          // Shell name
          result += "bash";
          i += 2;
          break;
        case "v":
          // Version: major.minor
          result += "5.0"; // Pretend to be bash 5.0
          i += 2;
          break;
        case "V":
          // Version: major.minor.patch
          result += "5.0.0"; // Pretend to be bash 5.0.0
          i += 2;
          break;
        case "j":
          // Number of jobs - we don't track jobs, so return 0
          result += "0";
          i += 2;
          break;
        case "l":
          // Terminal device basename - we're not in a real terminal
          result += "tty";
          i += 2;
          break;
        case "#":
          // Command number
          result += cmdNum;
          i += 2;
          break;
        case "!":
          // History number - same as command number
          result += cmdNum;
          i += 2;
          break;
        case "x":
          // \xNN hex literals are NOT supported in bash prompt expansion
          // Just pass through as literal
          result += "\\x";
          i += 2;
          break;
        default:
          // Unknown escape - pass through as literal
          result += `\\${next}`;
          i += 2;
      }
    } else {
      result += char;
      i++;
    }
  }

  return result;
}

/**
 * Simple strftime implementation for prompt \D{format}
 * Only supports common format specifiers
 */
function simpleStrftime(format: string, date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");

  // If format is empty, use locale default time format (like %X)
  if (format === "") {
    const h = pad(date.getHours());
    const m = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    return `${h}:${m}:${s}`;
  }

  let result = "";
  let i = 0;
  while (i < format.length) {
    if (format[i] === "%") {
      if (i + 1 >= format.length) {
        result += "%";
        i++;
        continue;
      }
      const spec = format[i + 1];
      switch (spec) {
        case "H":
          result += pad(date.getHours());
          break;
        case "M":
          result += pad(date.getMinutes());
          break;
        case "S":
          result += pad(date.getSeconds());
          break;
        case "d":
          result += pad(date.getDate());
          break;
        case "m":
          result += pad(date.getMonth() + 1);
          break;
        case "Y":
          result += date.getFullYear();
          break;
        case "y":
          result += pad(date.getFullYear() % 100);
          break;
        case "I": {
          let h = date.getHours() % 12;
          if (h === 0) h = 12;
          result += pad(h);
          break;
        }
        case "p":
          result += date.getHours() < 12 ? "AM" : "PM";
          break;
        case "P":
          result += date.getHours() < 12 ? "am" : "pm";
          break;
        case "%":
          result += "%";
          break;
        case "a": {
          const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
          result += days[date.getDay()];
          break;
        }
        case "b": {
          const months = [
            "Jan",
            "Feb",
            "Mar",
            "Apr",
            "May",
            "Jun",
            "Jul",
            "Aug",
            "Sep",
            "Oct",
            "Nov",
            "Dec",
          ];
          result += months[date.getMonth()];
          break;
        }
        default:
          // Unknown specifier - pass through
          result += `%${spec}`;
      }
      i += 2;
    } else {
      result += format[i];
      i++;
    }
  }
  return result;
}

/**
 * Get the attributes of a variable for ${var@a} transformation.
 * Returns a string with attribute flags (e.g., "ar" for readonly array).
 *
 * Attribute flags (in order):
 * - a: indexed array
 * - A: associative array
 * - i: integer
 * - n: nameref
 * - r: readonly
 * - x: exported
 */
function getVariableAttributes(ctx: InterpreterContext, name: string): string {
  // Handle special variables (like ?, $, etc.) - they have no attributes
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return "";
  }

  let attrs = "";

  // Check for indexed array (has numeric elements via name_0, name_1, etc. or __length marker)
  const isIndexedArray =
    ctx.state.env[`${name}__length`] !== undefined ||
    Object.keys(ctx.state.env).some(
      (k) =>
        k.startsWith(`${name}_`) && /^[0-9]+$/.test(k.slice(name.length + 1)),
    );

  // Check for associative array
  const isAssocArray = ctx.state.associativeArrays?.has(name) ?? false;

  // Add array attributes (indexed before associative)
  if (isIndexedArray && !isAssocArray) {
    attrs += "a";
  }
  if (isAssocArray) {
    attrs += "A";
  }

  // Check for integer attribute
  if (ctx.state.integerVars?.has(name)) {
    attrs += "i";
  }

  // Check for nameref attribute
  if (isNameref(ctx, name)) {
    attrs += "n";
  }

  // Check for readonly attribute
  if (isReadonly(ctx, name)) {
    attrs += "r";
  }

  // Check for exported attribute
  if (ctx.state.exportedVars?.has(name)) {
    attrs += "x";
  }

  return attrs;
}

// Helper to extract numeric value from an arithmetic expression
function _getArithValue(expr: ArithExpr): number {
  if (expr.type === "ArithNumber") {
    return expr.value;
  }
  return 0;
}

// Helper to extract literal value from a word part
function getPartValue(part: WordPart): string {
  return getLiteralValue(part) ?? "";
}

// Helper to get string value from word parts (literals only, no expansion)
function _getWordPartsValue(parts: WordPart[]): string {
  return parts.map(getPartValue).join("");
}

// Helper to fully expand word parts (including variables, arithmetic, etc.)
// inDoubleQuotes flag suppresses tilde expansion
function expandWordPartsSync(
  ctx: InterpreterContext,
  parts: WordPart[],
  inDoubleQuotes = false,
): string {
  return parts
    .map((part) => expandPartSync(ctx, part, inDoubleQuotes))
    .join("");
}

// Async version of expandWordPartsSync for parts that contain command substitution
async function expandWordPartsAsync(
  ctx: InterpreterContext,
  parts: WordPart[],
  _inDoubleQuotes = false,
): Promise<string> {
  const results: string[] = [];
  for (const part of parts) {
    results.push(await expandPart(ctx, part));
  }
  return results.join("");
}

/**
 * Check if a word is "fully quoted" - meaning glob characters should be treated literally.
 * A word is fully quoted if all its parts are either:
 * - SingleQuoted
 * - DoubleQuoted (entirely quoted variable expansion like "$pat")
 * - Escaped characters
 */
function isPartFullyQuoted(part: WordPart): boolean {
  return isQuotedPart(part);
}

/**
 * Check if an entire word is fully quoted
 */
export function isWordFullyQuoted(word: WordNode): boolean {
  // Empty word is considered quoted (matches empty pattern literally)
  if (word.parts.length === 0) return true;

  // Check if we have any unquoted parts with actual content
  for (const part of word.parts) {
    if (!isPartFullyQuoted(part)) {
      return false;
    }
  }
  return true;
}

/**
 * Escape glob metacharacters in a string for literal matching.
 * Includes extglob metacharacters: ( ) |
 */
export function escapeGlobChars(str: string): string {
  return str.replace(/([*?[\]\\()|])/g, "\\$1");
}

/**
 * Escape regex metacharacters in a string for literal matching.
 * Used when quoted patterns are used with =~ operator.
 */
export function escapeRegexChars(str: string): string {
  return str.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/**
 * Expand variables within a glob/extglob pattern string.
 * This handles patterns like @($var|$other) where variables need expansion.
 * Also handles quoted strings inside patterns (e.g., @(foo|'bar'|"$baz")).
 * Preserves pattern metacharacters while expanding $var and ${var} references.
 */
function expandVariablesInPattern(
  ctx: InterpreterContext,
  pattern: string,
): string {
  let result = "";
  let i = 0;

  while (i < pattern.length) {
    const c = pattern[i];

    // Handle single-quoted strings - content is literal, strip quotes, escape glob chars
    if (c === "'") {
      const closeIdx = pattern.indexOf("'", i + 1);
      if (closeIdx !== -1) {
        const content = pattern.slice(i + 1, closeIdx);
        // Escape glob metacharacters so they match literally
        result += escapeGlobChars(content);
        i = closeIdx + 1;
        continue;
      }
    }

    // Handle double-quoted strings - expand variables inside, strip quotes, escape glob chars
    if (c === '"') {
      // Find matching close quote, handling escapes
      let closeIdx = -1;
      let j = i + 1;
      while (j < pattern.length) {
        if (pattern[j] === "\\") {
          j += 2; // Skip escaped char
          continue;
        }
        if (pattern[j] === '"') {
          closeIdx = j;
          break;
        }
        j++;
      }
      if (closeIdx !== -1) {
        const content = pattern.slice(i + 1, closeIdx);
        // Recursively expand variables in the double-quoted content
        // but without the quote handling (pass through all other chars)
        const expanded = expandVariablesInDoubleQuotedPattern(ctx, content);
        // Escape glob metacharacters so they match literally
        result += escapeGlobChars(expanded);
        i = closeIdx + 1;
        continue;
      }
    }

    // Handle variable references: $var or ${var}
    if (c === "$") {
      if (i + 1 < pattern.length) {
        const next = pattern[i + 1];
        if (next === "{") {
          // ${var} form - find matching }
          const closeIdx = pattern.indexOf("}", i + 2);
          if (closeIdx !== -1) {
            const varName = pattern.slice(i + 2, closeIdx);
            // Simple variable expansion (no complex operations)
            result += ctx.state.env[varName] ?? "";
            i = closeIdx + 1;
            continue;
          }
        } else if (/[a-zA-Z_]/.test(next)) {
          // $var form - read variable name
          let end = i + 1;
          while (end < pattern.length && /[a-zA-Z0-9_]/.test(pattern[end])) {
            end++;
          }
          const varName = pattern.slice(i + 1, end);
          result += ctx.state.env[varName] ?? "";
          i = end;
          continue;
        }
      }
    }

    // Handle backslash escapes - preserve them
    if (c === "\\" && i + 1 < pattern.length) {
      result += c + pattern[i + 1];
      i += 2;
      continue;
    }

    // All other characters pass through unchanged
    result += c;
    i++;
  }

  return result;
}

/**
 * Expand variables within a double-quoted string inside a pattern.
 * Handles $var and ${var} but not nested quotes.
 */
function expandVariablesInDoubleQuotedPattern(
  ctx: InterpreterContext,
  content: string,
): string {
  let result = "";
  let i = 0;

  while (i < content.length) {
    const c = content[i];

    // Handle backslash escapes
    if (c === "\\" && i + 1 < content.length) {
      const next = content[i + 1];
      // In double quotes, only $, `, \, ", and newline are special after \
      if (next === "$" || next === "`" || next === "\\" || next === '"') {
        result += next;
        i += 2;
        continue;
      }
      // Other escapes pass through as-is
      result += c;
      i++;
      continue;
    }

    // Handle variable references: $var or ${var}
    if (c === "$") {
      if (i + 1 < content.length) {
        const next = content[i + 1];
        if (next === "{") {
          // ${var} form - find matching }
          const closeIdx = content.indexOf("}", i + 2);
          if (closeIdx !== -1) {
            const varName = content.slice(i + 2, closeIdx);
            result += ctx.state.env[varName] ?? "";
            i = closeIdx + 1;
            continue;
          }
        } else if (/[a-zA-Z_]/.test(next)) {
          // $var form - read variable name
          let end = i + 1;
          while (end < content.length && /[a-zA-Z0-9_]/.test(content[end])) {
            end++;
          }
          const varName = content.slice(i + 1, end);
          result += ctx.state.env[varName] ?? "";
          i = end;
          continue;
        }
      }
    }

    // All other characters pass through unchanged
    result += c;
    i++;
  }

  return result;
}

/**
 * Check if a pattern string contains command substitution $(...)
 */
function patternHasCommandSubstitution(pattern: string): boolean {
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    // Skip escaped characters
    if (c === "\\" && i + 1 < pattern.length) {
      i += 2;
      continue;
    }
    // Skip single-quoted strings
    if (c === "'") {
      const closeIdx = pattern.indexOf("'", i + 1);
      if (closeIdx !== -1) {
        i = closeIdx + 1;
        continue;
      }
    }
    // Check for $( which indicates command substitution
    if (c === "$" && i + 1 < pattern.length && pattern[i + 1] === "(") {
      return true;
    }
    // Check for backtick command substitution
    if (c === "`") {
      return true;
    }
    i++;
  }
  return false;
}

/**
 * Find the matching closing parenthesis for a command substitution.
 * Handles nested parentheses, quotes, and escapes.
 * Returns the index of the closing ), or -1 if not found.
 */
function findCommandSubstitutionEnd(pattern: string, startIdx: number): number {
  let depth = 1;
  let i = startIdx;
  let inSingleQuote = false;
  let inDoubleQuote = false;

  while (i < pattern.length && depth > 0) {
    const c = pattern[i];

    // Handle escapes (only outside single quotes)
    if (c === "\\" && !inSingleQuote && i + 1 < pattern.length) {
      i += 2;
      continue;
    }

    // Handle single quotes (only outside double quotes)
    if (c === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      i++;
      continue;
    }

    // Handle double quotes (only outside single quotes)
    if (c === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      i++;
      continue;
    }

    // Handle parentheses (only outside quotes)
    if (!inSingleQuote && !inDoubleQuote) {
      if (c === "(") {
        depth++;
      } else if (c === ")") {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }

    i++;
  }

  return -1;
}

/**
 * Async version of expandVariablesInPattern that handles command substitutions.
 * This handles patterns like @($var|$(echo foo)) where command substitutions need expansion.
 */
async function expandVariablesInPatternAsync(
  ctx: InterpreterContext,
  pattern: string,
): Promise<string> {
  let result = "";
  let i = 0;

  while (i < pattern.length) {
    const c = pattern[i];

    // Handle single-quoted strings - content is literal, strip quotes, escape glob chars
    if (c === "'") {
      const closeIdx = pattern.indexOf("'", i + 1);
      if (closeIdx !== -1) {
        const content = pattern.slice(i + 1, closeIdx);
        // Escape glob metacharacters so they match literally
        result += escapeGlobChars(content);
        i = closeIdx + 1;
        continue;
      }
    }

    // Handle double-quoted strings - expand variables inside, strip quotes, escape glob chars
    if (c === '"') {
      // Find matching close quote, handling escapes
      let closeIdx = -1;
      let j = i + 1;
      while (j < pattern.length) {
        if (pattern[j] === "\\") {
          j += 2; // Skip escaped char
          continue;
        }
        if (pattern[j] === '"') {
          closeIdx = j;
          break;
        }
        j++;
      }
      if (closeIdx !== -1) {
        const content = pattern.slice(i + 1, closeIdx);
        // Recursively expand (including command substitutions) in the double-quoted content
        const expanded = await expandVariablesInDoubleQuotedPatternAsync(
          ctx,
          content,
        );
        // Escape glob metacharacters so they match literally
        result += escapeGlobChars(expanded);
        i = closeIdx + 1;
        continue;
      }
    }

    // Handle command substitution: $(...)
    if (c === "$" && i + 1 < pattern.length && pattern[i + 1] === "(") {
      const closeIdx = findCommandSubstitutionEnd(pattern, i + 2);
      if (closeIdx !== -1) {
        const commandStr = pattern.slice(i + 2, closeIdx);
        // Execute the command substitution
        const output = await executeCommandSubstitutionFromString(
          ctx,
          commandStr,
        );
        result += output;
        i = closeIdx + 1;
        continue;
      }
    }

    // Handle backtick command substitution: `...`
    if (c === "`") {
      const closeIdx = pattern.indexOf("`", i + 1);
      if (closeIdx !== -1) {
        const commandStr = pattern.slice(i + 1, closeIdx);
        // Execute the command substitution
        const output = await executeCommandSubstitutionFromString(
          ctx,
          commandStr,
        );
        result += output;
        i = closeIdx + 1;
        continue;
      }
    }

    // Handle variable references: $var or ${var}
    if (c === "$") {
      if (i + 1 < pattern.length) {
        const next = pattern[i + 1];
        if (next === "{") {
          // ${var} form - find matching }
          const closeIdx = pattern.indexOf("}", i + 2);
          if (closeIdx !== -1) {
            const varName = pattern.slice(i + 2, closeIdx);
            // Simple variable expansion (no complex operations)
            result += ctx.state.env[varName] ?? "";
            i = closeIdx + 1;
            continue;
          }
        } else if (/[a-zA-Z_]/.test(next)) {
          // $var form - read variable name
          let end = i + 1;
          while (end < pattern.length && /[a-zA-Z0-9_]/.test(pattern[end])) {
            end++;
          }
          const varName = pattern.slice(i + 1, end);
          result += ctx.state.env[varName] ?? "";
          i = end;
          continue;
        }
      }
    }

    // Handle backslash escapes - preserve them
    if (c === "\\" && i + 1 < pattern.length) {
      result += c + pattern[i + 1];
      i += 2;
      continue;
    }

    // All other characters pass through unchanged
    result += c;
    i++;
  }

  return result;
}

/**
 * Async version of expandVariablesInDoubleQuotedPattern that handles command substitutions.
 */
async function expandVariablesInDoubleQuotedPatternAsync(
  ctx: InterpreterContext,
  content: string,
): Promise<string> {
  let result = "";
  let i = 0;

  while (i < content.length) {
    const c = content[i];

    // Handle backslash escapes
    if (c === "\\" && i + 1 < content.length) {
      const next = content[i + 1];
      // In double quotes, only $, `, \, ", and newline are special after \
      if (next === "$" || next === "`" || next === "\\" || next === '"') {
        result += next;
        i += 2;
        continue;
      }
      // Other escapes pass through as-is
      result += c;
      i++;
      continue;
    }

    // Handle command substitution: $(...)
    if (c === "$" && i + 1 < content.length && content[i + 1] === "(") {
      const closeIdx = findCommandSubstitutionEnd(content, i + 2);
      if (closeIdx !== -1) {
        const commandStr = content.slice(i + 2, closeIdx);
        const output = await executeCommandSubstitutionFromString(
          ctx,
          commandStr,
        );
        result += output;
        i = closeIdx + 1;
        continue;
      }
    }

    // Handle backtick command substitution: `...`
    if (c === "`") {
      const closeIdx = content.indexOf("`", i + 1);
      if (closeIdx !== -1) {
        const commandStr = content.slice(i + 1, closeIdx);
        const output = await executeCommandSubstitutionFromString(
          ctx,
          commandStr,
        );
        result += output;
        i = closeIdx + 1;
        continue;
      }
    }

    // Handle variable references: $var or ${var}
    if (c === "$") {
      if (i + 1 < content.length) {
        const next = content[i + 1];
        if (next === "{") {
          // ${var} form - find matching }
          const closeIdx = content.indexOf("}", i + 2);
          if (closeIdx !== -1) {
            const varName = content.slice(i + 2, closeIdx);
            result += ctx.state.env[varName] ?? "";
            i = closeIdx + 1;
            continue;
          }
        } else if (/[a-zA-Z_]/.test(next)) {
          // $var form - read variable name
          let end = i + 1;
          while (end < content.length && /[a-zA-Z0-9_]/.test(content[end])) {
            end++;
          }
          const varName = content.slice(i + 1, end);
          result += ctx.state.env[varName] ?? "";
          i = end;
          continue;
        }
      }
    }

    // All other characters pass through unchanged
    result += c;
    i++;
  }

  return result;
}

/**
 * Execute a command substitution from a raw command string.
 * Parses and executes the command, returning stdout with trailing newlines stripped.
 */
async function executeCommandSubstitutionFromString(
  ctx: InterpreterContext,
  commandStr: string,
): Promise<string> {
  // Parse the command
  const parser = new Parser();
  let ast: ScriptNode;
  try {
    ast = parser.parse(commandStr);
  } catch {
    // Parse error - return empty string
    return "";
  }

  // Execute in subshell-like context
  const savedBashPid = ctx.state.bashPid;
  ctx.state.bashPid = ctx.state.nextVirtualPid++;
  const savedEnv = { ...ctx.state.env };
  const savedCwd = ctx.state.cwd;
  const savedSuppressVerbose = ctx.state.suppressVerbose;
  ctx.state.suppressVerbose = true;

  try {
    const result = await ctx.executeScript(ast);
    // Restore environment but preserve exit code
    const exitCode = result.exitCode;
    ctx.state.env = savedEnv;
    ctx.state.cwd = savedCwd;
    ctx.state.suppressVerbose = savedSuppressVerbose;
    ctx.state.lastExitCode = exitCode;
    ctx.state.env["?"] = String(exitCode);
    if (result.stderr) {
      ctx.state.expansionStderr =
        (ctx.state.expansionStderr || "") + result.stderr;
    }
    ctx.state.bashPid = savedBashPid;
    return result.stdout.replace(/\n+$/, "");
  } catch (error) {
    ctx.state.env = savedEnv;
    ctx.state.cwd = savedCwd;
    ctx.state.bashPid = savedBashPid;
    ctx.state.suppressVerbose = savedSuppressVerbose;
    if (error instanceof ExecutionLimitError) {
      throw error;
    }
    if (error instanceof ExitError) {
      ctx.state.lastExitCode = error.exitCode;
      ctx.state.env["?"] = String(error.exitCode);
      return error.stdout?.replace(/\n+$/, "") ?? "";
    }
    return "";
  }
}

/**
 * Handle simple part types that don't require recursion or async.
 * Returns the expanded string, or null if the part type needs special handling.
 * inDoubleQuotes flag suppresses tilde expansion (tilde is literal inside "...")
 */
function expandSimplePart(
  ctx: InterpreterContext,
  part: WordPart,
  inDoubleQuotes = false,
): string | null {
  // Handle literal parts (Literal, SingleQuoted, Escaped)
  const literal = getLiteralValue(part);
  if (literal !== null) return literal;

  switch (part.type) {
    case "ParameterExpansion":
      return expandParameter(ctx, part, inDoubleQuotes);
    case "TildeExpansion":
      // Tilde expansion doesn't happen inside double quotes
      if (inDoubleQuotes) {
        return part.user === null ? "~" : `~${part.user}`;
      }
      if (part.user === null) {
        // Use HOME if set (even if empty), otherwise fall back to /home/user
        return ctx.state.env.HOME !== undefined
          ? ctx.state.env.HOME
          : "/home/user";
      }
      // ~username only expands if user exists
      // In sandboxed environment, we can only verify 'root' exists universally
      // Other unknown users stay literal (matches bash behavior)
      if (part.user === "root") {
        return "/root";
      }
      return `~${part.user}`;
    case "Glob":
      // Expand variables within extglob patterns (e.g., @($var|$other))
      return expandVariablesInPattern(ctx, part.pattern);
    default:
      return null; // Needs special handling (DoubleQuoted, BraceExpansion, ArithmeticExpansion, CommandSubstitution)
  }
}

// Sync version of expandPart for parts that don't need async
// inDoubleQuotes flag suppresses tilde expansion
function expandPartSync(
  ctx: InterpreterContext,
  part: WordPart,
  inDoubleQuotes = false,
): string {
  // Try simple cases first
  const simple = expandSimplePart(ctx, part, inDoubleQuotes);
  if (simple !== null) return simple;

  // Handle cases that need recursion
  switch (part.type) {
    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        // Inside double quotes, suppress tilde expansion
        parts.push(expandPartSync(ctx, p, true));
      }
      return parts.join("");
    }

    case "ArithmeticExpansion": {
      // If original text is available and contains $var patterns (not ${...}),
      // we need to do text substitution before parsing to maintain operator precedence.
      // E.g., $(( $x * 3 )) where x='1 + 2' should expand to $(( 1 + 2 * 3 )) = 7
      // not $(( (1+2) * 3 )) = 9
      const originalText = part.expression.originalText;
      const hasDollarVars =
        originalText && /\$[a-zA-Z_][a-zA-Z0-9_]*(?![{[(])/.test(originalText);
      if (hasDollarVars) {
        // Expand $var patterns in the text
        const expandedText = expandDollarVarsInArithText(ctx, originalText);
        // Re-parse the expanded expression
        const parser = new Parser();
        const newExpr = parseArithmeticExpression(parser, expandedText);
        // true = expansion context, single quotes cause error
        return String(evaluateArithmeticSync(ctx, newExpr.expression, true));
      }
      // true = expansion context, single quotes cause error
      return String(
        evaluateArithmeticSync(ctx, part.expression.expression, true),
      );
    }

    case "BraceExpansion": {
      const results: string[] = [];
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            results.push(...range.expanded);
          } else {
            return range.literal;
          }
        } else {
          results.push(expandWordSync(ctx, item.word));
        }
      }
      return results.join(" ");
    }

    default:
      return "";
  }
}

// Sync version of expandWord for words that don't need async
function expandWordSync(ctx: InterpreterContext, word: WordNode): string {
  const wordParts = word.parts;
  const len = wordParts.length;

  if (len === 1) {
    return expandPartSync(ctx, wordParts[0]);
  }

  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    parts.push(expandPartSync(ctx, wordParts[i]));
  }
  return parts.join("");
}

export async function expandWord(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  // Fast path: if no async parts, use sync version
  if (!wordNeedsAsync(word)) {
    return expandWordSync(ctx, word);
  }
  return expandWordAsync(ctx, word);
}

/**
 * Expand a word for use as a regex pattern (in [[ =~ ]]).
 * Preserves backslash escapes so they're passed to the regex engine.
 * For example, \[\] becomes \[\] in the regex (matching literal [ and ]).
 */
export async function expandWordForRegex(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const parts: string[] = [];
  for (const part of word.parts) {
    if (part.type === "Escaped") {
      // For regex patterns, preserve ALL backslash escapes
      // This allows \[ \] \. \* etc. to work as regex escapes
      parts.push(`\\${part.value}`);
    } else if (part.type === "SingleQuoted") {
      // Single-quoted content is literal in regex
      parts.push(part.value);
    } else if (part.type === "DoubleQuoted") {
      // Double-quoted: expand contents
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      parts.push(expanded);
    } else if (part.type === "TildeExpansion") {
      // Tilde expansion on RHS of =~ is treated as literal (regex chars escaped)
      // This matches bash 4.x+ behavior where ~ expands but the result is
      // matched literally, not as a regex pattern.
      // e.g., HOME='^a$'; [[ $HOME =~ ~ ]] matches because ~ expands to '^a$'
      // and then '^a$' is escaped to '\^a\$' which matches the literal string
      const expanded = await expandPart(ctx, part);
      parts.push(escapeRegexChars(expanded));
    } else {
      // Other parts: expand normally
      parts.push(await expandPart(ctx, part));
    }
  }
  return parts.join("");
}

/**
 * Expand a word for use as a pattern (e.g., in [[ == ]] or case).
 * Preserves backslash escapes for pattern metacharacters so they're treated literally.
 * This prevents `*\(\)` from being interpreted as an extglob pattern.
 */
export async function expandWordForPattern(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const parts: string[] = [];
  for (const part of word.parts) {
    if (part.type === "Escaped") {
      // For escaped characters that are pattern metacharacters, preserve the backslash
      // This includes: ( ) | * ? [ ] for glob/extglob patterns
      const ch = part.value;
      if ("()|*?[]".includes(ch)) {
        parts.push(`\\${ch}`);
      } else {
        parts.push(ch);
      }
    } else if (part.type === "SingleQuoted") {
      // Single-quoted content should be escaped for literal matching
      parts.push(escapeGlobChars(part.value));
    } else if (part.type === "DoubleQuoted") {
      // Double-quoted: expand contents and escape for literal matching
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      parts.push(escapeGlobChars(expanded));
    } else {
      // Other parts: expand normally
      parts.push(await expandPart(ctx, part));
    }
  }
  return parts.join("");
}

/**
 * Expand a word for glob matching.
 * Unlike regular expansion, this escapes glob metacharacters in quoted parts
 * so they are treated as literals, while preserving glob patterns from Glob parts.
 * This enables patterns like '_tmp/[bc]'*.mm where [bc] is literal and * is a glob.
 */
async function expandWordForGlobbing(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const parts: string[] = [];
  for (const part of word.parts) {
    if (part.type === "SingleQuoted") {
      // Single-quoted content: escape glob metacharacters for literal matching
      parts.push(escapeGlobChars(part.value));
    } else if (part.type === "Escaped") {
      // Escaped character: escape if it's a glob metacharacter
      const ch = part.value;
      if ("*?[]\\()|".includes(ch)) {
        parts.push(`\\${ch}`);
      } else {
        parts.push(ch);
      }
    } else if (part.type === "DoubleQuoted") {
      // Double-quoted: expand contents and escape glob metacharacters
      const expanded = await expandWordPartsAsync(ctx, part.parts);
      parts.push(escapeGlobChars(expanded));
    } else if (part.type === "Glob") {
      // Glob pattern: expand variables and command substitutions within extglob patterns
      // e.g., @($var|$(echo foo)) needs both variable and command substitution expansion
      if (patternHasCommandSubstitution(part.pattern)) {
        // Use async version for command substitutions
        parts.push(await expandVariablesInPatternAsync(ctx, part.pattern));
      } else {
        // Use sync version for simple variable expansion
        parts.push(expandVariablesInPattern(ctx, part.pattern));
      }
    } else if (part.type === "Literal") {
      // Literal: keep as-is (may contain glob characters that should glob)
      parts.push(part.value);
    } else {
      // Other parts (ParameterExpansion, etc.): expand normally
      parts.push(await expandPart(ctx, part));
    }
  }
  return parts.join("");
}

/**
 * Check if word parts contain brace expansion
 */
function hasBraceExpansion(parts: WordPart[]): boolean {
  for (const part of parts) {
    if (part.type === "BraceExpansion") return true;
    if (part.type === "DoubleQuoted" && hasBraceExpansion(part.parts))
      return true;
  }
  return false;
}

/**
 * Check if brace expansion contains parts that need async (command substitution)
 */
function braceExpansionNeedsAsync(parts: WordPart[]): boolean {
  for (const part of parts) {
    if (part.type === "BraceExpansion") {
      for (const item of part.items) {
        if (item.type === "Word" && wordNeedsAsync(item.word)) {
          return true;
        }
      }
    }
    if (partNeedsAsync(part)) return true;
  }
  return false;
}

/**
 * Expand brace expansion in word parts, producing multiple arrays of parts.
 * Each result array represents the parts that will be joined to form one word.
 * For example, "pre{a,b}post" produces [["pre", "a", "post"], ["pre", "b", "post"]]
 *
 * Non-brace parts are kept as WordPart objects to allow deferred expansion.
 * This is necessary for bash-like behavior where side effects in expansions
 * (like $((i++))) are evaluated separately for each brace alternative.
 */
// Maximum number of brace expansion results to prevent memory explosion
const MAX_BRACE_EXPANSION_RESULTS = 10000;
// Maximum total operations across all recursive calls
const MAX_BRACE_OPERATIONS = 100000;

type BraceExpandedPart = string | WordPart;

function expandBracesInParts(
  ctx: InterpreterContext,
  parts: WordPart[],
  operationCounter: { count: number } = { count: 0 },
): BraceExpandedPart[][] {
  // Check global operation limit
  if (operationCounter.count > MAX_BRACE_OPERATIONS) {
    return [[]];
  }

  // Start with one empty result
  let results: BraceExpandedPart[][] = [[]];

  for (const part of parts) {
    if (part.type === "BraceExpansion") {
      // Get all brace expansion values
      const braceValues: string[] = [];
      let hasInvalidRange = false;
      let invalidRangeLiteral = "";
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            for (const val of range.expanded) {
              operationCounter.count++;
              braceValues.push(val);
            }
          } else {
            hasInvalidRange = true;
            invalidRangeLiteral = range.literal;
            break;
          }
        } else {
          // Word item - expand it (recursively handle nested braces)
          const expanded = expandBracesInParts(
            ctx,
            item.word.parts,
            operationCounter,
          );
          for (const exp of expanded) {
            operationCounter.count++;
            // Join all parts, expanding any deferred WordParts
            const joinedParts: string[] = [];
            for (const p of exp) {
              if (typeof p === "string") {
                joinedParts.push(p);
              } else {
                joinedParts.push(expandPartSync(ctx, p));
              }
            }
            braceValues.push(joinedParts.join(""));
          }
        }
      }

      // If we have an invalid range, treat it as a literal and append to all results
      if (hasInvalidRange) {
        for (const result of results) {
          operationCounter.count++;
          result.push(invalidRangeLiteral);
        }
        continue;
      }

      // Multiply results by brace values (cartesian product)
      // But first check if this would exceed the limit
      const newSize = results.length * braceValues.length;
      if (
        newSize > MAX_BRACE_EXPANSION_RESULTS ||
        operationCounter.count > MAX_BRACE_OPERATIONS
      ) {
        // Too many results - return what we have and stop
        return results;
      }

      const newResults: BraceExpandedPart[][] = [];
      for (const result of results) {
        for (const val of braceValues) {
          operationCounter.count++;
          if (operationCounter.count > MAX_BRACE_OPERATIONS) {
            return newResults.length > 0 ? newResults : results;
          }
          newResults.push([...result, val]);
        }
      }
      results = newResults;
    } else {
      // Non-brace part: keep as WordPart for deferred expansion
      // This allows side effects (like $((i++))) to be evaluated
      // separately for each brace alternative
      for (const result of results) {
        operationCounter.count++;
        result.push(part);
      }
    }
  }

  return results;
}

/**
 * Expand a word with brace expansion support, returning multiple values
 */
function expandWordWithBraces(
  ctx: InterpreterContext,
  word: WordNode,
): string[] {
  const parts = word.parts;

  if (!hasBraceExpansion(parts)) {
    // No brace expansion, return single value
    return [expandWordSync(ctx, word)];
  }

  // Expand braces - returns arrays of strings and deferred WordParts
  const expanded = expandBracesInParts(ctx, parts);

  // Now expand each result, evaluating deferred parts separately for each
  // This ensures side effects like $((i++)) are evaluated fresh for each brace alternative
  const results: string[] = [];
  for (const resultParts of expanded) {
    const joinedParts: string[] = [];
    for (const p of resultParts) {
      if (typeof p === "string") {
        joinedParts.push(p);
      } else {
        // Expand the deferred WordPart now
        joinedParts.push(expandPartSync(ctx, p));
      }
    }
    // Apply tilde expansion to each result - this handles cases like ~{/src,root}
    // where brace expansion produces ~/src and ~root, which then need tilde expansion
    results.push(applyTildeExpansion(ctx, joinedParts.join("")));
  }
  return results;
}

/**
 * Async version of expandBracesInParts for when brace expansion contains command substitution
 */
async function expandBracesInPartsAsync(
  ctx: InterpreterContext,
  parts: WordPart[],
  operationCounter: { count: number } = { count: 0 },
): Promise<BraceExpandedPart[][]> {
  if (operationCounter.count > MAX_BRACE_OPERATIONS) {
    return [[]];
  }

  let results: BraceExpandedPart[][] = [[]];

  for (const part of parts) {
    if (part.type === "BraceExpansion") {
      const braceValues: string[] = [];
      let hasInvalidRange = false;
      let invalidRangeLiteral = "";
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            for (const val of range.expanded) {
              operationCounter.count++;
              braceValues.push(val);
            }
          } else {
            hasInvalidRange = true;
            invalidRangeLiteral = range.literal;
            break;
          }
        } else {
          // Word item - expand it (recursively handle nested braces)
          const expanded = await expandBracesInPartsAsync(
            ctx,
            item.word.parts,
            operationCounter,
          );
          for (const exp of expanded) {
            operationCounter.count++;
            // Join all parts, expanding any deferred WordParts
            const joinedParts: string[] = [];
            for (const p of exp) {
              if (typeof p === "string") {
                joinedParts.push(p);
              } else {
                joinedParts.push(await expandPart(ctx, p));
              }
            }
            braceValues.push(joinedParts.join(""));
          }
        }
      }

      if (hasInvalidRange) {
        for (const result of results) {
          operationCounter.count++;
          result.push(invalidRangeLiteral);
        }
        continue;
      }

      const newSize = results.length * braceValues.length;
      if (
        newSize > MAX_BRACE_EXPANSION_RESULTS ||
        operationCounter.count > MAX_BRACE_OPERATIONS
      ) {
        return results;
      }

      const newResults: BraceExpandedPart[][] = [];
      for (const result of results) {
        for (const val of braceValues) {
          operationCounter.count++;
          if (operationCounter.count > MAX_BRACE_OPERATIONS) {
            return newResults.length > 0 ? newResults : results;
          }
          newResults.push([...result, val]);
        }
      }
      results = newResults;
    } else {
      // Non-brace part: keep as WordPart for deferred expansion
      for (const result of results) {
        operationCounter.count++;
        result.push(part);
      }
    }
  }

  return results;
}

/**
 * Async version of expandWordWithBraces
 */
async function expandWordWithBracesAsync(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string[]> {
  const parts = word.parts;

  if (!hasBraceExpansion(parts)) {
    return [await expandWord(ctx, word)];
  }

  const expanded = await expandBracesInPartsAsync(ctx, parts);

  // Now expand each result, evaluating deferred parts separately for each
  // This ensures side effects like $((i++)) are evaluated fresh for each brace alternative
  const results: string[] = [];
  for (const resultParts of expanded) {
    const joinedParts: string[] = [];
    for (const p of resultParts) {
      if (typeof p === "string") {
        joinedParts.push(p);
      } else {
        // Expand the deferred WordPart now (async)
        joinedParts.push(await expandPart(ctx, p));
      }
    }
    // Apply tilde expansion to each result - this handles cases like ~{/src,root}
    // where brace expansion produces ~/src and ~root, which then need tilde expansion
    results.push(applyTildeExpansion(ctx, joinedParts.join("")));
  }
  return results;
}

export async function expandWordWithGlob(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<{ values: string[]; quoted: boolean }> {
  const wordParts = word.parts;
  const {
    hasQuoted,
    hasCommandSub,
    hasArrayVar,
    hasArrayAtExpansion,
    hasParamExpansion,
    hasVarNamePrefixExpansion,
    hasIndirection,
  } = analyzeWordParts(wordParts);

  // Handle brace expansion first (produces multiple values)
  // Use async version if brace expansion contains command substitution
  const hasBraces = hasBraceExpansion(wordParts);
  const braceExpanded = hasBraces
    ? braceExpansionNeedsAsync(wordParts)
      ? await expandWordWithBracesAsync(ctx, word)
      : expandWordWithBraces(ctx, word)
    : null;

  if (braceExpanded && braceExpanded.length > 1) {
    // Brace expansion produced multiple values - apply glob to each
    const allValues: string[] = [];
    for (const value of braceExpanded) {
      // Word elision: In bash, empty strings from unquoted brace expansion
      // are elided (removed from the result). For example, {X,,Y,} produces
      // just X and Y, not X, '', Y, ''.
      // This only applies when the word has no quoted parts.
      if (!hasQuoted && value === "") {
        continue;
      }
      // Skip glob expansion if noglob is set (set -f)
      if (
        !hasQuoted &&
        !ctx.state.options.noglob &&
        hasGlobPattern(value, ctx.state.shoptOptions.extglob)
      ) {
        const globExpander = new GlobExpander(
          ctx.fs,
          ctx.state.cwd,
          ctx.state.env,
          {
            globstar: ctx.state.shoptOptions.globstar,
            nullglob: ctx.state.shoptOptions.nullglob,
            failglob: ctx.state.shoptOptions.failglob,
            dotglob: ctx.state.shoptOptions.dotglob,
            extglob: ctx.state.shoptOptions.extglob,
            globskipdots: ctx.state.shoptOptions.globskipdots,
          },
        );
        const matches = await globExpander.expand(value);
        if (matches.length > 0) {
          allValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          // failglob: throw error when pattern has no matches
          throw new GlobError(value);
        } else if (globExpander.hasNullglob()) {
          // nullglob: don't add anything when pattern has no matches
          // (skip adding this value)
        } else {
          // Default: keep the original pattern
          allValues.push(value);
        }
      } else {
        allValues.push(value);
      }
    }
    return { values: allValues, quoted: false };
  }

  // Special handling for "${a[@]}" - each array element becomes a separate word
  // This applies even inside double quotes
  // NOTE: Only handles the simple case WITHOUT operations (like pattern removal)
  // Operations like ${a[@]#pattern} are handled by dedicated handlers below
  if (
    hasArrayAtExpansion &&
    wordParts.length === 1 &&
    wordParts[0].type === "DoubleQuoted"
  ) {
    const dqPart = wordParts[0];
    // Check if it's ONLY the array expansion (like "${a[@]}") without operations
    // More complex cases like "prefix${a[@]}suffix" or "${a[@]#pattern}" need different handling
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      !dqPart.parts[0].operation
    ) {
      const paramPart = dqPart.parts[0];
      const match = paramPart.parameter.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[[@]\]$/,
      );
      if (match) {
        const arrayName = match[1];

        // Special case: if arrayName is a nameref pointing to array[@],
        // ${ref[@]} doesn't do double indirection - it returns empty
        if (isNameref(ctx, arrayName)) {
          const resolved = resolveNameref(ctx, arrayName);
          if (resolved && /^[a-zA-Z_][a-zA-Z0-9_]*\[@\]$/.test(resolved)) {
            // ref points to arr[@], so ${ref[@]} is invalid/empty
            return { values: [], quoted: true };
          }
        }

        const elements = getArrayElements(ctx, arrayName);
        if (elements.length > 0) {
          // Return each element as a separate word
          return { values: elements.map(([, v]) => v), quoted: true };
        }
        // No array elements - check for scalar variable
        // ${s[@]} where s='abc' should return 'abc' (treat scalar as single-element array)
        // But NOT if the scalar value is actually from a nameref to array[@]
        if (!isNameref(ctx, arrayName)) {
          const scalarValue = ctx.state.env[arrayName];
          if (scalarValue !== undefined) {
            return { values: [scalarValue], quoted: true };
          }
        }
        // Variable is unset - return empty
        return { values: [], quoted: true };
      }
    }
  }

  // Handle namerefs pointing to array[@] - "${ref}" where ref='arr[@]'
  // When a nameref points to array[@], expanding "$ref" should produce multiple words
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      !dqPart.parts[0].operation
    ) {
      const paramPart = dqPart.parts[0];
      const param = paramPart.parameter;
      // Check if it's a simple variable name (not already an array subscript)
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(param) && isNameref(ctx, param)) {
        const resolved = resolveNameref(ctx, param);
        if (resolved && resolved !== param) {
          // Check if resolved target is array[@]
          const arrayAtMatch = resolved.match(
            /^([a-zA-Z_][a-zA-Z0-9_]*)\[@\]$/,
          );
          if (arrayAtMatch) {
            const arrayName = arrayAtMatch[1];
            const elements = getArrayElements(ctx, arrayName);
            if (elements.length > 0) {
              // Return each element as a separate word
              return { values: elements.map(([, v]) => v), quoted: true };
            }
            // No array elements - check for scalar variable
            const scalarValue = ctx.state.env[arrayName];
            if (scalarValue !== undefined) {
              return { values: [scalarValue], quoted: true };
            }
            // Variable is unset - return empty
            return { values: [], quoted: true };
          }
        }
      }
    }
  }

  // Handle "${arr[@]:-${default[@]}}", "${arr[@]:+${alt[@]}}", and "${arr[@]:=default}" - array default/alternative values
  // Also handles "${var:-${default[@]}}" where var is a scalar variable.
  // When the default value contains an array expansion, each element should become a separate word.
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      (dqPart.parts[0].operation?.type === "DefaultValue" ||
        dqPart.parts[0].operation?.type === "UseAlternative" ||
        dqPart.parts[0].operation?.type === "AssignDefault")
    ) {
      const paramPart = dqPart.parts[0];
      const op = paramPart.operation as
        | { type: "DefaultValue"; word?: WordNode; checkEmpty?: boolean }
        | { type: "UseAlternative"; word?: WordNode; checkEmpty?: boolean }
        | { type: "AssignDefault"; word?: WordNode; checkEmpty?: boolean };

      // Check if the outer parameter is an array subscript
      const arrayMatch = paramPart.parameter.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
      );

      // Determine if we should use the alternate/default value
      let shouldUseAlternate: boolean;
      let outerIsStar = false;

      if (arrayMatch) {
        // Outer parameter is an array subscript like arr[@] or arr[*]
        const arrayName = arrayMatch[1];
        outerIsStar = arrayMatch[2] === "*";

        const elements = getArrayElements(ctx, arrayName);
        const isSet =
          elements.length > 0 || ctx.state.env[arrayName] !== undefined;
        const isEmpty =
          elements.length === 0 ||
          (elements.length === 1 && elements.every(([, v]) => v === ""));
        const checkEmpty = op.checkEmpty ?? false;

        if (op.type === "UseAlternative") {
          shouldUseAlternate = isSet && !(checkEmpty && isEmpty);
        } else {
          shouldUseAlternate = !isSet || (checkEmpty && isEmpty);
        }

        // If not using alternate, return the original array value
        if (!shouldUseAlternate) {
          if (elements.length > 0) {
            const values = elements.map(([, v]) => v);
            if (outerIsStar) {
              const ifsSep = getIfsSeparator(ctx.state.env);
              return { values: [values.join(ifsSep)], quoted: true };
            }
            return { values, quoted: true };
          }
          const scalarValue = ctx.state.env[arrayName];
          if (scalarValue !== undefined) {
            return { values: [scalarValue], quoted: true };
          }
          return { values: [], quoted: true };
        }
      } else {
        // Outer parameter is a scalar variable
        const varName = paramPart.parameter;
        const isSet = isVariableSet(ctx, varName);
        const value = getVariable(ctx, varName);
        const isEmpty = value === "";
        const checkEmpty = op.checkEmpty ?? false;

        if (op.type === "UseAlternative") {
          shouldUseAlternate = isSet && !(checkEmpty && isEmpty);
        } else {
          shouldUseAlternate = !isSet || (checkEmpty && isEmpty);
        }

        // If not using alternate, return the scalar value
        if (!shouldUseAlternate) {
          return { values: [value], quoted: true };
        }
      }

      // We should use the alternate/default value
      if (shouldUseAlternate && op.word) {
        // Check if the default/alternative word contains an array expansion
        const opWordParts = op.word.parts;
        let defaultArrayName: string | null = null;
        let defaultIsStar = false;

        for (const part of opWordParts) {
          if (part.type === "ParameterExpansion" && !part.operation) {
            const defaultMatch = part.parameter.match(
              /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
            );
            if (defaultMatch) {
              defaultArrayName = defaultMatch[1];
              defaultIsStar = defaultMatch[2] === "*";
              break;
            }
          }
        }

        if (defaultArrayName) {
          // The default word is an array expansion - return its elements
          const defaultElements = getArrayElements(ctx, defaultArrayName);
          if (defaultElements.length > 0) {
            const values = defaultElements.map(([, v]) => v);
            if (defaultIsStar || outerIsStar) {
              // Join with IFS for [*] subscript
              const ifsSep = getIfsSeparator(ctx.state.env);
              return { values: [values.join(ifsSep)], quoted: true };
            }
            // [@] - each element as a separate word
            return { values, quoted: true };
          }
          // Default array is empty - check for scalar
          const scalarValue = ctx.state.env[defaultArrayName];
          if (scalarValue !== undefined) {
            return { values: [scalarValue], quoted: true };
          }
          // Default is unset
          return { values: [], quoted: true };
        }
        // Default word doesn't contain an array expansion - fall through to normal expansion
      }
    }
  }

  // Handle "${prefix}${arr[@]#pattern}${suffix}" and "${prefix}${arr[@]/pat/rep}${suffix}"
  // Array pattern operations with adjacent text in double quotes
  // Each array element has the pattern applied, then becomes a separate word
  // with prefix joined to first and suffix joined to last
  if (
    hasArrayAtExpansion &&
    wordParts.length === 1 &&
    wordParts[0].type === "DoubleQuoted"
  ) {
    const dqPart = wordParts[0];
    // Find if there's a ${arr[@]} or ${arr[*]} with PatternRemoval or PatternReplacement
    let arrayAtIndex = -1;
    let arrayName = "";
    let isStar = false;
    let arrayOperation: PatternRemovalOp | PatternReplacementOp | null = null;
    for (let i = 0; i < dqPart.parts.length; i++) {
      const p = dqPart.parts[i];
      if (
        p.type === "ParameterExpansion" &&
        (p.operation?.type === "PatternRemoval" ||
          p.operation?.type === "PatternReplacement")
      ) {
        const match = p.parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/);
        if (match) {
          arrayAtIndex = i;
          arrayName = match[1];
          isStar = match[2] === "*";
          arrayOperation = p.operation as
            | PatternRemovalOp
            | PatternReplacementOp;
          break;
        }
      }
    }

    // Only handle if there's prefix or suffix (pure "${arr[@]#pat}" is handled below)
    if (
      arrayAtIndex !== -1 &&
      (arrayAtIndex > 0 || arrayAtIndex < dqPart.parts.length - 1)
    ) {
      // Expand prefix (parts before ${arr[@]})
      let prefix = "";
      for (let i = 0; i < arrayAtIndex; i++) {
        prefix += await expandPart(ctx, dqPart.parts[i]);
      }

      // Expand suffix (parts after ${arr[@]})
      let suffix = "";
      for (let i = arrayAtIndex + 1; i < dqPart.parts.length; i++) {
        suffix += await expandPart(ctx, dqPart.parts[i]);
      }

      // Get array elements
      const elements = getArrayElements(ctx, arrayName);
      let values = elements.map(([, v]) => v);

      // If no elements, check for scalar (treat as single-element array)
      if (elements.length === 0) {
        const scalarValue = ctx.state.env[arrayName];
        if (scalarValue !== undefined) {
          values = [scalarValue];
        } else {
          // Variable is unset or empty array
          if (isStar) {
            return { values: [prefix + suffix], quoted: true };
          }
          const combined = prefix + suffix;
          return { values: combined ? [combined] : [], quoted: true };
        }
      }

      // Apply operation to each element
      if (arrayOperation?.type === "PatternRemoval") {
        const op = arrayOperation as PatternRemovalOp;
        // Build the regex pattern
        let regexStr = "";
        const extglob = ctx.state.shoptOptions.extglob;
        if (op.pattern) {
          for (const part of op.pattern.parts) {
            if (part.type === "Glob") {
              regexStr += patternToRegex(part.pattern, op.greedy, extglob);
            } else if (part.type === "Literal") {
              regexStr += patternToRegex(part.value, op.greedy, extglob);
            } else if (
              part.type === "SingleQuoted" ||
              part.type === "Escaped"
            ) {
              regexStr += escapeRegex(part.value);
            } else if (part.type === "DoubleQuoted") {
              const expanded = await expandWordPartsAsync(ctx, part.parts);
              regexStr += escapeRegex(expanded);
            } else if (part.type === "ParameterExpansion") {
              const expanded = await expandPart(ctx, part);
              regexStr += patternToRegex(expanded, op.greedy, extglob);
            } else {
              const expanded = await expandPart(ctx, part);
              regexStr += escapeRegex(expanded);
            }
          }
        }
        // Apply pattern removal to each element
        values = values.map((value) =>
          applyPatternRemoval(value, regexStr, op.side, op.greedy),
        );
      } else {
        const op = arrayOperation as PatternReplacementOp;
        // Build the replacement regex
        let regex = "";
        if (op.pattern) {
          for (const part of op.pattern.parts) {
            if (part.type === "Glob") {
              regex += patternToRegex(
                part.pattern,
                true,
                ctx.state.shoptOptions.extglob,
              );
            } else if (part.type === "Literal") {
              regex += patternToRegex(
                part.value,
                true,
                ctx.state.shoptOptions.extglob,
              );
            } else if (
              part.type === "SingleQuoted" ||
              part.type === "Escaped"
            ) {
              regex += escapeRegex(part.value);
            } else if (part.type === "DoubleQuoted") {
              const expanded = await expandWordPartsAsync(ctx, part.parts);
              regex += escapeRegex(expanded);
            } else if (part.type === "ParameterExpansion") {
              const expanded = await expandPart(ctx, part);
              regex += patternToRegex(
                expanded,
                true,
                ctx.state.shoptOptions.extglob,
              );
            } else {
              const expanded = await expandPart(ctx, part);
              regex += escapeRegex(expanded);
            }
          }
        }

        const replacement = op.replacement
          ? await expandWordPartsAsync(ctx, op.replacement.parts)
          : "";

        // Apply anchor modifiers
        let regexPattern = regex;
        if (op.anchor === "start") {
          regexPattern = `^${regex}`;
        } else if (op.anchor === "end") {
          regexPattern = `${regex}$`;
        }

        // Apply replacement to each element
        try {
          const re = new RegExp(regexPattern, op.all ? "g" : "");
          values = values.map((value) => value.replace(re, replacement));
        } catch {
          // Invalid regex - leave values unchanged
        }
      }

      if (isStar) {
        // "${arr[*]#...}" - join all elements with IFS into one word
        const ifsSep = getIfsSeparator(ctx.state.env);
        return {
          values: [prefix + values.join(ifsSep) + suffix],
          quoted: true,
        };
      }

      // "${arr[@]#...}" - each element is a separate word
      // Join prefix with first, suffix with last
      if (values.length === 1) {
        return { values: [prefix + values[0] + suffix], quoted: true };
      }

      const result = [
        prefix + values[0],
        ...values.slice(1, -1),
        values[values.length - 1] + suffix,
      ];
      return { values: result, quoted: true };
    }
  }

  // Handle "${prefix}${arr[@]}${suffix}" - array expansion with adjacent text in double quotes
  // Each array element becomes a separate word, with prefix joined to first and suffix joined to last
  // This is similar to how "$@" works with prefix/suffix
  if (
    hasArrayAtExpansion &&
    wordParts.length === 1 &&
    wordParts[0].type === "DoubleQuoted"
  ) {
    const dqPart = wordParts[0];
    // Find if there's a ${arr[@]} or ${arr[*]} inside (without operations)
    let arrayAtIndex = -1;
    let arrayName = "";
    let isStar = false;
    for (let i = 0; i < dqPart.parts.length; i++) {
      const p = dqPart.parts[i];
      if (p.type === "ParameterExpansion" && !p.operation) {
        const match = p.parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/);
        if (match) {
          arrayAtIndex = i;
          arrayName = match[1];
          isStar = match[2] === "*";
          break;
        }
      }
    }

    if (arrayAtIndex !== -1) {
      // Expand prefix (parts before ${arr[@]})
      let prefix = "";
      for (let i = 0; i < arrayAtIndex; i++) {
        prefix += await expandPart(ctx, dqPart.parts[i]);
      }

      // Expand suffix (parts after ${arr[@]})
      let suffix = "";
      for (let i = arrayAtIndex + 1; i < dqPart.parts.length; i++) {
        suffix += await expandPart(ctx, dqPart.parts[i]);
      }

      // Get array elements
      const elements = getArrayElements(ctx, arrayName);
      const values = elements.map(([, v]) => v);

      // If no elements, check for scalar (treat as single-element array)
      if (elements.length === 0) {
        const scalarValue = ctx.state.env[arrayName];
        if (scalarValue !== undefined) {
          // Scalar treated as single-element array
          return { values: [prefix + scalarValue + suffix], quoted: true };
        }
        // Variable is unset or empty array
        if (isStar) {
          // "${arr[*]}" with empty array produces one empty word (prefix + "" + suffix)
          return { values: [prefix + suffix], quoted: true };
        }
        // "${arr[@]}" with empty array produces no words (unless there's prefix/suffix)
        const combined = prefix + suffix;
        return { values: combined ? [combined] : [], quoted: true };
      }

      if (isStar) {
        // "${arr[*]}" - join all elements with IFS into one word
        const ifsSep = getIfsSeparator(ctx.state.env);
        return {
          values: [prefix + values.join(ifsSep) + suffix],
          quoted: true,
        };
      }

      // "${arr[@]}" - each element is a separate word
      // Join prefix with first, suffix with last
      if (values.length === 1) {
        return { values: [prefix + values[0] + suffix], quoted: true };
      }

      const result = [
        prefix + values[0],
        ...values.slice(1, -1),
        values[values.length - 1] + suffix,
      ];
      return { values: result, quoted: true };
    }
  }

  // Handle "${arr[@]:offset}" and "${arr[@]:offset:length}" - array slicing with multiple return values
  // "${arr[@]:n:m}" returns m elements starting from index n as separate words
  // "${arr[*]:n:m}" returns m elements starting from index n joined with IFS as one word
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      dqPart.parts[0].operation?.type === "Substring"
    ) {
      const paramPart = dqPart.parts[0];
      const arrayMatch = paramPart.parameter.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
      );
      if (arrayMatch) {
        const arrayName = arrayMatch[1];
        const isStar = arrayMatch[2] === "*";
        const operation = paramPart.operation as SubstringOp;

        // Slicing associative arrays doesn't make sense - error out
        if (ctx.state.associativeArrays?.has(arrayName)) {
          throw new ExitError(
            1,
            "",
            `bash: \${${arrayName}[@]: 0: 3}: bad substitution\n`,
          );
        }

        // Evaluate offset and length
        const offset = operation.offset
          ? evaluateArithmeticSync(ctx, operation.offset.expression)
          : 0;
        const length = operation.length
          ? evaluateArithmeticSync(ctx, operation.length.expression)
          : undefined;

        // Get array elements (sorted by index)
        const elements = getArrayElements(ctx, arrayName);

        // For sparse arrays, offset refers to index position, not element position
        // Find the first element whose index >= offset (or computed index for negative offset)
        let startIdx = 0;
        if (offset < 0) {
          // Negative offset: count from maxIndex + 1
          // e.g., -1 means elements with index >= maxIndex
          if (elements.length > 0) {
            const lastIdx = elements[elements.length - 1][0];
            const maxIndex = typeof lastIdx === "number" ? lastIdx : 0;
            const targetIndex = maxIndex + 1 + offset;
            // If target index is negative, return empty (out of bounds)
            if (targetIndex < 0) {
              return { values: [], quoted: true };
            }
            // Find first element with index >= targetIndex
            startIdx = elements.findIndex(
              ([idx]) => typeof idx === "number" && idx >= targetIndex,
            );
            if (startIdx < 0) startIdx = elements.length; // All elements have smaller index
          }
        } else {
          // Positive offset: find first element with index >= offset
          startIdx = elements.findIndex(
            ([idx]) => typeof idx === "number" && idx >= offset,
          );
          if (startIdx < 0) startIdx = elements.length; // All elements have smaller index
        }

        let slicedValues: string[];
        if (length !== undefined) {
          if (length < 0) {
            // Negative length is an error for array slicing in bash
            throw new ArithmeticError(
              `${arrayName}[@]: substring expression < 0`,
            );
          }
          // Take 'length' elements starting from startIdx
          slicedValues = elements
            .slice(startIdx, startIdx + length)
            .map(([, v]) => v);
        } else {
          // Take all elements starting from startIdx
          slicedValues = elements.slice(startIdx).map(([, v]) => v);
        }

        if (slicedValues.length === 0) {
          return { values: [], quoted: true };
        }

        if (isStar) {
          // "${arr[*]:n:m}" - join with IFS into one word
          const ifsSep = getIfsSeparator(ctx.state.env);
          return { values: [slicedValues.join(ifsSep)], quoted: true };
        }

        // "${arr[@]:n:m}" - each element as a separate word
        return { values: slicedValues, quoted: true };
      }
    }
  }

  // Handle "${arr[@]@a}", "${arr[@]@P}", "${arr[@]@Q}" - array Transform operations
  // "${arr[@]@a}": Return attribute letter for each element (e.g., 'a' for indexed array)
  // "${arr[@]@P}": Return each element's value (prompt expansion, limited implementation)
  // "${arr[@]@Q}": Return each element quoted for shell reuse
  // "${arr[*]@X}": Same as above but joined with IFS as one word
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      dqPart.parts[0].operation?.type === "Transform"
    ) {
      const paramPart = dqPart.parts[0];
      const arrayMatch = paramPart.parameter.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
      );
      if (arrayMatch) {
        const arrayName = arrayMatch[1];
        const isStar = arrayMatch[2] === "*";
        const operation = paramPart.operation as {
          type: "Transform";
          operator: string;
        };

        // Get array elements
        const elements = getArrayElements(ctx, arrayName);

        // If no elements, check for scalar (treat as single-element array)
        if (elements.length === 0) {
          const scalarValue = ctx.state.env[arrayName];
          if (scalarValue !== undefined) {
            // Scalar variable - return based on operator
            let resultValue: string;
            switch (operation.operator) {
              case "a":
                resultValue = ""; // Scalars have no array attribute
                break;
              case "P":
                resultValue = expandPrompt(ctx, scalarValue);
                break;
              case "Q":
                resultValue = quoteValue(scalarValue);
                break;
              default:
                resultValue = scalarValue;
            }
            return { values: [resultValue], quoted: true };
          }
          // Variable is unset
          if (isStar) {
            return { values: [""], quoted: true };
          }
          return { values: [], quoted: true };
        }

        // Get the attribute for this array (same for all elements)
        const arrayAttr = getVariableAttributes(ctx, arrayName);

        // Transform each element based on operator
        let transformedValues: string[];
        switch (operation.operator) {
          case "a":
            // Return attribute letter for each element
            // All elements of the same array have the same attribute
            transformedValues = elements.map(() => arrayAttr);
            break;
          case "P":
            // Apply prompt expansion to each element
            transformedValues = elements.map(([, v]) => expandPrompt(ctx, v));
            break;
          case "Q":
            // Quote each element
            transformedValues = elements.map(([, v]) => quoteValue(v));
            break;
          case "u":
            // Capitalize first character only (ucfirst)
            transformedValues = elements.map(
              ([, v]) => v.charAt(0).toUpperCase() + v.slice(1),
            );
            break;
          case "U":
            // Uppercase all characters
            transformedValues = elements.map(([, v]) => v.toUpperCase());
            break;
          case "L":
            // Lowercase all characters
            transformedValues = elements.map(([, v]) => v.toLowerCase());
            break;
          default:
            transformedValues = elements.map(([, v]) => v);
        }

        if (isStar) {
          // "${arr[*]@X}" - join all values with IFS into one word
          const ifsSep = getIfsSeparator(ctx.state.env);
          return { values: [transformedValues.join(ifsSep)], quoted: true };
        }

        // "${arr[@]@X}" - each value as a separate word
        return { values: transformedValues, quoted: true };
      }
    }
  }

  // Handle "${arr[@]/pattern/replacement}" and "${arr[*]/pattern/replacement}" - array pattern replacement
  // "${arr[@]/#/prefix}": Prepend prefix to each element (when pattern is empty and anchor is "start")
  // "${arr[@]/%/suffix}": Append suffix to each element (when pattern is empty and anchor is "end")
  // "${arr[@]/pattern/replacement}": Replace pattern in each element
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      dqPart.parts[0].operation?.type === "PatternReplacement"
    ) {
      const paramPart = dqPart.parts[0];
      const arrayMatch = paramPart.parameter.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
      );
      if (arrayMatch) {
        const arrayName = arrayMatch[1];
        const isStar = arrayMatch[2] === "*";
        const operation = paramPart.operation as {
          type: "PatternReplacement";
          pattern: WordNode;
          replacement: WordNode | null;
          all: boolean;
          anchor: "start" | "end" | null;
        };

        // Get array elements
        const elements = getArrayElements(ctx, arrayName);
        const values = elements.map(([, v]) => v);

        // If no elements, check for scalar (treat as single-element array)
        if (elements.length === 0) {
          const scalarValue = ctx.state.env[arrayName];
          if (scalarValue !== undefined) {
            values.push(scalarValue);
          }
        }

        if (values.length === 0) {
          return { values: [], quoted: true };
        }

        // Build the replacement regex
        let regex = "";
        if (operation.pattern) {
          for (const part of operation.pattern.parts) {
            if (part.type === "Glob") {
              regex += patternToRegex(
                part.pattern,
                true,
                ctx.state.shoptOptions.extglob,
              );
            } else if (part.type === "Literal") {
              regex += patternToRegex(
                part.value,
                true,
                ctx.state.shoptOptions.extglob,
              );
            } else if (
              part.type === "SingleQuoted" ||
              part.type === "Escaped"
            ) {
              regex += escapeRegex(part.value);
            } else if (part.type === "DoubleQuoted") {
              const expanded = await expandWordPartsAsync(ctx, part.parts);
              regex += escapeRegex(expanded);
            } else if (part.type === "ParameterExpansion") {
              const expanded = await expandPart(ctx, part);
              regex += patternToRegex(
                expanded,
                true,
                ctx.state.shoptOptions.extglob,
              );
            } else {
              const expanded = await expandPart(ctx, part);
              regex += escapeRegex(expanded);
            }
          }
        }

        const replacement = operation.replacement
          ? await expandWordPartsAsync(ctx, operation.replacement.parts)
          : "";

        // Apply anchor modifiers
        let regexPattern = regex;
        if (operation.anchor === "start") {
          regexPattern = `^${regex}`;
        } else if (operation.anchor === "end") {
          regexPattern = `${regex}$`;
        }

        // Apply replacement to each element
        const replacedValues: string[] = [];
        try {
          const re = new RegExp(regexPattern, operation.all ? "g" : "");
          for (const value of values) {
            replacedValues.push(value.replace(re, replacement));
          }
        } catch {
          // Invalid regex - return values unchanged
          replacedValues.push(...values);
        }

        if (isStar) {
          // "${arr[*]/...}" - join all elements with IFS into one word
          const ifsSep = getIfsSeparator(ctx.state.env);
          return { values: [replacedValues.join(ifsSep)], quoted: true };
        }

        // "${arr[@]/...}" - each element as a separate word
        return { values: replacedValues, quoted: true };
      }
    }
  }

  // Handle "${arr[@]#pattern}" and "${arr[*]#pattern}" - array pattern removal (strip)
  // "${arr[@]#pattern}": Remove shortest matching prefix from each element, each becomes a separate word
  // "${arr[@]##pattern}": Remove longest matching prefix from each element
  // "${arr[@]%pattern}": Remove shortest matching suffix from each element
  // "${arr[@]%%pattern}": Remove longest matching suffix from each element
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      dqPart.parts[0].operation?.type === "PatternRemoval"
    ) {
      const paramPart = dqPart.parts[0];
      const arrayMatch = paramPart.parameter.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
      );
      if (arrayMatch) {
        const arrayName = arrayMatch[1];
        const isStar = arrayMatch[2] === "*";
        const operation = paramPart.operation as {
          type: "PatternRemoval";
          pattern: WordNode;
          side: "prefix" | "suffix";
          greedy: boolean;
        };

        // Get array elements
        const elements = getArrayElements(ctx, arrayName);
        const values = elements.map(([, v]) => v);

        // If no elements, check for scalar (treat as single-element array)
        if (elements.length === 0) {
          const scalarValue = ctx.state.env[arrayName];
          if (scalarValue !== undefined) {
            values.push(scalarValue);
          }
        }

        if (values.length === 0) {
          return { values: [], quoted: true };
        }

        // Build the regex pattern
        let regexStr = "";
        const extglob = ctx.state.shoptOptions.extglob;
        if (operation.pattern) {
          for (const part of operation.pattern.parts) {
            if (part.type === "Glob") {
              regexStr += patternToRegex(
                part.pattern,
                operation.greedy,
                extglob,
              );
            } else if (part.type === "Literal") {
              regexStr += patternToRegex(part.value, operation.greedy, extglob);
            } else if (
              part.type === "SingleQuoted" ||
              part.type === "Escaped"
            ) {
              regexStr += escapeRegex(part.value);
            } else if (part.type === "DoubleQuoted") {
              const expanded = await expandWordPartsAsync(ctx, part.parts);
              regexStr += escapeRegex(expanded);
            } else if (part.type === "ParameterExpansion") {
              const expanded = await expandPart(ctx, part);
              regexStr += patternToRegex(expanded, operation.greedy, extglob);
            } else {
              const expanded = await expandPart(ctx, part);
              regexStr += escapeRegex(expanded);
            }
          }
        }

        // Apply pattern removal to each element
        const strippedValues: string[] = [];
        for (const value of values) {
          strippedValues.push(
            applyPatternRemoval(
              value,
              regexStr,
              operation.side,
              operation.greedy,
            ),
          );
        }

        if (isStar) {
          // "${arr[*]#...}" - join all elements with IFS into one word
          const ifsSep = getIfsSeparator(ctx.state.env);
          return { values: [strippedValues.join(ifsSep)], quoted: true };
        }

        // "${arr[@]#...}" - each element as a separate word
        return { values: strippedValues, quoted: true };
      }
    }
  }

  // Handle "${!prefix@}" and "${!prefix*}" - variable name prefix expansion
  // "${!prefix@}": Each variable name becomes a separate word (like "$@")
  // "${!prefix*}": All names joined with IFS[0] into one word (like "$*")
  if (
    hasVarNamePrefixExpansion &&
    wordParts.length === 1 &&
    wordParts[0].type === "DoubleQuoted"
  ) {
    const dqPart = wordParts[0];
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      dqPart.parts[0].operation?.type === "VarNamePrefix"
    ) {
      const op = dqPart.parts[0].operation;
      const matchingVars = getVarNamesWithPrefix(ctx, op.prefix);

      if (op.star) {
        // "${!prefix*}" - join with first char of IFS into one word
        return {
          values: [matchingVars.join(getIfsSeparator(ctx.state.env))],
          quoted: true,
        };
      }
      // "${!prefix@}" - each name as a separate word
      return { values: matchingVars, quoted: true };
    }

    // Handle "${!arr[@]}" and "${!arr[*]}" - array keys/indices expansion
    // "${!arr[@]}": Each key/index becomes a separate word (like "$@")
    // "${!arr[*]}": All keys joined with IFS[0] into one word (like "$*")
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      dqPart.parts[0].operation?.type === "ArrayKeys"
    ) {
      const op = dqPart.parts[0].operation;
      const elements = getArrayElements(ctx, op.array);
      const keys = elements.map(([k]) => String(k));

      if (op.star) {
        // "${!arr[*]}" - join with first char of IFS into one word
        return {
          values: [keys.join(getIfsSeparator(ctx.state.env))],
          quoted: true,
        };
      }
      // "${!arr[@]}" - each key as a separate word
      return { values: keys, quoted: true };
    }
  }

  // Handle "${!ref}" where ref='arr[@]' or ref='arr[*]' - indirect array expansion
  // This needs to be evaluated at runtime because we don't know the target until we expand ref
  // NOTE: Only apply this shortcut when there's no innerOp (e.g., ${!ref[@]} not ${!ref[@]:2})
  if (
    hasIndirection &&
    wordParts.length === 1 &&
    wordParts[0].type === "DoubleQuoted"
  ) {
    const dqPart = wordParts[0];
    if (
      dqPart.parts.length === 1 &&
      dqPart.parts[0].type === "ParameterExpansion" &&
      dqPart.parts[0].operation?.type === "Indirection"
    ) {
      const paramPart = dqPart.parts[0];
      const indirOp = paramPart.operation as {
        type: "Indirection";
        innerOp?: InnerParameterOperation;
      };
      // Get the value of the reference variable (e.g., ref='arr[@]')
      const refValue = getVariable(ctx, paramPart.parameter);
      // Check if the target is an array expansion (arr[@] or arr[*])
      const arrayMatch = refValue.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/);
      if (arrayMatch) {
        const arrayName = arrayMatch[1];
        const isStar = arrayMatch[2] === "*";
        const elements = getArrayElements(ctx, arrayName);

        if (indirOp.innerOp) {
          // Handle "${!ref[@]:offset}" or "${!ref[@]:offset:length}" - array slicing via indirection
          if (indirOp.innerOp.type === "Substring") {
            const offset = indirOp.innerOp.offset
              ? evaluateArithmeticSync(ctx, indirOp.innerOp.offset.expression)
              : 0;
            const length = indirOp.innerOp.length
              ? evaluateArithmeticSync(ctx, indirOp.innerOp.length.expression)
              : undefined;

            // For sparse arrays, offset refers to index position
            let startIdx = 0;
            if (offset < 0) {
              if (elements.length > 0) {
                const lastIdx = elements[elements.length - 1][0];
                const maxIndex = typeof lastIdx === "number" ? lastIdx : 0;
                const targetIndex = maxIndex + 1 + offset;
                if (targetIndex < 0) return { values: [], quoted: true };
                startIdx = elements.findIndex(
                  ([idx]) => typeof idx === "number" && idx >= targetIndex,
                );
                if (startIdx < 0) return { values: [], quoted: true };
              }
            } else {
              startIdx = elements.findIndex(
                ([idx]) => typeof idx === "number" && idx >= offset,
              );
              if (startIdx < 0) return { values: [], quoted: true };
            }

            let slicedElements: Array<[string | number, string]>;
            if (length !== undefined) {
              if (length < 0) {
                throw new ArithmeticError(
                  `${arrayName}[@]: substring expression < 0`,
                );
              }
              slicedElements = elements.slice(startIdx, startIdx + length);
            } else {
              slicedElements = elements.slice(startIdx);
            }

            const values = slicedElements.map(([, v]) => v);
            if (isStar) {
              return {
                values: [values.join(getIfsSeparator(ctx.state.env))],
                quoted: true,
              };
            }
            return { values, quoted: true };
          }

          // Handle DefaultValue, UseAlternative, AssignDefault, ErrorIfUnset
          // These check the whole array, not each element
          if (
            indirOp.innerOp.type === "DefaultValue" ||
            indirOp.innerOp.type === "UseAlternative" ||
            indirOp.innerOp.type === "AssignDefault" ||
            indirOp.innerOp.type === "ErrorIfUnset"
          ) {
            const op = indirOp.innerOp as {
              type: string;
              word?: WordNode;
              checkEmpty?: boolean;
            };
            const checkEmpty = op.checkEmpty ?? false;
            const values = elements.map(([, v]) => v);
            // For arrays, "empty" means zero elements (not that elements are empty strings)
            // Empty string elements are still "set" values, so they don't trigger default/alternative
            const isEmpty = elements.length === 0;
            const isUnset = elements.length === 0;

            if (indirOp.innerOp.type === "UseAlternative") {
              // ${!ref[@]:+word} - return word if set and non-empty
              const shouldUseAlt = !isUnset && !(checkEmpty && isEmpty);
              if (shouldUseAlt && op.word) {
                const altValue = expandWordPartsSync(ctx, op.word.parts, true);
                return { values: [altValue], quoted: true };
              }
              return { values: [], quoted: true };
            }
            if (indirOp.innerOp.type === "DefaultValue") {
              // ${!ref[@]:-word} - return word if unset or empty
              const shouldUseDefault = isUnset || (checkEmpty && isEmpty);
              if (shouldUseDefault && op.word) {
                const defValue = expandWordPartsSync(ctx, op.word.parts, true);
                return { values: [defValue], quoted: true };
              }
              if (isStar) {
                return {
                  values: [values.join(getIfsSeparator(ctx.state.env))],
                  quoted: true,
                };
              }
              return { values, quoted: true };
            }
            if (indirOp.innerOp.type === "AssignDefault") {
              // ${!ref[@]:=word} - assign and return word if unset or empty
              const shouldAssign = isUnset || (checkEmpty && isEmpty);
              if (shouldAssign && op.word) {
                const assignValue = expandWordPartsSync(
                  ctx,
                  op.word.parts,
                  true,
                );
                // Assign to the target array
                ctx.state.env[`${arrayName}_0`] = assignValue;
                ctx.state.env[`${arrayName}__length`] = "1";
                return { values: [assignValue], quoted: true };
              }
              if (isStar) {
                return {
                  values: [values.join(getIfsSeparator(ctx.state.env))],
                  quoted: true,
                };
              }
              return { values, quoted: true };
            }
            // ErrorIfUnset case - not common for arrays
            if (isStar) {
              return {
                values: [values.join(getIfsSeparator(ctx.state.env))],
                quoted: true,
              };
            }
            return { values, quoted: true };
          }

          // Handle Transform operations specially for @a (attributes)
          if (
            indirOp.innerOp.type === "Transform" &&
            (indirOp.innerOp as { operator: string }).operator === "a"
          ) {
            // @a should return the attributes of the array itself for each element
            const attrs = getVariableAttributes(ctx, arrayName);
            const values = elements.map(() => attrs);
            if (isStar) {
              return {
                values: [values.join(getIfsSeparator(ctx.state.env))],
                quoted: true,
              };
            }
            return { values, quoted: true };
          }

          // Handle other innerOps (PatternRemoval, PatternReplacement, Transform, etc.)
          // Apply the operation to each element
          const values: string[] = [];
          for (const [, elemValue] of elements) {
            const syntheticPart: ParameterExpansionPart = {
              type: "ParameterExpansion",
              parameter: "_indirect_elem_",
              operation: indirOp.innerOp,
            };
            // Temporarily set the element value
            const oldVal = ctx.state.env._indirect_elem_;
            ctx.state.env._indirect_elem_ = elemValue;
            try {
              const result = expandParameter(ctx, syntheticPart, true);
              values.push(result);
            } finally {
              if (oldVal !== undefined) {
                ctx.state.env._indirect_elem_ = oldVal;
              } else {
                delete ctx.state.env._indirect_elem_;
              }
            }
          }
          if (isStar) {
            return {
              values: [values.join(getIfsSeparator(ctx.state.env))],
              quoted: true,
            };
          }
          return { values, quoted: true };
        }

        // No innerOp - return array elements directly
        if (elements.length > 0) {
          const values = elements.map(([, v]) => v);
          if (isStar) {
            // arr[*] - join with IFS into one word
            return {
              values: [values.join(getIfsSeparator(ctx.state.env))],
              quoted: true,
            };
          }
          // arr[@] - each element as a separate word
          return { values, quoted: true };
        }
        // No array elements - check for scalar variable
        const scalarValue = ctx.state.env[arrayName];
        if (scalarValue !== undefined) {
          return { values: [scalarValue], quoted: true };
        }
        // Variable is unset - return empty
        return { values: [], quoted: true };
      }

      // Handle ${!ref} where ref='@' or ref='*' (no array)
      if (!indirOp.innerOp) {
        // Handle ${!ref} where ref='@' or ref='*' - indirect positional parameter expansion
        // When ref='@', "${!ref}" should expand like "$@" (separate words)
        // When ref='*', "${!ref}" should expand like "$*" (joined by IFS)
        if (refValue === "@" || refValue === "*") {
          const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
          const params: string[] = [];
          for (let i = 1; i <= numParams; i++) {
            params.push(ctx.state.env[String(i)] || "");
          }
          if (refValue === "*") {
            // ref='*' - join with IFS into one word (like "$*")
            return {
              values: [params.join(getIfsSeparator(ctx.state.env))],
              quoted: true,
            };
          }
          // ref='@' - each param as a separate word (like "$@")
          return { values: params, quoted: true };
        }
      }
    }
  }

  // Handle unquoted ${ref+...} or ${ref-...} where the word contains "${!ref}" (quoted indirect array expansion)
  // This handles patterns like: ${hooksSlice+"${!hooksSlice}"} which should preserve element boundaries
  if (
    wordParts.length === 1 &&
    wordParts[0].type === "ParameterExpansion" &&
    (wordParts[0].operation?.type === "UseAlternative" ||
      wordParts[0].operation?.type === "DefaultValue")
  ) {
    const paramPart = wordParts[0];
    const op = paramPart.operation as
      | { type: "UseAlternative"; word?: WordNode; checkEmpty?: boolean }
      | { type: "DefaultValue"; word?: WordNode; checkEmpty?: boolean };
    const opWord = op?.word;
    // Check if the inner word is a quoted indirect expansion to an array
    if (
      opWord &&
      opWord.parts.length === 1 &&
      opWord.parts[0].type === "DoubleQuoted"
    ) {
      const innerDq = opWord.parts[0];
      if (
        innerDq.parts.length === 1 &&
        innerDq.parts[0].type === "ParameterExpansion" &&
        innerDq.parts[0].operation?.type === "Indirection"
      ) {
        const innerParam = innerDq.parts[0];
        // Get the value of the reference variable to see if it points to an array
        const refValue = getVariable(ctx, innerParam.parameter);
        const arrayMatch = refValue.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
        );
        if (arrayMatch) {
          // Check if we should use the alternative/default
          const isSet = isVariableSet(ctx, paramPart.parameter);
          const isEmpty = getVariable(ctx, paramPart.parameter) === "";
          const checkEmpty = op.checkEmpty ?? false;
          let shouldExpand: boolean;
          if (op.type === "UseAlternative") {
            // ${var+word} - expand if var IS set (and non-empty if :+)
            shouldExpand = isSet && !(checkEmpty && isEmpty);
          } else {
            // ${var-word} - expand if var is NOT set (or empty if :-)
            shouldExpand = !isSet || (checkEmpty && isEmpty);
          }

          if (shouldExpand) {
            // Expand the inner indirect array reference
            const arrayName = arrayMatch[1];
            const isStar = arrayMatch[2] === "*";
            const elements = getArrayElements(ctx, arrayName);
            if (elements.length > 0) {
              const values = elements.map(([, v]) => v);
              if (isStar) {
                // arr[*] - join with IFS into one word
                return {
                  values: [values.join(getIfsSeparator(ctx.state.env))],
                  quoted: true,
                };
              }
              // arr[@] - each element as a separate word (quoted)
              return { values, quoted: true };
            }
            // No array elements - check for scalar variable
            const scalarValue = ctx.state.env[arrayName];
            if (scalarValue !== undefined) {
              return { values: [scalarValue], quoted: true };
            }
            // Variable is unset - return empty
            return { values: [], quoted: true };
          }
          // Don't expand the alternative - return empty
          return { values: [], quoted: false };
        }
      }
    }
  }

  // Handle unquoted ${!ref+...} or ${!ref-...} where the word contains "${!ref}" (quoted indirect array expansion)
  // This handles patterns like: ${!hooksSlice+"${!hooksSlice}"} which should preserve element boundaries
  // In this case, the outer operation is Indirection with innerOp of UseAlternative/DefaultValue
  if (
    wordParts.length === 1 &&
    wordParts[0].type === "ParameterExpansion" &&
    wordParts[0].operation?.type === "Indirection"
  ) {
    const paramPart = wordParts[0];
    const indirOp = paramPart.operation as {
      type: "Indirection";
      innerOp?: {
        type: string;
        word?: WordNode;
        checkEmpty?: boolean;
      };
    };
    const innerOp = indirOp.innerOp;
    if (
      innerOp &&
      (innerOp.type === "UseAlternative" || innerOp.type === "DefaultValue")
    ) {
      const opWord = innerOp.word;
      // Check if the inner word is a quoted indirect expansion to an array
      if (
        opWord &&
        opWord.parts.length === 1 &&
        opWord.parts[0].type === "DoubleQuoted"
      ) {
        const innerDq = opWord.parts[0];
        if (
          innerDq.parts.length === 1 &&
          innerDq.parts[0].type === "ParameterExpansion" &&
          innerDq.parts[0].operation?.type === "Indirection"
        ) {
          const innerParam = innerDq.parts[0];
          // Get the value of the reference variable to see if it points to an array
          const refValue = getVariable(ctx, innerParam.parameter);
          const arrayMatch = refValue.match(
            /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
          );
          if (arrayMatch) {
            // For ${!ref+word}, we need to check if the *expanded* ref value exists
            // First, get what ref points to
            const outerRefValue = getVariable(ctx, paramPart.parameter);
            // Check if the target array is set
            const targetArrayMatch = outerRefValue.match(
              /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
            );
            let isSet = false;
            if (targetArrayMatch) {
              const targetArrayName = targetArrayMatch[1];
              const targetElements = getArrayElements(ctx, targetArrayName);
              isSet = targetElements.length > 0;
            } else {
              isSet = isVariableSet(ctx, outerRefValue);
            }

            // Note: checkEmpty would be used for :+ or :- variants, but since the indirect
            // expansion target is an array, checking empty doesn't apply in the same way
            // as it does for scalar variables. For now, we just check if the array is set.
            let shouldExpand: boolean;
            if (innerOp.type === "UseAlternative") {
              // ${!ref+word} - expand if the *target* (what ref points to) IS set
              shouldExpand = isSet;
            } else {
              // ${!ref-word} - expand if the *target* is NOT set
              shouldExpand = !isSet;
            }

            if (shouldExpand) {
              // Expand the inner indirect array reference
              const arrayName = arrayMatch[1];
              const isStar = arrayMatch[2] === "*";
              const elements = getArrayElements(ctx, arrayName);
              if (elements.length > 0) {
                const values = elements.map(([, v]) => v);
                if (isStar) {
                  // arr[*] - join with IFS into one word
                  return {
                    values: [values.join(getIfsSeparator(ctx.state.env))],
                    quoted: true,
                  };
                }
                // arr[@] - each element as a separate word (quoted)
                return { values, quoted: true };
              }
              // No array elements - check for scalar variable
              const scalarValue = ctx.state.env[arrayName];
              if (scalarValue !== undefined) {
                return { values: [scalarValue], quoted: true };
              }
              // Variable is unset - return empty
              return { values: [], quoted: true };
            }
            // Don't expand the alternative - return empty
            return { values: [], quoted: false };
          }
        }
      }
    }
  }

  // Handle "${@:offset}" and "${*:offset}" with Substring operations inside double quotes
  // "${@:offset}": Each sliced positional parameter becomes a separate word
  // "${*:offset}": All sliced params joined with IFS as ONE word
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    // Find if there's a ${@:offset} or ${*:offset} inside
    let sliceAtIndex = -1;
    let sliceIsStar = false;
    for (let i = 0; i < dqPart.parts.length; i++) {
      const p = dqPart.parts[i];
      if (
        p.type === "ParameterExpansion" &&
        (p.parameter === "@" || p.parameter === "*") &&
        p.operation?.type === "Substring"
      ) {
        sliceAtIndex = i;
        sliceIsStar = p.parameter === "*";
        break;
      }
    }

    if (sliceAtIndex !== -1) {
      const paramPart = dqPart.parts[sliceAtIndex] as ParameterExpansionPart;
      const operation = paramPart.operation as SubstringOp;

      // Evaluate offset and length
      const offset = operation.offset
        ? evaluateArithmeticSync(ctx, operation.offset.expression)
        : 0;
      const length = operation.length
        ? evaluateArithmeticSync(ctx, operation.length.expression)
        : undefined;

      // Get positional parameters
      const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
      const allParams: string[] = [];
      for (let i = 1; i <= numParams; i++) {
        allParams.push(ctx.state.env[String(i)] || "");
      }

      const shellName = ctx.state.env["0"] || "bash";

      // Build sliced params array
      let slicedParams: string[];
      if (offset <= 0) {
        // offset 0: include $0 at position 0
        const withZero = [shellName, ...allParams];
        const computedIdx = withZero.length + offset;
        // If negative offset goes beyond array bounds, return empty
        if (computedIdx < 0) {
          slicedParams = [];
        } else {
          const startIdx = offset < 0 ? computedIdx : 0;
          if (length !== undefined) {
            const endIdx =
              length < 0 ? withZero.length + length : startIdx + length;
            slicedParams = withZero.slice(startIdx, Math.max(startIdx, endIdx));
          } else {
            slicedParams = withZero.slice(startIdx);
          }
        }
      } else {
        // offset > 0: start from $<offset>
        const startIdx = offset - 1;
        if (startIdx >= allParams.length) {
          slicedParams = [];
        } else if (length !== undefined) {
          const endIdx =
            length < 0 ? allParams.length + length : startIdx + length;
          slicedParams = allParams.slice(startIdx, Math.max(startIdx, endIdx));
        } else {
          slicedParams = allParams.slice(startIdx);
        }
      }

      // Expand prefix (parts before ${@:...})
      let prefix = "";
      for (let i = 0; i < sliceAtIndex; i++) {
        prefix += await expandPart(ctx, dqPart.parts[i]);
      }

      // Expand suffix (parts after ${@:...})
      let suffix = "";
      for (let i = sliceAtIndex + 1; i < dqPart.parts.length; i++) {
        suffix += await expandPart(ctx, dqPart.parts[i]);
      }

      if (slicedParams.length === 0) {
        // No params after slicing -> prefix + suffix as one word
        const combined = prefix + suffix;
        return { values: combined ? [combined] : [], quoted: true };
      }

      if (sliceIsStar) {
        // "${*:offset}" - join all sliced params with IFS into one word
        const ifsSep = getIfsSeparator(ctx.state.env);
        return {
          values: [prefix + slicedParams.join(ifsSep) + suffix],
          quoted: true,
        };
      }

      // "${@:offset}" - each sliced param is a separate word
      if (slicedParams.length === 1) {
        return {
          values: [prefix + slicedParams[0] + suffix],
          quoted: true,
        };
      }

      const result = [
        prefix + slicedParams[0],
        ...slicedParams.slice(1, -1),
        slicedParams[slicedParams.length - 1] + suffix,
      ];
      return { values: result, quoted: true };
    }
  }

  // Handle "${@/pattern/replacement}" and "${*/pattern/replacement}" with PatternReplacement inside double quotes
  // "${@/pattern/replacement}": Each positional parameter has pattern replaced, each becomes a separate word
  // "${*/pattern/replacement}": All params joined with IFS, pattern replaced, becomes ONE word
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    // Find if there's a ${@/...} or ${*/...} inside
    let patReplAtIndex = -1;
    let patReplIsStar = false;
    for (let i = 0; i < dqPart.parts.length; i++) {
      const p = dqPart.parts[i];
      if (
        p.type === "ParameterExpansion" &&
        (p.parameter === "@" || p.parameter === "*") &&
        p.operation?.type === "PatternReplacement"
      ) {
        patReplAtIndex = i;
        patReplIsStar = p.parameter === "*";
        break;
      }
    }

    if (patReplAtIndex !== -1) {
      const paramPart = dqPart.parts[patReplAtIndex] as ParameterExpansionPart;
      const operation = paramPart.operation as {
        type: "PatternReplacement";
        pattern: WordNode;
        replacement: WordNode | null;
        all: boolean;
        anchor: "start" | "end" | null;
      };

      // Get positional parameters
      const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
      const params: string[] = [];
      for (let i = 1; i <= numParams; i++) {
        params.push(ctx.state.env[String(i)] || "");
      }

      // Expand prefix (parts before ${@/...})
      let prefix = "";
      for (let i = 0; i < patReplAtIndex; i++) {
        prefix += await expandPart(ctx, dqPart.parts[i]);
      }

      // Expand suffix (parts after ${@/...})
      let suffix = "";
      for (let i = patReplAtIndex + 1; i < dqPart.parts.length; i++) {
        suffix += await expandPart(ctx, dqPart.parts[i]);
      }

      if (numParams === 0) {
        const combined = prefix + suffix;
        return { values: combined ? [combined] : [], quoted: true };
      }

      // Build the replacement regex
      let regex = "";
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            regex += patternToRegex(
              part.pattern,
              true,
              ctx.state.shoptOptions.extglob,
            );
          } else if (part.type === "Literal") {
            regex += patternToRegex(
              part.value,
              true,
              ctx.state.shoptOptions.extglob,
            );
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            regex += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = await expandWordPartsAsync(ctx, part.parts);
            regex += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = await expandPart(ctx, part);
            regex += patternToRegex(
              expanded,
              true,
              ctx.state.shoptOptions.extglob,
            );
          } else {
            const expanded = await expandPart(ctx, part);
            regex += escapeRegex(expanded);
          }
        }
      }

      const replacement = operation.replacement
        ? await expandWordPartsAsync(ctx, operation.replacement.parts)
        : "";

      // Apply anchor modifiers
      let regexPattern = regex;
      if (operation.anchor === "start") {
        regexPattern = `^${regex}`;
      } else if (operation.anchor === "end") {
        regexPattern = `${regex}$`;
      }

      // Apply replacement to each param
      const replacedParams: string[] = [];
      try {
        const re = new RegExp(regexPattern, operation.all ? "g" : "");
        for (const param of params) {
          replacedParams.push(param.replace(re, replacement));
        }
      } catch {
        // Invalid regex - return params unchanged
        replacedParams.push(...params);
      }

      if (patReplIsStar) {
        // "${*/...}" - join all params with IFS into one word
        const ifsSep = getIfsSeparator(ctx.state.env);
        return {
          values: [prefix + replacedParams.join(ifsSep) + suffix],
          quoted: true,
        };
      }

      // "${@/...}" - each param is a separate word
      if (replacedParams.length === 1) {
        return {
          values: [prefix + replacedParams[0] + suffix],
          quoted: true,
        };
      }

      const result = [
        prefix + replacedParams[0],
        ...replacedParams.slice(1, -1),
        replacedParams[replacedParams.length - 1] + suffix,
      ];
      return { values: result, quoted: true };
    }
  }

  // Handle "${@#pattern}" and "${*#pattern}" - positional parameter pattern removal (strip)
  // "${@#pattern}": Remove shortest matching prefix from each parameter, each becomes a separate word
  // "${@##pattern}": Remove longest matching prefix from each parameter
  // "${@%pattern}": Remove shortest matching suffix from each parameter
  // "${@%%pattern}": Remove longest matching suffix from each parameter
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    // Find if there's a ${@#...} or ${*#...} inside
    let patRemAtIndex = -1;
    let patRemIsStar = false;
    for (let i = 0; i < dqPart.parts.length; i++) {
      const p = dqPart.parts[i];
      if (
        p.type === "ParameterExpansion" &&
        (p.parameter === "@" || p.parameter === "*") &&
        p.operation?.type === "PatternRemoval"
      ) {
        patRemAtIndex = i;
        patRemIsStar = p.parameter === "*";
        break;
      }
    }

    if (patRemAtIndex !== -1) {
      const paramPart = dqPart.parts[patRemAtIndex] as ParameterExpansionPart;
      const operation = paramPart.operation as {
        type: "PatternRemoval";
        pattern: WordNode;
        side: "prefix" | "suffix";
        greedy: boolean;
      };

      // Get positional parameters
      const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
      const params: string[] = [];
      for (let i = 1; i <= numParams; i++) {
        params.push(ctx.state.env[String(i)] || "");
      }

      // Expand prefix (parts before ${@#...})
      let prefix = "";
      for (let i = 0; i < patRemAtIndex; i++) {
        prefix += await expandPart(ctx, dqPart.parts[i]);
      }

      // Expand suffix (parts after ${@#...})
      let suffix = "";
      for (let i = patRemAtIndex + 1; i < dqPart.parts.length; i++) {
        suffix += await expandPart(ctx, dqPart.parts[i]);
      }

      if (numParams === 0) {
        const combined = prefix + suffix;
        return { values: combined ? [combined] : [], quoted: true };
      }

      // Build the regex pattern
      let regexStr = "";
      const extglob = ctx.state.shoptOptions.extglob;
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            regexStr += patternToRegex(part.pattern, operation.greedy, extglob);
          } else if (part.type === "Literal") {
            regexStr += patternToRegex(part.value, operation.greedy, extglob);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            regexStr += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = await expandWordPartsAsync(ctx, part.parts);
            regexStr += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = await expandPart(ctx, part);
            regexStr += patternToRegex(expanded, operation.greedy, extglob);
          } else {
            const expanded = await expandPart(ctx, part);
            regexStr += escapeRegex(expanded);
          }
        }
      }

      // Apply pattern removal to each param
      const strippedParams: string[] = [];
      for (const param of params) {
        strippedParams.push(
          applyPatternRemoval(
            param,
            regexStr,
            operation.side,
            operation.greedy,
          ),
        );
      }

      if (patRemIsStar) {
        // "${*#...}" - join all params with IFS into one word
        const ifsSep = getIfsSeparator(ctx.state.env);
        return {
          values: [prefix + strippedParams.join(ifsSep) + suffix],
          quoted: true,
        };
      }

      // "${@#...}" - each param is a separate word
      if (strippedParams.length === 1) {
        return {
          values: [prefix + strippedParams[0] + suffix],
          quoted: true,
        };
      }

      const result = [
        prefix + strippedParams[0],
        ...strippedParams.slice(1, -1),
        strippedParams[strippedParams.length - 1] + suffix,
      ];
      return { values: result, quoted: true };
    }
  }

  // Handle "$@" and "$*" with adjacent text inside double quotes, e.g., "-$@-"
  // "$@": Each positional parameter becomes a separate word, with prefix joined to first
  //       and suffix joined to last. If no params, produces nothing (or just prefix+suffix if present)
  // "$*": All params joined with IFS as ONE word. If no params, produces one empty word.
  if (wordParts.length === 1 && wordParts[0].type === "DoubleQuoted") {
    const dqPart = wordParts[0];
    // Find if there's a $@ or $* inside
    let atIndex = -1;
    let isStar = false;
    for (let i = 0; i < dqPart.parts.length; i++) {
      const p = dqPart.parts[i];
      if (
        p.type === "ParameterExpansion" &&
        (p.parameter === "@" || p.parameter === "*")
      ) {
        atIndex = i;
        isStar = p.parameter === "*";
        break;
      }
    }

    if (atIndex !== -1) {
      // Check if this is a simple $@ or $* without operations like ${*-default}
      const paramPart = dqPart.parts[atIndex];
      if (paramPart.type === "ParameterExpansion" && paramPart.operation) {
        // Has an operation - let normal expansion handle it
        atIndex = -1;
      }
    }

    if (atIndex !== -1) {
      // Get positional parameters
      const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);

      // Expand prefix (parts before $@/$*)
      let prefix = "";
      for (let i = 0; i < atIndex; i++) {
        prefix += await expandPart(ctx, dqPart.parts[i]);
      }

      // Expand suffix (parts after $@/$*)
      let suffix = "";
      for (let i = atIndex + 1; i < dqPart.parts.length; i++) {
        suffix += await expandPart(ctx, dqPart.parts[i]);
      }

      if (numParams === 0) {
        if (isStar) {
          // "$*" with no params -> one empty word (prefix + suffix)
          return { values: [prefix + suffix], quoted: true };
        }
        // "$@" with no params -> no words (unless there's prefix/suffix)
        const combined = prefix + suffix;
        return { values: combined ? [combined] : [], quoted: true };
      }

      // Get individual positional parameters
      const params: string[] = [];
      for (let i = 1; i <= numParams; i++) {
        params.push(ctx.state.env[String(i)] || "");
      }

      if (isStar) {
        // "$*" - join all params with IFS into one word
        const ifsSep = getIfsSeparator(ctx.state.env);
        return {
          values: [prefix + params.join(ifsSep) + suffix],
          quoted: true,
        };
      }

      // "$@" - each param is a separate word
      // Join prefix with first, suffix with last
      if (params.length === 1) {
        return { values: [prefix + params[0] + suffix], quoted: true };
      }

      const result = [
        prefix + params[0],
        ...params.slice(1, -1),
        params[params.length - 1] + suffix,
      ];
      return { values: result, quoted: true };
    }
  }

  // Handle unquoted ${array[@]/pattern/replacement} - apply to each element
  // This handles ${array[@]/#/prefix} (prepend) and ${array[@]/%/suffix} (append)
  {
    let unquotedArrayPatReplIdx = -1;
    let unquotedArrayName = "";
    let unquotedArrayIsStar = false;
    for (let i = 0; i < wordParts.length; i++) {
      const p = wordParts[i];
      if (
        p.type === "ParameterExpansion" &&
        p.operation?.type === "PatternReplacement"
      ) {
        const arrayMatch = p.parameter.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
        );
        if (arrayMatch) {
          unquotedArrayPatReplIdx = i;
          unquotedArrayName = arrayMatch[1];
          unquotedArrayIsStar = arrayMatch[2] === "*";
          break;
        }
      }
    }

    if (unquotedArrayPatReplIdx !== -1) {
      const paramPart = wordParts[
        unquotedArrayPatReplIdx
      ] as ParameterExpansionPart;
      const operation = paramPart.operation as {
        type: "PatternReplacement";
        pattern: WordNode;
        replacement: WordNode | null;
        all: boolean;
        anchor: "start" | "end" | null;
      };

      // Get array elements
      const elements = getArrayElements(ctx, unquotedArrayName);
      let values = elements.map(([, v]) => v);

      // If no elements, check for scalar (treat as single-element array)
      if (elements.length === 0) {
        const scalarValue = ctx.state.env[unquotedArrayName];
        if (scalarValue !== undefined) {
          values = [scalarValue];
        }
      }

      if (values.length === 0) {
        return { values: [], quoted: false };
      }

      // Build the replacement regex
      let regex = "";
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            regex += patternToRegex(
              part.pattern,
              true,
              ctx.state.shoptOptions.extglob,
            );
          } else if (part.type === "Literal") {
            regex += patternToRegex(
              part.value,
              true,
              ctx.state.shoptOptions.extglob,
            );
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            regex += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = await expandWordPartsAsync(ctx, part.parts);
            regex += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = await expandPart(ctx, part);
            regex += patternToRegex(
              expanded,
              true,
              ctx.state.shoptOptions.extglob,
            );
          } else {
            const expanded = await expandPart(ctx, part);
            regex += escapeRegex(expanded);
          }
        }
      }

      const replacement = operation.replacement
        ? await expandWordPartsAsync(ctx, operation.replacement.parts)
        : "";

      // Apply anchor modifiers
      let regexPattern = regex;
      if (operation.anchor === "start") {
        regexPattern = `^${regex}`;
      } else if (operation.anchor === "end") {
        regexPattern = `${regex}$`;
      }

      // Apply replacement to each element
      const replacedValues: string[] = [];
      try {
        const re = new RegExp(regexPattern, operation.all ? "g" : "");
        for (const value of values) {
          replacedValues.push(value.replace(re, replacement));
        }
      } catch {
        // Invalid regex - return values unchanged
        replacedValues.push(...values);
      }

      // For unquoted, we need to IFS-split the result
      const ifsChars = getIfs(ctx.state.env);
      const ifsEmpty = isIfsEmpty(ctx.state.env);

      if (unquotedArrayIsStar) {
        // ${arr[*]/...} unquoted - join with IFS, then split
        const ifsSep = getIfsSeparator(ctx.state.env);
        const joined = replacedValues.join(ifsSep);
        if (ifsEmpty) {
          return { values: joined ? [joined] : [], quoted: false };
        }
        return {
          values: splitByIfsForExpansion(joined, ifsChars),
          quoted: false,
        };
      }

      // ${arr[@]/...} unquoted - each element separate, then IFS-split each
      if (ifsEmpty) {
        return { values: replacedValues, quoted: false };
      }

      const allWords: string[] = [];
      for (const val of replacedValues) {
        if (val === "") {
          allWords.push("");
        } else {
          allWords.push(...splitByIfsForExpansion(val, ifsChars));
        }
      }
      return { values: allWords, quoted: false };
    }
  }

  // Handle unquoted ${array[@]#pattern} - apply pattern removal to each element
  // This handles ${array[@]#pattern} (strip shortest prefix), ${array[@]##pattern} (strip longest prefix)
  // ${array[@]%pattern} (strip shortest suffix), ${array[@]%%pattern} (strip longest suffix)
  {
    let unquotedArrayPatRemIdx = -1;
    let unquotedArrayName = "";
    let unquotedArrayIsStar = false;
    for (let i = 0; i < wordParts.length; i++) {
      const p = wordParts[i];
      if (
        p.type === "ParameterExpansion" &&
        p.operation?.type === "PatternRemoval"
      ) {
        const arrayMatch = p.parameter.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
        );
        if (arrayMatch) {
          unquotedArrayPatRemIdx = i;
          unquotedArrayName = arrayMatch[1];
          unquotedArrayIsStar = arrayMatch[2] === "*";
          break;
        }
      }
    }

    if (unquotedArrayPatRemIdx !== -1) {
      const paramPart = wordParts[
        unquotedArrayPatRemIdx
      ] as ParameterExpansionPart;
      const operation = paramPart.operation as {
        type: "PatternRemoval";
        pattern: WordNode;
        side: "prefix" | "suffix";
        greedy: boolean;
      };

      // Get array elements
      const elements = getArrayElements(ctx, unquotedArrayName);
      let values = elements.map(([, v]) => v);

      // If no elements, check for scalar (treat as single-element array)
      if (elements.length === 0) {
        const scalarValue = ctx.state.env[unquotedArrayName];
        if (scalarValue !== undefined) {
          values = [scalarValue];
        }
      }

      if (values.length === 0) {
        return { values: [], quoted: false };
      }

      // Build the regex pattern
      let regexStr = "";
      const extglob = ctx.state.shoptOptions.extglob;
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            regexStr += patternToRegex(part.pattern, operation.greedy, extglob);
          } else if (part.type === "Literal") {
            regexStr += patternToRegex(part.value, operation.greedy, extglob);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            regexStr += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = await expandWordPartsAsync(ctx, part.parts);
            regexStr += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = await expandPart(ctx, part);
            regexStr += patternToRegex(expanded, operation.greedy, extglob);
          } else {
            const expanded = await expandPart(ctx, part);
            regexStr += escapeRegex(expanded);
          }
        }
      }

      // Apply pattern removal to each element
      const strippedValues: string[] = [];
      for (const value of values) {
        strippedValues.push(
          applyPatternRemoval(
            value,
            regexStr,
            operation.side,
            operation.greedy,
          ),
        );
      }

      // For unquoted, we need to IFS-split the result
      const ifsChars = getIfs(ctx.state.env);
      const ifsEmpty = isIfsEmpty(ctx.state.env);

      if (unquotedArrayIsStar) {
        // ${arr[*]#...} unquoted - join with IFS, then split
        const ifsSep = getIfsSeparator(ctx.state.env);
        const joined = strippedValues.join(ifsSep);
        if (ifsEmpty) {
          return { values: joined ? [joined] : [], quoted: false };
        }
        return {
          values: splitByIfsForExpansion(joined, ifsChars),
          quoted: false,
        };
      }

      // ${arr[@]#...} unquoted - each element separate, then IFS-split each
      if (ifsEmpty) {
        return { values: strippedValues, quoted: false };
      }

      const allWords: string[] = [];
      for (const val of strippedValues) {
        if (val === "") {
          allWords.push("");
        } else {
          allWords.push(...splitByIfsForExpansion(val, ifsChars));
        }
      }
      return { values: allWords, quoted: false };
    }
  }

  // Handle unquoted ${@#pattern} and ${*#pattern} - apply pattern removal to each positional parameter
  // This handles ${@#pattern} (strip shortest prefix), ${@##pattern} (strip longest prefix)
  // ${@%pattern} (strip shortest suffix), ${@%%pattern} (strip longest suffix)
  {
    let unquotedPosPatRemIdx = -1;
    let unquotedPosPatRemIsStar = false;
    for (let i = 0; i < wordParts.length; i++) {
      const p = wordParts[i];
      if (
        p.type === "ParameterExpansion" &&
        (p.parameter === "@" || p.parameter === "*") &&
        p.operation?.type === "PatternRemoval"
      ) {
        unquotedPosPatRemIdx = i;
        unquotedPosPatRemIsStar = p.parameter === "*";
        break;
      }
    }

    if (unquotedPosPatRemIdx !== -1) {
      const paramPart = wordParts[
        unquotedPosPatRemIdx
      ] as ParameterExpansionPart;
      const operation = paramPart.operation as {
        type: "PatternRemoval";
        pattern: WordNode;
        side: "prefix" | "suffix";
        greedy: boolean;
      };

      // Get positional parameters
      const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
      const params: string[] = [];
      for (let i = 1; i <= numParams; i++) {
        params.push(ctx.state.env[String(i)] || "");
      }

      if (params.length === 0) {
        return { values: [], quoted: false };
      }

      // Build the regex pattern
      let regexStr = "";
      const extglob = ctx.state.shoptOptions.extglob;
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            regexStr += patternToRegex(part.pattern, operation.greedy, extglob);
          } else if (part.type === "Literal") {
            regexStr += patternToRegex(part.value, operation.greedy, extglob);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            regexStr += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = await expandWordPartsAsync(ctx, part.parts);
            regexStr += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = await expandPart(ctx, part);
            regexStr += patternToRegex(expanded, operation.greedy, extglob);
          } else {
            const expanded = await expandPart(ctx, part);
            regexStr += escapeRegex(expanded);
          }
        }
      }

      // Apply pattern removal to each positional parameter
      const strippedParams: string[] = [];
      for (const param of params) {
        strippedParams.push(
          applyPatternRemoval(
            param,
            regexStr,
            operation.side,
            operation.greedy,
          ),
        );
      }

      // For unquoted, we need to IFS-split the result
      const ifsChars = getIfs(ctx.state.env);
      const ifsEmpty = isIfsEmpty(ctx.state.env);

      if (unquotedPosPatRemIsStar) {
        // ${*#...} unquoted - join with IFS, then split
        const ifsSep = getIfsSeparator(ctx.state.env);
        const joined = strippedParams.join(ifsSep);
        if (ifsEmpty) {
          return { values: joined ? [joined] : [], quoted: false };
        }
        return {
          values: splitByIfsForExpansion(joined, ifsChars),
          quoted: false,
        };
      }

      // ${@#...} unquoted - each param separate, then IFS-split each
      if (ifsEmpty) {
        return { values: strippedParams, quoted: false };
      }

      const allWords: string[] = [];
      for (const val of strippedParams) {
        if (val === "") {
          allWords.push("");
        } else {
          allWords.push(...splitByIfsForExpansion(val, ifsChars));
        }
      }
      return { values: allWords, quoted: false };
    }
  }

  // Special handling for unquoted ${@:offset} and ${*:offset} (with potential prefix/suffix)
  // Find if there's a ${@:offset} or ${*:offset} in the word parts
  {
    let unquotedSliceAtIndex = -1;
    let unquotedSliceIsStar = false;
    for (let i = 0; i < wordParts.length; i++) {
      const p = wordParts[i];
      // console.log('DEBUG checking part', i, ':', JSON.stringify(p));
      if (
        p.type === "ParameterExpansion" &&
        (p.parameter === "@" || p.parameter === "*") &&
        p.operation?.type === "Substring"
      ) {
        unquotedSliceAtIndex = i;
        unquotedSliceIsStar = p.parameter === "*";
        // console.log('DEBUG: Found unquoted slice at index', i, 'isStar:', unquotedSliceIsStar);
        break;
      }
    }

    if (unquotedSliceAtIndex !== -1) {
      // console.log("DEBUG: Entering unquoted slice handler");
      const paramPart = wordParts[
        unquotedSliceAtIndex
      ] as ParameterExpansionPart;
      const operation = paramPart.operation as SubstringOp;

      // Evaluate offset and length
      const offset = operation.offset
        ? evaluateArithmeticSync(ctx, operation.offset.expression)
        : 0;
      const length = operation.length
        ? evaluateArithmeticSync(ctx, operation.length.expression)
        : undefined;

      // Get positional parameters
      const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
      const allParams: string[] = [];
      for (let i = 1; i <= numParams; i++) {
        allParams.push(ctx.state.env[String(i)] || "");
      }

      const shellName = ctx.state.env["0"] || "bash";

      // Build sliced params array
      let slicedParams: string[];
      if (offset <= 0) {
        // offset 0: include $0 at position 0
        const withZero = [shellName, ...allParams];
        const computedIdx = withZero.length + offset;
        // If negative offset goes beyond array bounds, return empty
        if (computedIdx < 0) {
          slicedParams = [];
        } else {
          const startIdx = offset < 0 ? computedIdx : 0;
          if (length !== undefined) {
            const endIdx =
              length < 0 ? withZero.length + length : startIdx + length;
            slicedParams = withZero.slice(startIdx, Math.max(startIdx, endIdx));
          } else {
            slicedParams = withZero.slice(startIdx);
          }
        }
      } else {
        // offset > 0: start from $<offset>
        const startIdx = offset - 1;
        if (startIdx >= allParams.length) {
          slicedParams = [];
        } else if (length !== undefined) {
          const endIdx =
            length < 0 ? allParams.length + length : startIdx + length;
          slicedParams = allParams.slice(startIdx, Math.max(startIdx, endIdx));
        } else {
          slicedParams = allParams.slice(startIdx);
        }
      }

      // Expand prefix (parts before ${@:...})
      let prefix = "";
      for (let i = 0; i < unquotedSliceAtIndex; i++) {
        prefix += await expandPart(ctx, wordParts[i]);
      }

      // Expand suffix (parts after ${@:...})
      let suffix = "";
      for (let i = unquotedSliceAtIndex + 1; i < wordParts.length; i++) {
        suffix += await expandPart(ctx, wordParts[i]);
      }

      // For unquoted, we need to IFS-split the result
      const ifsChars = getIfs(ctx.state.env);
      const ifsEmpty = isIfsEmpty(ctx.state.env);

      if (slicedParams.length === 0) {
        // No params after slicing -> prefix + suffix as one word (may still need splitting)
        const combined = prefix + suffix;
        if (!combined) {
          return { values: [], quoted: false };
        }
        if (ifsEmpty) {
          return { values: [combined], quoted: false };
        }
        return {
          values: splitByIfsForExpansion(combined, ifsChars),
          quoted: false,
        };
      }

      let allWords: string[];

      if (unquotedSliceIsStar) {
        // ${*:offset} unquoted - join all sliced params with IFS, then split result
        const ifsSep = getIfsSeparator(ctx.state.env);
        const joined = prefix + slicedParams.join(ifsSep) + suffix;
        // console.log('DEBUG: slicedParams:', JSON.stringify(slicedParams));
        // console.log('DEBUG: prefix:', JSON.stringify(prefix), 'suffix:', JSON.stringify(suffix));
        // console.log('DEBUG: joined:', JSON.stringify(joined));
        // console.log('DEBUG: ifsEmpty:', ifsEmpty, 'ifsChars:', JSON.stringify(ifsChars));

        if (ifsEmpty) {
          allWords = joined ? [joined] : [];
        } else {
          allWords = splitByIfsForExpansion(joined, ifsChars);
          // console.log('DEBUG: allWords after split:', JSON.stringify(allWords));
        }
      } else {
        // ${@:offset} unquoted - each sliced param is separate, then IFS-split each
        // Prefix attaches to first, suffix attaches to last
        if (ifsEmpty) {
          // No splitting - just attach prefix/suffix
          if (slicedParams.length === 1) {
            allWords = [prefix + slicedParams[0] + suffix];
          } else {
            allWords = [
              prefix + slicedParams[0],
              ...slicedParams.slice(1, -1),
              slicedParams[slicedParams.length - 1] + suffix,
            ];
          }
        } else {
          // IFS-split each parameter
          allWords = [];
          for (let i = 0; i < slicedParams.length; i++) {
            let param = slicedParams[i];
            if (i === 0) param = prefix + param;
            if (i === slicedParams.length - 1) param = param + suffix;

            if (param === "") {
              allWords.push("");
            } else {
              const parts = splitByIfsForExpansion(param, ifsChars);
              allWords.push(...parts);
            }
          }
        }
      }

      // Apply glob expansion to each word
      if (ctx.state.options.noglob) {
        return { values: allWords, quoted: false };
      }

      const globExpander = new GlobExpander(
        ctx.fs,
        ctx.state.cwd,
        ctx.state.env,
        {
          globstar: ctx.state.shoptOptions.globstar,
          nullglob: ctx.state.shoptOptions.nullglob,
          failglob: ctx.state.shoptOptions.failglob,
          dotglob: ctx.state.shoptOptions.dotglob,
          extglob: ctx.state.shoptOptions.extglob,
          globskipdots: ctx.state.shoptOptions.globskipdots,
        },
      );

      const expandedValues: string[] = [];
      for (const w of allWords) {
        if (hasGlobPattern(w, ctx.state.shoptOptions.extglob)) {
          const matches = await globExpander.expand(w);
          if (matches.length > 0) {
            expandedValues.push(...matches);
          } else if (globExpander.hasFailglob()) {
            throw new GlobError(w);
          } else if (globExpander.hasNullglob()) {
            // skip
          } else {
            expandedValues.push(w);
          }
        } else {
          expandedValues.push(w);
        }
      }
      // console.log("DEBUG: returning values:", JSON.stringify(expandedValues));
      return { values: expandedValues, quoted: false };
    }
  }

  // Special handling for unquoted $@ and $*
  // $@ unquoted: Each positional parameter becomes a separate word, then each is subject to IFS splitting
  // $* unquoted: All params are joined by IFS[0], then the result is split by IFS
  //
  // Key difference:
  // - $@ preserves parameter boundaries first, then splits each
  // - $* joins first, then splits (so empty params may collapse)
  if (
    wordParts.length === 1 &&
    wordParts[0].type === "ParameterExpansion" &&
    (wordParts[0].parameter === "@" || wordParts[0].parameter === "*") &&
    !wordParts[0].operation
  ) {
    const isStar = wordParts[0].parameter === "*";
    const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
    if (numParams === 0) {
      return { values: [], quoted: false };
    }

    // Get individual positional parameters
    const params: string[] = [];
    for (let i = 1; i <= numParams; i++) {
      params.push(ctx.state.env[String(i)] || "");
    }

    const ifsChars = getIfs(ctx.state.env);
    const ifsEmpty = isIfsEmpty(ctx.state.env);
    // Check if IFS contains only whitespace - this affects empty param handling
    // With whitespace-only IFS, empty params are dropped
    // With non-whitespace IFS, empty params are preserved (they create explicit fields)
    const ifsWhitespaceOnly = isIfsWhitespaceOnly(ctx.state.env);

    let allWords: string[];

    if (isStar) {
      // $* - join params with IFS[0], then split result by IFS
      // HOWEVER: When IFS is empty, bash keeps params separate (like $@) for unquoted $*
      // The joining with empty IFS only applies to quoted "$*"
      if (ifsEmpty) {
        // Empty IFS - keep params separate (same as $@), filter out empty params
        allWords = params.filter((p) => p !== "");
      } else {
        const ifsSep = getIfsSeparator(ctx.state.env);
        const joined = params.join(ifsSep);
        // Split the joined string by IFS using proper splitting rules
        // Note: splitByIfsForExpansion handles empty fields correctly based on IFS content
        allWords = splitByIfsForExpansion(joined, ifsChars);
      }
    } else {
      // $@ - each param is a separate word, then each is subject to IFS splitting
      // - With whitespace-only IFS: empty params are dropped (collapsed by word splitting)
      // - With non-whitespace IFS: empty params are preserved (they become explicit fields)
      if (ifsEmpty) {
        // Empty IFS - no splitting, filter out empty params
        allWords = params.filter((p) => p !== "");
      } else if (ifsWhitespaceOnly) {
        // Whitespace-only IFS - empty params are dropped
        allWords = [];
        for (const param of params) {
          if (param === "") {
            // Skip empty params - they would be collapsed by whitespace splitting anyway
            continue;
          }
          // Split this param by IFS using proper splitting rules
          const parts = splitByIfsForExpansion(param, ifsChars);
          allWords.push(...parts);
        }
      } else {
        // Non-whitespace IFS - preserve empty params EXCEPT trailing ones
        // This matches bash behavior where middle empties are preserved but trailing ones are dropped
        allWords = [];
        for (const param of params) {
          if (param === "") {
            // Preserve empty params with non-whitespace IFS (for now - we'll trim trailing later)
            allWords.push("");
          } else {
            // Split this param by IFS using proper splitting rules
            const parts = splitByIfsForExpansion(param, ifsChars);
            allWords.push(...parts);
          }
        }
        // Remove trailing empty strings - bash drops trailing empty params for unquoted $@
        while (allWords.length > 0 && allWords[allWords.length - 1] === "") {
          allWords.pop();
        }
      }
    }

    // Apply glob expansion to each word
    if (ctx.state.options.noglob) {
      return { values: allWords, quoted: false };
    }

    const globExpander = new GlobExpander(
      ctx.fs,
      ctx.state.cwd,
      ctx.state.env,
      {
        globstar: ctx.state.shoptOptions.globstar,
        nullglob: ctx.state.shoptOptions.nullglob,
        failglob: ctx.state.shoptOptions.failglob,
        dotglob: ctx.state.shoptOptions.dotglob,
        extglob: ctx.state.shoptOptions.extglob,
        globskipdots: ctx.state.shoptOptions.globskipdots,
      },
    );

    const expandedValues: string[] = [];
    for (const w of allWords) {
      if (hasGlobPattern(w, ctx.state.shoptOptions.extglob)) {
        const matches = await globExpander.expand(w);
        if (matches.length > 0) {
          expandedValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          throw new GlobError(w);
        } else if (globExpander.hasNullglob()) {
          // skip
        } else {
          expandedValues.push(w);
        }
      } else {
        expandedValues.push(w);
      }
    }

    return { values: expandedValues, quoted: false };
  }

  // Special handling for unquoted ${arr[@]} and ${arr[*]} (without operations)
  // Similar to $@ and $* handling above, but for arrays.
  // ${arr[@]} unquoted: Each array element becomes a separate word, then each is subject to IFS splitting
  // ${arr[*]} unquoted: When IFS is non-empty, join with IFS[0] then split by IFS
  //                     When IFS is empty, keep elements separate (like $@)
  if (
    wordParts.length === 1 &&
    wordParts[0].type === "ParameterExpansion" &&
    !wordParts[0].operation
  ) {
    const arrayMatch = wordParts[0].parameter.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
    );
    if (arrayMatch) {
      const arrayName = arrayMatch[1];
      const isStar = arrayMatch[2] === "*";

      // Get array elements
      const elements = getArrayElements(ctx, arrayName);

      // If no array elements, check for scalar (treat as single-element array)
      let values: string[];
      if (elements.length === 0) {
        const scalarValue = ctx.state.env[arrayName];
        if (scalarValue !== undefined) {
          values = [scalarValue];
        } else {
          return { values: [], quoted: false };
        }
      } else {
        values = elements.map(([, v]) => v);
      }

      const ifsChars = getIfs(ctx.state.env);
      const ifsEmpty = isIfsEmpty(ctx.state.env);
      const ifsWhitespaceOnly = isIfsWhitespaceOnly(ctx.state.env);

      let allWords: string[];

      if (isStar) {
        // ${arr[*]} unquoted - join with IFS[0], then split result by IFS
        // When IFS is empty, keep elements separate (like arr[@])
        if (ifsEmpty) {
          // Empty IFS - keep elements separate (same as arr[@]), filter out empty elements
          allWords = values.filter((v) => v !== "");
        } else {
          const ifsSep = getIfsSeparator(ctx.state.env);
          const joined = values.join(ifsSep);
          allWords = splitByIfsForExpansion(joined, ifsChars);
        }
      } else {
        // ${arr[@]} unquoted - each element is a separate word, then each is subject to IFS splitting
        if (ifsEmpty) {
          // Empty IFS - no splitting, filter out empty elements
          allWords = values.filter((v) => v !== "");
        } else if (ifsWhitespaceOnly) {
          // Whitespace-only IFS - empty elements are dropped
          allWords = [];
          for (const val of values) {
            if (val === "") {
              continue;
            }
            const parts = splitByIfsForExpansion(val, ifsChars);
            allWords.push(...parts);
          }
        } else {
          // Non-whitespace IFS - preserve empty elements
          allWords = [];
          for (const val of values) {
            if (val === "") {
              allWords.push("");
            } else {
              const parts = splitByIfsForExpansion(val, ifsChars);
              allWords.push(...parts);
            }
          }
          // Remove trailing empty strings
          while (allWords.length > 0 && allWords[allWords.length - 1] === "") {
            allWords.pop();
          }
        }
      }

      // Apply glob expansion to each word
      if (ctx.state.options.noglob) {
        return { values: allWords, quoted: false };
      }

      const globExpander = new GlobExpander(
        ctx.fs,
        ctx.state.cwd,
        ctx.state.env,
        {
          globstar: ctx.state.shoptOptions.globstar,
          nullglob: ctx.state.shoptOptions.nullglob,
          failglob: ctx.state.shoptOptions.failglob,
          dotglob: ctx.state.shoptOptions.dotglob,
          extglob: ctx.state.shoptOptions.extglob,
          globskipdots: ctx.state.shoptOptions.globskipdots,
        },
      );

      const expandedValues: string[] = [];
      for (const w of allWords) {
        if (hasGlobPattern(w, ctx.state.shoptOptions.extglob)) {
          const matches = await globExpander.expand(w);
          if (matches.length > 0) {
            expandedValues.push(...matches);
          } else if (globExpander.hasFailglob()) {
            throw new GlobError(w);
          } else if (globExpander.hasNullglob()) {
            // skip
          } else {
            expandedValues.push(w);
          }
        } else {
          expandedValues.push(w);
        }
      }

      return { values: expandedValues, quoted: false };
    }
  }

  // Special handling for unquoted ${!prefix@} and ${!prefix*} (variable name prefix expansion)
  // ${!prefix@} unquoted: Each variable name becomes a separate word, then each is subject to IFS splitting
  // ${!prefix*} unquoted: When IFS is non-empty, join with IFS[0] then split by IFS
  //                       When IFS is empty, keep names separate (like prefix@)
  if (
    wordParts.length === 1 &&
    wordParts[0].type === "ParameterExpansion" &&
    wordParts[0].operation?.type === "VarNamePrefix"
  ) {
    const op = wordParts[0].operation as {
      type: "VarNamePrefix";
      prefix: string;
      star: boolean;
    };
    const matchingVars = getVarNamesWithPrefix(ctx, op.prefix);

    if (matchingVars.length === 0) {
      return { values: [], quoted: false };
    }

    const ifsChars = getIfs(ctx.state.env);
    const ifsEmpty = isIfsEmpty(ctx.state.env);

    let allWords: string[];

    if (op.star) {
      // ${!prefix*} unquoted - join with IFS[0], then split result by IFS
      // When IFS is empty, keep names separate (like prefix@)
      if (ifsEmpty) {
        // Empty IFS - keep names separate
        allWords = matchingVars;
      } else {
        const ifsSep = getIfsSeparator(ctx.state.env);
        const joined = matchingVars.join(ifsSep);
        allWords = splitByIfsForExpansion(joined, ifsChars);
      }
    } else {
      // ${!prefix@} unquoted - each name is a separate word, then each is subject to IFS splitting
      if (ifsEmpty) {
        // Empty IFS - no splitting
        allWords = matchingVars;
      } else {
        allWords = [];
        for (const name of matchingVars) {
          const parts = splitByIfsForExpansion(name, ifsChars);
          allWords.push(...parts);
        }
      }
    }

    return { values: allWords, quoted: false };
  }

  // Special handling for unquoted ${!arr[@]} and ${!arr[*]} (array keys/indices expansion)
  // ${!arr[@]} unquoted: Each key/index becomes a separate word, then each is subject to IFS splitting
  // ${!arr[*]} unquoted: When IFS is non-empty, join with IFS[0] then split by IFS
  //                      When IFS is empty, keep keys separate (like arr[@])
  if (
    wordParts.length === 1 &&
    wordParts[0].type === "ParameterExpansion" &&
    wordParts[0].operation?.type === "ArrayKeys"
  ) {
    const op = wordParts[0].operation as {
      type: "ArrayKeys";
      array: string;
      star: boolean;
    };
    const elements = getArrayElements(ctx, op.array);
    const keys = elements.map(([k]) => String(k));

    if (keys.length === 0) {
      return { values: [], quoted: false };
    }

    const ifsChars = getIfs(ctx.state.env);
    const ifsEmpty = isIfsEmpty(ctx.state.env);

    let allWords: string[];

    if (op.star) {
      // ${!arr[*]} unquoted - join with IFS[0], then split result by IFS
      // When IFS is empty, keep keys separate (like arr[@])
      if (ifsEmpty) {
        // Empty IFS - keep keys separate
        allWords = keys;
      } else {
        const ifsSep = getIfsSeparator(ctx.state.env);
        const joined = keys.join(ifsSep);
        allWords = splitByIfsForExpansion(joined, ifsChars);
      }
    } else {
      // ${!arr[@]} unquoted - each key is a separate word, then each is subject to IFS splitting
      if (ifsEmpty) {
        // Empty IFS - no splitting
        allWords = keys;
      } else {
        allWords = [];
        for (const key of keys) {
          const parts = splitByIfsForExpansion(key, ifsChars);
          allWords.push(...parts);
        }
      }
    }

    return { values: allWords, quoted: false };
  }

  // Special handling for unquoted $@ or $* with prefix/suffix (e.g., =$@= or =$*=)
  // When positional params are all empty strings, they should create word boundaries
  // Result: =$@= with params "" "" "" "" "" -> ["=", "="] (two words)
  // The algorithm:
  // 1. Each param becomes a separate word
  // 2. Prefix joins with first param, suffix joins with last param
  // 3. Then filter out empty words (with whitespace IFS) or preserve them (non-whitespace IFS)
  {
    let unquotedAtStarIndex = -1;
    for (let i = 0; i < wordParts.length; i++) {
      const p = wordParts[i];
      if (
        p.type === "ParameterExpansion" &&
        (p.parameter === "@" || p.parameter === "*") &&
        !p.operation
      ) {
        unquotedAtStarIndex = i;
        break;
      }
    }

    if (unquotedAtStarIndex !== -1 && wordParts.length > 1) {
      // Get positional parameters
      const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
      const params: string[] = [];
      for (let i = 1; i <= numParams; i++) {
        params.push(ctx.state.env[String(i)] || "");
      }

      // Expand prefix (parts before $@/$*)
      let prefix = "";
      for (let i = 0; i < unquotedAtStarIndex; i++) {
        prefix += await expandPart(ctx, wordParts[i]);
      }

      // Expand suffix (parts after $@/$*)
      let suffix = "";
      for (let i = unquotedAtStarIndex + 1; i < wordParts.length; i++) {
        suffix += await expandPart(ctx, wordParts[i]);
      }

      const ifsChars = getIfs(ctx.state.env);
      const ifsEmpty = isIfsEmpty(ctx.state.env);
      const ifsWhitespaceOnly = isIfsWhitespaceOnly(ctx.state.env);

      if (numParams === 0) {
        // No params - just return prefix+suffix if non-empty
        const combined = prefix + suffix;
        return { values: combined ? [combined] : [], quoted: false };
      }

      // Build words first: prefix joins with first param, suffix joins with last
      // Then apply IFS splitting and filtering
      let words: string[];

      // Both unquoted $@ and unquoted $* behave the same way:
      // Each param becomes a separate word, then each is subject to IFS splitting.
      // The difference between $@ and $* only applies when QUOTED.
      {
        // First, attach prefix to first param, suffix to last param
        const rawWords: string[] = [];
        for (let i = 0; i < params.length; i++) {
          let word = params[i];
          if (i === 0) word = prefix + word;
          if (i === params.length - 1) word = word + suffix;
          rawWords.push(word);
        }

        // Now apply IFS splitting and filtering
        if (ifsEmpty) {
          // Empty IFS - no splitting, filter out empty words
          words = rawWords.filter((w) => w !== "");
        } else if (ifsWhitespaceOnly) {
          // Whitespace-only IFS - empty words are dropped
          words = [];
          for (const word of rawWords) {
            if (word === "") continue;
            const parts = splitByIfsForExpansion(word, ifsChars);
            words.push(...parts);
          }
        } else {
          // Non-whitespace IFS - preserve empty words (except trailing)
          words = [];
          for (const word of rawWords) {
            if (word === "") {
              words.push("");
            } else {
              const parts = splitByIfsForExpansion(word, ifsChars);
              words.push(...parts);
            }
          }
          // Remove trailing empty strings
          while (words.length > 0 && words[words.length - 1] === "") {
            words.pop();
          }
        }
      }

      // Apply glob expansion to each word
      if (ctx.state.options.noglob || words.length === 0) {
        return { values: words, quoted: false };
      }

      const globExpander = new GlobExpander(
        ctx.fs,
        ctx.state.cwd,
        ctx.state.env,
        {
          globstar: ctx.state.shoptOptions.globstar,
          nullglob: ctx.state.shoptOptions.nullglob,
          failglob: ctx.state.shoptOptions.failglob,
          dotglob: ctx.state.shoptOptions.dotglob,
          extglob: ctx.state.shoptOptions.extglob,
          globskipdots: ctx.state.shoptOptions.globskipdots,
        },
      );

      const expandedValues: string[] = [];
      for (const w of words) {
        if (hasGlobPattern(w, ctx.state.shoptOptions.extglob)) {
          const matches = await globExpander.expand(w);
          if (matches.length > 0) {
            expandedValues.push(...matches);
          } else if (globExpander.hasFailglob()) {
            throw new GlobError(w);
          } else if (globExpander.hasNullglob()) {
            // skip
          } else {
            expandedValues.push(w);
          }
        } else {
          expandedValues.push(w);
        }
      }

      return { values: expandedValues, quoted: false };
    }
  }

  // Handle mixed word parts with word-producing expansions like $s1"${array[@]}"_"$@"
  // This case has multiple top-level parts where some are DoubleQuoted containing ${arr[@]} or $@
  // Each word-producing part expands to multiple words, and we need to join adjacent parts properly
  const mixedWordResult = await expandMixedWordParts(ctx, wordParts);
  if (mixedWordResult !== null) {
    // Apply glob expansion to each resulting word
    if (ctx.state.options.noglob) {
      return { values: mixedWordResult, quoted: false };
    }

    const globExpander = new GlobExpander(
      ctx.fs,
      ctx.state.cwd,
      ctx.state.env,
      {
        globstar: ctx.state.shoptOptions.globstar,
        nullglob: ctx.state.shoptOptions.nullglob,
        failglob: ctx.state.shoptOptions.failglob,
        dotglob: ctx.state.shoptOptions.dotglob,
        extglob: ctx.state.shoptOptions.extglob,
        globskipdots: ctx.state.shoptOptions.globskipdots,
      },
    );

    const expandedValues: string[] = [];
    for (const w of mixedWordResult) {
      if (hasGlobPattern(w, ctx.state.shoptOptions.extglob)) {
        const matches = await globExpander.expand(w);
        if (matches.length > 0) {
          expandedValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          throw new GlobError(w);
        } else if (globExpander.hasNullglob()) {
          // skip
        } else {
          expandedValues.push(w);
        }
      } else {
        expandedValues.push(w);
      }
    }
    return { values: expandedValues, quoted: false };
  }

  // No brace expansion or single value - use original logic
  // Word splitting based on IFS
  // If IFS is set to empty string, no word splitting occurs
  // Word splitting applies to results of parameter expansion, command substitution, and arithmetic expansion
  // Note: hasQuoted being true does NOT prevent word splitting - unquoted expansions like $a in $a"$b"
  // should still be split. The smartWordSplit function handles this by treating quoted parts as
  // non-splittable segments that join with adjacent fields.
  if (
    (hasCommandSub || hasArrayVar || hasParamExpansion) &&
    !isIfsEmpty(ctx.state.env)
  ) {
    const ifsChars = getIfs(ctx.state.env);
    // Build regex-safe pattern from IFS characters
    const ifsPattern = buildIfsCharClassPattern(ifsChars);

    // Smart word splitting: literals should NOT be split, they attach to adjacent fields
    // E.g., ${v:-AxBxC}x with IFS=x should give "A B Cx" not "A B C"
    const splitResult = await smartWordSplit(
      ctx,
      wordParts,
      ifsChars,
      ifsPattern,
      expandPart,
    );
    // Perform glob expansion on each split value (skip if noglob is set)
    const expandedValues: string[] = [];
    if (ctx.state.options.noglob) {
      // noglob is set - skip glob expansion entirely
      return { values: splitResult, quoted: false };
    }
    const globExpander = new GlobExpander(
      ctx.fs,
      ctx.state.cwd,
      ctx.state.env,
      {
        globstar: ctx.state.shoptOptions.globstar,
        nullglob: ctx.state.shoptOptions.nullglob,
        failglob: ctx.state.shoptOptions.failglob,
        dotglob: ctx.state.shoptOptions.dotglob,
        extglob: ctx.state.shoptOptions.extglob,
        globskipdots: ctx.state.shoptOptions.globskipdots,
      },
    );
    for (const sv of splitResult) {
      if (hasGlobPattern(sv, ctx.state.shoptOptions.extglob)) {
        const matches = await globExpander.expand(sv);
        if (matches.length > 0) {
          expandedValues.push(...matches);
        } else if (globExpander.hasFailglob()) {
          throw new GlobError(sv);
        } else if (globExpander.hasNullglob()) {
          // nullglob: skip this value
        } else {
          expandedValues.push(sv);
        }
      } else {
        expandedValues.push(sv);
      }
    }
    return { values: expandedValues, quoted: false };
  }

  const needsAsync = wordNeedsAsync(word);
  const value = needsAsync
    ? await expandWordAsync(ctx, word)
    : expandWordSync(ctx, word);

  // Check if the word contains any Glob parts
  const hasGlobParts = wordParts.some((p) => p.type === "Glob");

  // For glob expansion, we need to:
  // 1. Escape glob characters in quoted parts so they're treated as literals
  // 2. Keep glob characters from Glob parts
  // This enables patterns like '_tmp/[bc]'*.mm where [bc] is literal and * is a glob
  if (!ctx.state.options.noglob && hasGlobParts) {
    // Use expandWordForGlobbing which properly escapes quoted parts
    const globPattern = await expandWordForGlobbing(ctx, word);

    if (hasGlobPattern(globPattern, ctx.state.shoptOptions.extglob)) {
      const globExpander = new GlobExpander(
        ctx.fs,
        ctx.state.cwd,
        ctx.state.env,
        {
          globstar: ctx.state.shoptOptions.globstar,
          nullglob: ctx.state.shoptOptions.nullglob,
          failglob: ctx.state.shoptOptions.failglob,
          dotglob: ctx.state.shoptOptions.dotglob,
          extglob: ctx.state.shoptOptions.extglob,
          globskipdots: ctx.state.shoptOptions.globskipdots,
        },
      );
      const matches = await globExpander.expand(globPattern);
      if (matches.length > 0) {
        return { values: matches, quoted: false };
      } else if (globExpander.hasFailglob()) {
        throw new GlobError(value);
      } else if (globExpander.hasNullglob()) {
        return { values: [], quoted: false };
      }
      // Glob failed - return the unescaped pattern (not the raw pattern with backslashes)
      // In bash, [\\]_ outputs [\]_ when no match, not [\\]_
      // Also apply IFS splitting since the pattern may contain spaces (e.g., b[2 + 0]=bar -> b[2 + 0]=bar)
      const unescapedValue = unescapeGlobPattern(value);
      if (!isIfsEmpty(ctx.state.env)) {
        const ifsChars = getIfs(ctx.state.env);
        const splitValues = splitByIfsForExpansion(unescapedValue, ifsChars);
        return { values: splitValues, quoted: false };
      }
      return { values: [unescapedValue], quoted: false };
    }
  } else if (
    !hasQuoted &&
    !ctx.state.options.noglob &&
    hasGlobPattern(value, ctx.state.shoptOptions.extglob)
  ) {
    // No Glob parts but value contains glob characters from Literal parts or expansions
    // Use expandWordForGlobbing to properly handle Escaped parts (e.g., \* should not glob)
    const globPattern = await expandWordForGlobbing(ctx, word);

    // Check if there are still glob patterns after escaping
    // (e.g., "two-\*" becomes "two-\\*" which has no unescaped globs)
    if (hasGlobPattern(globPattern, ctx.state.shoptOptions.extglob)) {
      const globExpander = new GlobExpander(
        ctx.fs,
        ctx.state.cwd,
        ctx.state.env,
        {
          globstar: ctx.state.shoptOptions.globstar,
          nullglob: ctx.state.shoptOptions.nullglob,
          failglob: ctx.state.shoptOptions.failglob,
          dotglob: ctx.state.shoptOptions.dotglob,
          extglob: ctx.state.shoptOptions.extglob,
          globskipdots: ctx.state.shoptOptions.globskipdots,
        },
      );
      const matches = await globExpander.expand(globPattern);
      if (matches.length > 0) {
        return { values: matches, quoted: false };
      } else if (globExpander.hasFailglob()) {
        throw new GlobError(value);
      } else if (globExpander.hasNullglob()) {
        return { values: [], quoted: false };
      }
    }
  }

  // Empty unquoted expansion produces no words (e.g., $empty where empty is unset/empty)
  // But quoted empty string produces one empty word (e.g., "" or "$empty")
  if (value === "" && !hasQuoted) {
    return { values: [], quoted: false };
  }

  // If we have Glob parts and didn't expand (noglob or no glob pattern),
  // we still need to unescape backslashes in the value.
  // In bash, [\\]_ with set -f outputs [\]_, not [\\]_
  // Also apply IFS splitting since the pattern may contain spaces
  if (hasGlobParts && !hasQuoted) {
    const unescapedValue = unescapeGlobPattern(value);
    if (!isIfsEmpty(ctx.state.env)) {
      const ifsChars = getIfs(ctx.state.env);
      const splitValues = splitByIfsForExpansion(unescapedValue, ifsChars);
      return { values: splitValues, quoted: false };
    }
    return { values: [unescapedValue], quoted: false };
  }

  return { values: [value], quoted: hasQuoted };
}

/**
 * Check if a DoubleQuoted part contains a word-producing expansion (${arr[@]} or $@).
 * Returns info about the expansion if found, or null if not found.
 */
function findWordProducingExpansion(
  part: WordPart,
):
  | { type: "array"; name: string; atIndex: number; isStar: boolean }
  | { type: "positional"; atIndex: number; isStar: boolean }
  | null {
  if (part.type !== "DoubleQuoted") return null;

  for (let i = 0; i < part.parts.length; i++) {
    const inner = part.parts[i];
    if (inner.type !== "ParameterExpansion") continue;
    if (inner.operation) continue; // Skip if has operation like ${arr[@]#pattern}

    // Check for ${arr[@]} or ${arr[*]}
    const arrayMatch = inner.parameter.match(
      /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
    );
    if (arrayMatch) {
      return {
        type: "array",
        name: arrayMatch[1],
        atIndex: i,
        isStar: arrayMatch[2] === "*",
      };
    }

    // Check for $@ or $*
    if (inner.parameter === "@" || inner.parameter === "*") {
      return {
        type: "positional",
        atIndex: i,
        isStar: inner.parameter === "*",
      };
    }
  }
  return null;
}

/**
 * Expand a DoubleQuoted part that contains a word-producing expansion.
 * Returns an array of words.
 */
async function expandDoubleQuotedWithWordProducing(
  ctx: InterpreterContext,
  part: WordPart & { type: "DoubleQuoted" },
  info:
    | { type: "array"; name: string; atIndex: number; isStar: boolean }
    | { type: "positional"; atIndex: number; isStar: boolean },
): Promise<string[]> {
  // Expand prefix (parts before the @ expansion)
  let prefix = "";
  for (let i = 0; i < info.atIndex; i++) {
    prefix += await expandPart(ctx, part.parts[i]);
  }

  // Expand suffix (parts after the @ expansion)
  let suffix = "";
  for (let i = info.atIndex + 1; i < part.parts.length; i++) {
    suffix += await expandPart(ctx, part.parts[i]);
  }

  // Get the values from the expansion
  let values: string[];
  if (info.type === "array") {
    const elements = getArrayElements(ctx, info.name);
    values = elements.map(([, v]) => v);
    if (values.length === 0) {
      // Check for scalar (treat as single-element array)
      const scalarValue = ctx.state.env[info.name];
      if (scalarValue !== undefined) {
        values = [scalarValue];
      }
    }
  } else {
    // Positional parameters
    const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
    values = [];
    for (let i = 1; i <= numParams; i++) {
      values.push(ctx.state.env[String(i)] || "");
    }
  }

  // Handle * (join with IFS into single word)
  if (info.isStar) {
    const ifsSep = getIfsSeparator(ctx.state.env);
    const joined = values.join(ifsSep);
    return [prefix + joined + suffix];
  }

  // Handle @ (each value is a separate word)
  if (values.length === 0) {
    // No values - return prefix+suffix if non-empty
    const combined = prefix + suffix;
    return combined ? [combined] : [];
  }

  if (values.length === 1) {
    return [prefix + values[0] + suffix];
  }

  // Multiple values: prefix joins with first, suffix joins with last
  return [
    prefix + values[0],
    ...values.slice(1, -1),
    values[values.length - 1] + suffix,
  ];
}

/**
 * Expand mixed word parts where some parts are word-producing (contain ${arr[@]} or $@).
 * Returns null if this case doesn't apply.
 *
 * This handles cases like: $s1"${array[@]}"_"$@"
 * - $s1 splits by IFS into multiple words
 * - "${array[@]}" expands to multiple words (one per element)
 * - _ is a literal
 * - "$@" expands to multiple words (one per positional param)
 *
 * The joining rule is: last word of one part joins with first word of next part.
 */
async function expandMixedWordParts(
  ctx: InterpreterContext,
  wordParts: WordPart[],
): Promise<string[] | null> {
  // Only applies if we have multiple parts and at least one word-producing part
  if (wordParts.length < 2) return null;

  // Check if any DoubleQuoted parts have word-producing expansions
  let hasWordProducing = false;
  for (const part of wordParts) {
    if (findWordProducingExpansion(part)) {
      hasWordProducing = true;
      break;
    }
  }
  if (!hasWordProducing) return null;

  const ifsChars = getIfs(ctx.state.env);
  const ifsEmpty = isIfsEmpty(ctx.state.env);

  // Expand each part into an array of words
  // Then join adjacent parts by concatenating boundary words
  const partWords: string[][] = [];

  for (const part of wordParts) {
    const wpInfo = findWordProducingExpansion(part);

    if (wpInfo && part.type === "DoubleQuoted") {
      // This part produces multiple words
      const words = await expandDoubleQuotedWithWordProducing(
        ctx,
        part,
        wpInfo,
      );
      partWords.push(words);
    } else if (part.type === "DoubleQuoted" || part.type === "SingleQuoted") {
      // Quoted part - produces single word, no splitting
      const value = await expandPart(ctx, part);
      partWords.push([value]);
    } else if (part.type === "Literal") {
      // Literal - no splitting
      partWords.push([part.value]);
    } else if (part.type === "ParameterExpansion") {
      // Unquoted parameter expansion - subject to IFS splitting
      const value = await expandPart(ctx, part);
      if (ifsEmpty) {
        partWords.push(value ? [value] : []);
      } else {
        const split = splitByIfsForExpansion(value, ifsChars);
        partWords.push(split);
      }
    } else {
      // Other parts (CommandSubstitution, ArithmeticExpansion, etc.)
      const value = await expandPart(ctx, part);
      if (ifsEmpty) {
        partWords.push(value ? [value] : []);
      } else {
        const split = splitByIfsForExpansion(value, ifsChars);
        partWords.push(split);
      }
    }
  }

  // Join the parts by concatenating boundary words
  // Algorithm: for each pair of adjacent parts, join last word of left with first word of right
  const result: string[] = [];

  for (let i = 0; i < partWords.length; i++) {
    const words = partWords[i];
    if (words.length === 0) {
      // Empty part - nothing to add
      continue;
    }

    if (result.length === 0) {
      // First non-empty part
      result.push(...words);
    } else {
      // Join last word of result with first word of this part
      const lastIdx = result.length - 1;
      result[lastIdx] = result[lastIdx] + words[0];

      // Add remaining words from this part
      for (let j = 1; j < words.length; j++) {
        result.push(words[j]);
      }
    }
  }

  return result;
}

/**
 * Get a simple text representation of word parts for error messages.
 * Only extracts parameter names from ParameterExpansion parts.
 */
function getWordText(parts: WordPart[]): string {
  for (const p of parts) {
    if (p.type === "ParameterExpansion") {
      return p.parameter;
    }
    if (p.type === "Literal") {
      return p.value;
    }
  }
  return "";
}

/**
 * Check if a word contains quoted "$@" that would expand to multiple words.
 * This is used to detect "ambiguous redirect" errors.
 */
export function hasQuotedMultiValueAt(
  ctx: InterpreterContext,
  word: WordNode,
): boolean {
  const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
  // Only a problem if there are 2+ positional parameters
  if (numParams < 2) return false;

  // Check for "$@" inside DoubleQuoted parts
  function checkParts(parts: WordPart[]): boolean {
    for (const part of parts) {
      if (part.type === "DoubleQuoted") {
        // Check inside the double-quoted part
        for (const innerPart of part.parts) {
          if (
            innerPart.type === "ParameterExpansion" &&
            innerPart.parameter === "@" &&
            !innerPart.operation // plain $@ without operations
          ) {
            return true;
          }
        }
      }
    }
    return false;
  }

  return checkParts(word.parts);
}

/**
 * Expand a redirect target with glob handling.
 *
 * For redirects:
 * - If glob matches 0 files with failglob → error (returns { error: ... })
 * - If glob matches 0 files without failglob → use literal pattern
 * - If glob matches 1 file → use that file
 * - If glob matches 2+ files → "ambiguous redirect" error
 *
 * Returns { target: string } on success or { error: string } on failure.
 */
export async function expandRedirectTarget(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<{ target: string } | { error: string }> {
  // Check for "$@" with multiple positional params - this is an ambiguous redirect
  if (hasQuotedMultiValueAt(ctx, word)) {
    return { error: "bash: $@: ambiguous redirect\n" };
  }

  const wordParts = word.parts;
  const { hasQuoted } = analyzeWordParts(wordParts);

  // Check for brace expansion - if it produces multiple values, it's an ambiguous redirect
  // For example: echo hi > a-{one,two} should error
  if (hasBraceExpansion(wordParts)) {
    const braceExpanded = braceExpansionNeedsAsync(wordParts)
      ? await expandWordWithBracesAsync(ctx, word)
      : expandWordWithBraces(ctx, word);
    if (braceExpanded.length > 1) {
      // Get the original word text for the error message
      const originalText = wordParts
        .map((p) => {
          if (p.type === "Literal") return p.value;
          if (p.type === "BraceExpansion") {
            // Reconstruct brace expression
            const items = p.items
              .map((item) => {
                if (item.type === "Range") {
                  const step = item.step ? `..${item.step}` : "";
                  return `${item.startStr ?? item.start}..${item.endStr ?? item.end}${step}`;
                }
                return item.word.parts
                  .map((wp) => (wp.type === "Literal" ? wp.value : ""))
                  .join("");
              })
              .join(",");
            return `{${items}}`;
          }
          return "";
        })
        .join("");
      return { error: `bash: ${originalText}: ambiguous redirect\n` };
    }
    // Single value from brace expansion - continue with normal processing
    // (value will be re-expanded below, but since there's only one value it's the same)
  }

  const needsAsync = wordNeedsAsync(word);
  const value = needsAsync
    ? await expandWordAsync(ctx, word)
    : expandWordSync(ctx, word);

  // Check for word splitting producing multiple words - this is an ambiguous redirect
  // This only applies when the word has unquoted expansions (not all quoted)
  const { hasParamExpansion, hasCommandSub } = analyzeWordParts(wordParts);
  const hasUnquotedExpansion =
    (hasParamExpansion || hasCommandSub) && !hasQuoted;

  if (hasUnquotedExpansion && !isIfsEmpty(ctx.state.env)) {
    const ifsChars = getIfs(ctx.state.env);
    const splitWords = splitByIfsForExpansion(value, ifsChars);
    if (splitWords.length > 1) {
      // Word splitting produces multiple words - ambiguous redirect
      return {
        error: `bash: $${getWordText(wordParts)}: ambiguous redirect\n`,
      };
    }
  }

  // Skip glob expansion if noglob is set (set -f) or if the word was quoted
  // Check these BEFORE building glob pattern to avoid double-expanding side-effectful expressions
  if (hasQuoted || ctx.state.options.noglob) {
    return { target: value };
  }

  // Build glob pattern using expandWordForGlobbing which preserves escaped glob chars
  // For example: two-\* becomes two-\\* (escaped * is literal, not a glob)
  // But: two-$star where star='*' becomes two-* (variable expansion is subject to glob)
  const globPattern = await expandWordForGlobbing(ctx, word);

  // Skip if there are no glob patterns in the pattern
  if (!hasGlobPattern(globPattern, ctx.state.shoptOptions.extglob)) {
    return { target: value };
  }

  // Perform glob expansion for redirect targets
  const globExpander = new GlobExpander(ctx.fs, ctx.state.cwd, ctx.state.env, {
    globstar: ctx.state.shoptOptions.globstar,
    nullglob: ctx.state.shoptOptions.nullglob,
    failglob: ctx.state.shoptOptions.failglob,
    dotglob: ctx.state.shoptOptions.dotglob,
    extglob: ctx.state.shoptOptions.extglob,
    globskipdots: ctx.state.shoptOptions.globskipdots,
  });

  const matches = await globExpander.expand(globPattern);

  if (matches.length === 0) {
    // No matches
    if (globExpander.hasFailglob()) {
      // failglob: error on no match
      return { error: `bash: no match: ${value}\n` };
    }
    // Without failglob, use the literal pattern (unescaped)
    return { target: value };
  }

  if (matches.length === 1) {
    // Exactly one match - use it
    return { target: matches[0] };
  }

  // Multiple matches - ambiguous redirect error
  return { error: `bash: ${value}: ambiguous redirect\n` };
}

// Async version of expandWord (internal)
async function expandWordAsync(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<string> {
  const wordParts = word.parts;
  const len = wordParts.length;

  if (len === 1) {
    return expandPart(ctx, wordParts[0]);
  }

  const parts: string[] = [];
  for (let i = 0; i < len; i++) {
    parts.push(await expandPart(ctx, wordParts[i]));
  }
  return parts.join("");
}

/**
 * Detect the $(<file) shorthand pattern.
 * Returns the target WordNode if this is a valid $(<file) pattern, null otherwise.
 *
 * The pattern is valid when the command substitution body is a script with:
 * - Exactly one statement
 * - One pipeline with one command
 * - A SimpleCommand with no name, no args, no assignments
 * - Exactly one input redirection (<)
 *
 * Note: The special $(<file) behavior only works when it's the ONLY element
 * in the command substitution. $(< file; cmd) or $(cmd; < file) are NOT special.
 */
function getFileReadShorthand(body: ScriptNode): { target: WordNode } | null {
  // Must have exactly one statement
  if (body.statements.length !== 1) return null;

  const statement = body.statements[0];
  // Must not have any operators (no && or ||)
  if (statement.operators.length !== 0) return null;
  // Must have exactly one pipeline
  if (statement.pipelines.length !== 1) return null;

  const pipeline = statement.pipelines[0];
  // Must not be negated
  if (pipeline.negated) return null;
  // Must have exactly one command
  if (pipeline.commands.length !== 1) return null;

  const cmd = pipeline.commands[0];
  // Must be a SimpleCommand
  if (cmd.type !== "SimpleCommand") return null;

  const simpleCmd = cmd as SimpleCommandNode;
  // Must have no command name
  if (simpleCmd.name !== null) return null;
  // Must have no arguments
  if (simpleCmd.args.length !== 0) return null;
  // Must have no assignments
  if (simpleCmd.assignments.length !== 0) return null;
  // Must have exactly one redirection
  if (simpleCmd.redirections.length !== 1) return null;

  const redirect = simpleCmd.redirections[0];
  // Must be an input redirection (<)
  if (redirect.operator !== "<") return null;
  // Target must be a WordNode (not heredoc)
  if (redirect.target.type !== "Word") return null;

  return { target: redirect.target };
}

async function expandPart(
  ctx: InterpreterContext,
  part: WordPart,
): Promise<string> {
  // Check if ParameterExpansion needs async (has command substitution in operation)
  if (part.type === "ParameterExpansion" && paramExpansionNeedsAsync(part)) {
    return expandParameterAsync(ctx, part);
  }

  // Check if a nameref parameter needs async (target has command substitution in subscript)
  // This can't be detected statically, so we check at runtime
  if (
    part.type === "ParameterExpansion" &&
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part.parameter) &&
    isNameref(ctx, part.parameter)
  ) {
    const target = resolveNameref(ctx, part.parameter);
    if (target && target !== part.parameter) {
      const targetBracketMatch = target.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/,
      );
      if (targetBracketMatch) {
        const targetSubscript = targetBracketMatch[2];
        if (targetSubscript.includes("$(") || targetSubscript.includes("`")) {
          // Nameref target has command substitution - use async path
          return expandParameterAsync(ctx, part);
        }
      }
    }
  }

  // Try simple cases first
  const simple = expandSimplePart(ctx, part);
  if (simple !== null) return simple;

  // Handle cases that need recursion or async
  switch (part.type) {
    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        parts.push(await expandPart(ctx, p));
      }
      return parts.join("");
    }

    case "CommandSubstitution": {
      // Check for the special $(<file) shorthand pattern
      // This is equivalent to $(cat file) but reads the file directly
      const fileReadShorthand = getFileReadShorthand(part.body);
      if (fileReadShorthand) {
        try {
          // Expand the file path (handles $VAR, etc.)
          const filePath = await expandWord(ctx, fileReadShorthand.target);
          // Resolve relative paths
          const resolvedPath = filePath.startsWith("/")
            ? filePath
            : `${ctx.state.cwd}/${filePath}`;
          // Read the file
          const content = await ctx.fs.readFile(resolvedPath);
          ctx.state.lastExitCode = 0;
          ctx.state.env["?"] = "0";
          // Strip trailing newlines (like command substitution does)
          return content.replace(/\n+$/, "");
        } catch {
          // File not found or read error - return empty string, set exit code
          ctx.state.lastExitCode = 1;
          ctx.state.env["?"] = "1";
          return "";
        }
      }

      // Command substitution runs in a subshell-like context
      // ExitError should NOT terminate the main script, just this substitution
      // But ExecutionLimitError MUST propagate to protect against infinite recursion
      // Command substitutions get a new BASHPID (unlike $$ which stays the same)
      const savedBashPid = ctx.state.bashPid;
      ctx.state.bashPid = ctx.state.nextVirtualPid++;
      // Save environment - command substitutions run in a subshell and should not
      // modify parent environment (e.g., aliases defined inside $() should not leak)
      const savedEnv = { ...ctx.state.env };
      const savedCwd = ctx.state.cwd;
      // Suppress verbose mode (set -v) inside command substitutions
      // bash only prints verbose output for the main script
      const savedSuppressVerbose = ctx.state.suppressVerbose;
      ctx.state.suppressVerbose = true;
      try {
        const result = await ctx.executeScript(part.body);
        // Restore environment but preserve exit code
        const exitCode = result.exitCode;
        ctx.state.env = savedEnv;
        ctx.state.cwd = savedCwd;
        ctx.state.suppressVerbose = savedSuppressVerbose;
        // Store the exit code for $?
        ctx.state.lastExitCode = exitCode;
        ctx.state.env["?"] = String(exitCode);
        // Command substitution stderr should go to the shell's stderr at expansion time,
        // NOT be affected by later redirections on the outer command
        if (result.stderr) {
          ctx.state.expansionStderr =
            (ctx.state.expansionStderr || "") + result.stderr;
        }
        ctx.state.bashPid = savedBashPid;
        return result.stdout.replace(/\n+$/, "");
      } catch (error) {
        // Restore environment on error as well
        ctx.state.env = savedEnv;
        ctx.state.cwd = savedCwd;
        ctx.state.bashPid = savedBashPid;
        ctx.state.suppressVerbose = savedSuppressVerbose;
        // ExecutionLimitError must always propagate - these are safety limits
        if (error instanceof ExecutionLimitError) {
          throw error;
        }
        if (error instanceof ExitError) {
          // Catch exit in command substitution - return output so far
          ctx.state.lastExitCode = error.exitCode;
          ctx.state.env["?"] = String(error.exitCode);
          // Also forward stderr from the exit
          if (error.stderr) {
            ctx.state.expansionStderr =
              (ctx.state.expansionStderr || "") + error.stderr;
          }
          return error.stdout.replace(/\n+$/, "");
        }
        throw error;
      }
    }

    case "ArithmeticExpansion": {
      // If original text is available and contains $var patterns (not ${...}),
      // we need to do text substitution before parsing to maintain operator precedence.
      // E.g., $(( $x * 3 )) where x='1 + 2' should expand to $(( 1 + 2 * 3 )) = 7
      // not $(( (1+2) * 3 )) = 9
      const originalText = part.expression.originalText;
      const hasDollarVars =
        originalText && /\$[a-zA-Z_][a-zA-Z0-9_]*(?![{[(])/.test(originalText);
      if (hasDollarVars) {
        // Expand $var patterns in the text
        const expandedText = expandDollarVarsInArithText(ctx, originalText);
        // Re-parse the expanded expression
        const parser = new Parser();
        const newExpr = parseArithmeticExpression(parser, expandedText);
        // true = expansion context, single quotes cause error
        return String(await evaluateArithmetic(ctx, newExpr.expression, true));
      }
      // true = expansion context, single quotes cause error
      return String(
        await evaluateArithmetic(ctx, part.expression.expression, true),
      );
    }

    case "BraceExpansion": {
      const results: string[] = [];
      for (const item of part.items) {
        if (item.type === "Range") {
          const range = expandBraceRange(
            item.start,
            item.end,
            item.step,
            item.startStr,
            item.endStr,
          );
          if (range.expanded) {
            results.push(...range.expanded);
          } else {
            return range.literal;
          }
        } else {
          results.push(await expandWord(ctx, item.word));
        }
      }
      return results.join(" ");
    }

    default:
      return "";
  }
}

/**
 * Expand $var patterns in arithmetic expression text for text substitution.
 * This handles the bash behavior where $(( $x * 3 )) with x='1 + 2' should
 * expand to $(( 1 + 2 * 3 )) = 7, not $(( (1+2) * 3 )) = 9.
 *
 * Only expands simple $var patterns, not ${...}, $(()), $(), etc.
 */
function expandDollarVarsInArithText(
  ctx: InterpreterContext,
  text: string,
): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "$") {
      // Check for ${...} - don't expand, keep as-is for arithmetic parser
      if (text[i + 1] === "{") {
        // Find matching }
        let depth = 1;
        let j = i + 2;
        while (j < text.length && depth > 0) {
          if (text[j] === "{") depth++;
          else if (text[j] === "}") depth--;
          j++;
        }
        result += text.slice(i, j);
        i = j;
        continue;
      }
      // Check for $((, $( - don't expand
      if (text[i + 1] === "(") {
        // Find matching ) or ))
        let depth = 1;
        let j = i + 2;
        while (j < text.length && depth > 0) {
          if (text[j] === "(") depth++;
          else if (text[j] === ")") depth--;
          j++;
        }
        result += text.slice(i, j);
        i = j;
        continue;
      }
      // Check for $var pattern
      if (/[a-zA-Z_]/.test(text[i + 1] || "")) {
        let j = i + 1;
        while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) {
          j++;
        }
        const varName = text.slice(i + 1, j);
        const value = getVariable(ctx, varName);
        result += value;
        i = j;
        continue;
      }
      // Check for $1, $2, etc. (positional parameters)
      if (/[0-9]/.test(text[i + 1] || "")) {
        let j = i + 1;
        while (j < text.length && /[0-9]/.test(text[j])) {
          j++;
        }
        const varName = text.slice(i + 1, j);
        const value = getVariable(ctx, varName);
        result += value;
        i = j;
        continue;
      }
      // Check for special vars: $*, $@, $#, $?, etc.
      if (/[*@#?\-!$]/.test(text[i + 1] || "")) {
        const varName = text[i + 1];
        const value = getVariable(ctx, varName);
        result += value;
        i += 2;
        continue;
      }
    }
    // Check for double quotes - expand variables inside but keep the quotes
    // (arithmetic preprocessor will strip them)
    if (text[i] === '"') {
      result += '"';
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "$" && /[a-zA-Z_]/.test(text[i + 1] || "")) {
          // Expand $var inside quotes
          let j = i + 1;
          while (j < text.length && /[a-zA-Z0-9_]/.test(text[j])) {
            j++;
          }
          const varName = text.slice(i + 1, j);
          const value = getVariable(ctx, varName);
          result += value;
          i = j;
        } else if (text[i] === "\\") {
          // Keep escape sequences
          result += text[i];
          i++;
          if (i < text.length) {
            result += text[i];
            i++;
          }
        } else {
          result += text[i];
          i++;
        }
      }
      if (i < text.length) {
        result += '"';
        i++;
      }
      continue;
    }
    result += text[i];
    i++;
  }
  return result;
}

/**
 * Expand variable references in a subscript for associative arrays.
 * e.g., "$key" -> "foo" if key=foo
 * Handles $var, "$var", and concatenated forms like "$i$i"
 */
function expandSubscriptForAssocArray(
  ctx: InterpreterContext,
  subscript: string,
): string {
  // Remove surrounding quotes if present
  let inner = subscript;
  const hasQuotes =
    (subscript.startsWith('"') && subscript.endsWith('"')) ||
    (subscript.startsWith("'") && subscript.endsWith("'"));

  if (hasQuotes) {
    inner = subscript.slice(1, -1);
  }

  // For single-quoted strings, no expansion
  if (subscript.startsWith("'") && subscript.endsWith("'")) {
    return inner;
  }

  // Expand $var and ${var} references in the string
  let result = "";
  let i = 0;
  while (i < inner.length) {
    if (inner[i] === "$") {
      // Check for ${...} or $name
      if (inner[i + 1] === "{") {
        // Find matching }
        let depth = 1;
        let j = i + 2;
        while (j < inner.length && depth > 0) {
          if (inner[j] === "{") depth++;
          else if (inner[j] === "}") depth--;
          j++;
        }
        const varName = inner.slice(i + 2, j - 1);
        // Use getVariable to properly handle array expansions like array[@] and array[*]
        const value = getVariable(ctx, varName);
        result += value;
        i = j;
      } else if (/[a-zA-Z_]/.test(inner[i + 1] || "")) {
        // $name - find end of name
        let j = i + 1;
        while (j < inner.length && /[a-zA-Z0-9_]/.test(inner[j])) {
          j++;
        }
        const varName = inner.slice(i + 1, j);
        // Use getVariable for consistency
        const value = getVariable(ctx, varName);
        result += value;
        i = j;
      } else {
        // Just a literal $ or unknown
        result += inner[i];
        i++;
      }
    } else if (inner[i] === "\\") {
      // Escape sequence - skip the backslash and include next char
      i++;
      if (i < inner.length) {
        result += inner[i];
        i++;
      }
    } else {
      result += inner[i];
      i++;
    }
  }

  return result;
}

function expandParameter(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
  inDoubleQuotes = false,
): string {
  let { parameter } = part;
  const { operation } = part;

  // For associative arrays, we need to expand variables in the subscript
  // e.g., ${A[$key]} should expand $key to its value before lookup
  const subscriptMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
  if (subscriptMatch) {
    const arrayName = subscriptMatch[1];
    const subscript = subscriptMatch[2];
    const isAssoc = ctx.state.associativeArrays?.has(arrayName);

    if (isAssoc && subscript !== "@" && subscript !== "*") {
      // Expand variables in the subscript for associative arrays
      // Parse and expand the subscript as word parts
      const expandedSubscript = expandSubscriptForAssocArray(ctx, subscript);
      parameter = `${arrayName}[${expandedSubscript}]`;
    }
  }

  // Operations that handle unset variables should not trigger nounset
  const skipNounset =
    operation &&
    (operation.type === "DefaultValue" ||
      operation.type === "AssignDefault" ||
      operation.type === "UseAlternative" ||
      operation.type === "ErrorIfUnset");

  const value = getVariable(ctx, parameter, !skipNounset);

  if (!operation) {
    return value;
  }

  const isUnset = !isVariableSet(ctx, parameter);
  // For $* and $@, when checkEmpty is true (:-/:+), bash has special rules:
  // - $*: "empty" only if $# == 0 (even if IFS="" makes expansion empty)
  // - $@: "empty" if $# == 0 OR ($# == 1 AND $1 == "")
  // This is because $@ treats a single empty param as "empty" but $* does not.
  // For a[*] and a[@], similar rules apply based on array elements and IFS.
  let isEmpty: boolean;
  let effectiveValue = value; // For a[*], we need IFS-joined value, not space-joined
  const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
  // Check if this is an array expansion: varname[*] or varname[@]
  const arrayExpMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/);
  if (parameter === "*") {
    // $* is only "empty" if no positional params exist
    isEmpty = numParams === 0;
  } else if (parameter === "@") {
    // $@ is "empty" if no params OR exactly one empty param
    isEmpty = numParams === 0 || (numParams === 1 && ctx.state.env["1"] === "");
  } else if (arrayExpMatch) {
    // a[*] or a[@] - check if expansion is empty considering IFS
    const [, arrayName, subscript] = arrayExpMatch;
    const elements = getArrayElements(ctx, arrayName);
    if (elements.length === 0) {
      // Empty array - always empty
      isEmpty = true;
      effectiveValue = "";
    } else if (subscript === "*") {
      // a[*] behavior depends on quoting context:
      // - Quoted "${a[*]:-default}": uses default if IFS-joined result is empty
      // - Unquoted ${a[*]:-default}: like $*, only "empty" if array has no elements
      //   (even if IFS="" makes the joined expansion an empty string)
      const ifsSep = getIfsSeparator(ctx.state.env);
      const joined = elements.map(([, v]) => v).join(ifsSep);
      isEmpty = inDoubleQuotes ? joined === "" : false;
      effectiveValue = joined; // Use IFS-joined value instead of space-joined
    } else {
      // a[@] - empty only if all elements are empty AND there's exactly one
      // (similar to $@ behavior with single empty param)
      isEmpty = elements.length === 1 && elements.every(([, v]) => v === "");
      // For a[@], join with space (as getVariable does)
      effectiveValue = elements.map(([, v]) => v).join(" ");
    }
  } else {
    isEmpty = value === "";
  }

  switch (operation.type) {
    case "DefaultValue": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        // Only expand when actually using the default (lazy evaluation)
        // Pass inDoubleQuotes to suppress tilde expansion inside "..."
        return expandWordPartsSync(ctx, operation.word.parts, inDoubleQuotes);
      }
      return effectiveValue;
    }

    case "AssignDefault": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        // Only expand when actually using the default (lazy evaluation)
        // Pass inDoubleQuotes to suppress tilde expansion inside "..."
        const defaultValue = expandWordPartsSync(
          ctx,
          operation.word.parts,
          inDoubleQuotes,
        );
        // Handle array subscript assignment (e.g., arr[0]=x)
        const arrayMatch = parameter.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/,
        );
        if (arrayMatch) {
          const [, arrayName, subscriptExpr] = arrayMatch;
          // Evaluate subscript as arithmetic expression
          let index: number;
          if (/^\d+$/.test(subscriptExpr)) {
            index = Number.parseInt(subscriptExpr, 10);
          } else {
            try {
              const parser = new Parser();
              const arithAst = parseArithmeticExpression(parser, subscriptExpr);
              index = evaluateArithmeticSync(ctx, arithAst.expression);
            } catch {
              const varValue = ctx.state.env[subscriptExpr];
              index = varValue ? Number.parseInt(varValue, 10) : 0;
            }
            if (Number.isNaN(index)) index = 0;
          }
          // Set array element
          ctx.state.env[`${arrayName}_${index}`] = defaultValue;
          // Update array length if needed
          const currentLength = Number.parseInt(
            ctx.state.env[`${arrayName}__length`] || "0",
            10,
          );
          if (index >= currentLength) {
            ctx.state.env[`${arrayName}__length`] = String(index + 1);
          }
        } else {
          ctx.state.env[parameter] = defaultValue;
        }
        return defaultValue;
      }
      return effectiveValue;
    }

    case "ErrorIfUnset": {
      const shouldError = isUnset || (operation.checkEmpty && isEmpty);
      if (shouldError) {
        const message = operation.word
          ? expandWordPartsSync(ctx, operation.word.parts, inDoubleQuotes)
          : `${parameter}: parameter null or not set`;
        // Use ExitError to properly exit with status 1 and error message
        throw new ExitError(1, "", `bash: ${message}\n`);
      }
      return effectiveValue;
    }

    case "UseAlternative": {
      const useAlternative = !(isUnset || (operation.checkEmpty && isEmpty));
      if (useAlternative && operation.word) {
        // Only expand when actually using the alternative (lazy evaluation)
        // Pass inDoubleQuotes to suppress tilde expansion inside "..."
        return expandWordPartsSync(ctx, operation.word.parts, inDoubleQuotes);
      }
      return "";
    }

    case "Length": {
      // Check if this is an array length: ${#a[@]} or ${#a[*]}
      const arrayMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
      if (arrayMatch) {
        const arrayName = arrayMatch[1];
        const elements = getArrayElements(ctx, arrayName);
        if (elements.length > 0) {
          return String(elements.length);
        }
        // If no array elements, check if scalar variable exists
        // In bash, ${#s[@]} for scalar s returns 1
        const scalarValue = ctx.state.env[arrayName];
        if (scalarValue !== undefined) {
          return "1";
        }
        return "0";
      }
      // Check if this is just the array name (decays to ${#a[0]})
      if (
        /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parameter) &&
        isArray(ctx, parameter)
      ) {
        // Special handling for FUNCNAME and BASH_LINENO
        if (parameter === "FUNCNAME") {
          const firstElement = ctx.state.funcNameStack?.[0] || "";
          return String([...firstElement].length);
        }
        if (parameter === "BASH_LINENO") {
          const firstElement = ctx.state.callLineStack?.[0];
          return String(
            firstElement !== undefined ? [...String(firstElement)].length : 0,
          );
        }
        const firstElement = ctx.state.env[`${parameter}_0`] || "";
        return String([...firstElement].length);
      }
      // Use spread to count Unicode code points, not UTF-16 code units
      // This correctly handles characters outside the BMP (emoji, etc.)
      return String([...value].length);
    }

    case "LengthSliceError": {
      // ${#var:...} is invalid - can't take length of a substring
      throw new BadSubstitutionError(parameter);
    }

    case "BadSubstitution": {
      // Invalid parameter expansion syntax (e.g., ${(x)foo} zsh syntax)
      // Error was deferred from parse time to runtime
      throw new BadSubstitutionError(operation.text);
    }

    case "Substring": {
      // Evaluate arithmetic expressions in offset and length
      const offset = operation.offset
        ? evaluateArithmeticSync(ctx, operation.offset.expression)
        : 0;
      const length = operation.length
        ? evaluateArithmeticSync(ctx, operation.length.expression)
        : undefined;

      // Handle special case for ${@:offset} and ${*:offset}
      // When offset is 0, it includes $0 (the shell name)
      // When offset > 0, it starts from positional parameters ($1, $2, etc.)
      if (parameter === "@" || parameter === "*") {
        // Get positional parameters properly (not by splitting joined string)
        const numParams = Number.parseInt(ctx.state.env["#"] || "0", 10);
        const params: string[] = [];
        for (let i = 1; i <= numParams; i++) {
          params.push(ctx.state.env[String(i)] || "");
        }

        const shellName = ctx.state.env["0"] || "bash";

        // Build the array to slice from
        // When offset is 0, include $0 at position 0, then $1, $2, etc.
        // When offset > 0, $1 is at position 1, $2 at position 2, etc.
        // So for offset 1, we start at params[0] (which is $1)
        // For offset 0, we include shellName, then params
        let allArgs: string[];
        let startIdx: number;

        if (offset <= 0) {
          // offset 0: include $0 at position 0
          // offset negative: count from end (not typical for @/*, but handle it)
          allArgs = [shellName, ...params];
          if (offset < 0) {
            startIdx = allArgs.length + offset;
            // If negative offset goes beyond array bounds, return empty
            if (startIdx < 0) return "";
          } else {
            startIdx = 0;
          }
        } else {
          // offset > 0: start from $<offset> (e.g., offset 1 starts at $1)
          // $1 is params[0], $2 is params[1], etc.
          allArgs = params;
          startIdx = offset - 1;
        }

        if (startIdx < 0 || startIdx >= allArgs.length) {
          return "";
        }
        if (length !== undefined) {
          const endIdx =
            length < 0 ? allArgs.length + length : startIdx + length;
          return allArgs.slice(startIdx, Math.max(startIdx, endIdx)).join(" ");
        }
        return allArgs.slice(startIdx).join(" ");
      }

      // Handle array slicing: ${arr[@]:offset} or ${arr[*]:offset}
      const arrayMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
      if (arrayMatch) {
        const arrayName = arrayMatch[1];
        // Slicing associative arrays doesn't make sense - error out
        if (ctx.state.associativeArrays?.has(arrayName)) {
          throw new ExitError(
            1,
            "",
            `bash: \${${arrayName}[@]: 0: 3}: bad substitution\n`,
          );
        }
        const elements = getArrayElements(ctx, arrayName);

        // For sparse arrays, offset refers to index position, not element position
        // Find the first element whose index >= offset (or computed index for negative offset)
        let startIdx = 0;
        if (offset < 0) {
          // Negative offset: count from maxIndex + 1
          if (elements.length > 0) {
            const lastIdx = elements[elements.length - 1][0];
            const maxIndex = typeof lastIdx === "number" ? lastIdx : 0;
            const targetIndex = maxIndex + 1 + offset;
            // If target index is negative, return empty (out of bounds)
            if (targetIndex < 0) return "";
            // Find first element with index >= targetIndex
            startIdx = elements.findIndex(
              ([idx]) => typeof idx === "number" && idx >= targetIndex,
            );
            if (startIdx < 0) return ""; // All elements have smaller index
          }
        } else {
          // Positive offset: find first element with index >= offset
          startIdx = elements.findIndex(
            ([idx]) => typeof idx === "number" && idx >= offset,
          );
          if (startIdx < 0) return ""; // All elements have smaller index
        }

        if (length !== undefined) {
          if (length < 0) {
            // Negative length is an error for array slicing in bash
            throw new ArithmeticError(
              `${arrayMatch[1]}[@]: substring expression < 0`,
            );
          }
          // Take 'length' elements starting from startIdx
          return elements
            .slice(startIdx, startIdx + length)
            .map(([, v]) => v)
            .join(" ");
        }
        // Take all elements starting from startIdx
        return elements
          .slice(startIdx)
          .map(([, v]) => v)
          .join(" ");
      }

      // String slicing with UTF-8 support (slice by characters, not bytes)
      const chars = [...value]; // This handles multi-byte UTF-8 characters
      let start = offset;
      if (start < 0) start = Math.max(0, chars.length + start);
      if (length !== undefined) {
        if (length < 0) {
          // Negative length means end position from end
          const endPos = chars.length + length;
          return chars.slice(start, Math.max(start, endPos)).join("");
        }
        return chars.slice(start, start + length).join("");
      }
      return chars.slice(start).join("");
    }

    case "PatternRemoval": {
      // Build regex pattern from parts, preserving literal vs glob distinction
      let regexStr = "";
      const extglob = ctx.state.shoptOptions.extglob;
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            // Glob pattern - convert * and ? to regex equivalents
            regexStr += patternToRegex(part.pattern, operation.greedy, extglob);
          } else if (part.type === "Literal") {
            // Unquoted literal - treat as glob pattern (may contain *, ?, [...])
            regexStr += patternToRegex(part.value, operation.greedy, extglob);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            // Quoted text - escape all special regex and glob characters
            regexStr += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            // Double quoted - expand variables but treat result as literal
            const expanded = expandWordPartsSync(ctx, part.parts);
            regexStr += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            // Unquoted parameter expansion - treat expanded value as glob pattern
            const expanded = expandPartSync(ctx, part);
            regexStr += patternToRegex(expanded, operation.greedy, extglob);
          } else {
            // Other parts - expand and escape (command substitution, etc.)
            const expanded = expandPartSync(ctx, part);
            regexStr += escapeRegex(expanded);
          }
        }
      }

      // Use 's' flag (dotall) so that . matches newlines (bash ? matches any char including newline)
      if (operation.side === "prefix") {
        // Prefix removal: greedy matches longest from start, non-greedy matches shortest
        return value.replace(new RegExp(`^${regexStr}`, "s"), "");
      }
      // Suffix removal needs special handling because we need to find
      // the rightmost (shortest) or leftmost (longest) match
      const regex = new RegExp(`${regexStr}$`, "s");
      if (operation.greedy) {
        // %% - longest match: use regex directly (finds leftmost match)
        return value.replace(regex, "");
      }
      // % - shortest match: find rightmost position where pattern matches to end
      for (let i = value.length; i >= 0; i--) {
        const suffix = value.slice(i);
        if (regex.test(suffix)) {
          return value.slice(0, i);
        }
      }
      return value;
    }

    case "PatternReplacement": {
      // Build regex pattern from parts, preserving literal vs glob distinction
      let regex = "";
      const extglobRepl = ctx.state.shoptOptions.extglob;
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            // Glob pattern - convert * and ? to regex equivalents
            regex += patternToRegex(part.pattern, true, extglobRepl);
          } else if (part.type === "Literal") {
            // Unquoted literal - treat as glob pattern (may contain *, ?, [...], \X)
            regex += patternToRegex(part.value, true, extglobRepl);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            // Quoted text - escape all special regex and glob characters
            regex += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            // Double quoted - expand variables but treat result as literal
            const expanded = expandWordPartsSync(ctx, part.parts);
            regex += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            // Unquoted parameter expansion - treat expanded value as glob pattern
            // In bash, ${v//$pat/x} where pat='*' treats * as a glob
            const expanded = expandPartSync(ctx, part);
            regex += patternToRegex(expanded, true, extglobRepl);
          } else {
            // Other parts - expand and escape (command substitution, etc.)
            const expanded = expandPartSync(ctx, part);
            regex += escapeRegex(expanded);
          }
        }
      }

      const replacement = operation.replacement
        ? expandWordPartsSync(ctx, operation.replacement.parts)
        : "";

      // Apply anchor modifiers
      if (operation.anchor === "start") {
        regex = `^${regex}`;
      } else if (operation.anchor === "end") {
        regex = `${regex}$`;
      }

      // Empty pattern (without anchor) means no replacement - return original value
      // This prevents infinite loops and matches bash behavior
      // But with anchor, empty pattern is valid: ${var/#/prefix} prepends, ${var/%/suffix} appends
      if (regex === "") {
        return value;
      }

      // Use 's' flag (dotall) so that . matches newlines (bash ? and * match any char including newline)
      const flags = operation.all ? "gs" : "s";

      // Handle invalid regex patterns (like [z-a] which is an invalid range)
      // Bash just returns the original value when pattern doesn't match
      try {
        const re = new RegExp(regex, flags);
        if (operation.all) {
          // For global replace, avoid matching empty string at end which
          // JavaScript regex does but bash pattern matching doesn't
          let result = "";
          let lastIndex = 0;
          let match: RegExpExecArray | null = re.exec(value);
          while (match !== null) {
            // Skip empty matches (except at the start when pattern allows)
            if (match[0].length === 0 && match.index === value.length) {
              break;
            }
            result += value.slice(lastIndex, match.index) + replacement;
            lastIndex = match.index + match[0].length;
            // Prevent infinite loop on zero-length matches
            if (match[0].length === 0) {
              lastIndex++;
            }
            match = re.exec(value);
          }
          result += value.slice(lastIndex);
          return result;
        }
        return value.replace(re, replacement);
      } catch {
        // Invalid regex - return original value like bash does
        return value;
      }
    }

    case "CaseModification": {
      // If there's a pattern, only convert characters matching the pattern
      if (operation.pattern) {
        const extglob = ctx.state.shoptOptions.extglob;
        let patternRegexStr = "";
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            patternRegexStr += patternToRegex(part.pattern, true, extglob);
          } else if (part.type === "Literal") {
            patternRegexStr += patternToRegex(part.value, true, extglob);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            patternRegexStr += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = expandWordPartsSync(ctx, part.parts);
            patternRegexStr += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = expandParameter(ctx, part);
            patternRegexStr += patternToRegex(expanded, true, extglob);
          }
        }
        // Build a regex that matches a single character against the pattern
        // Anchor to match full character
        const charPattern = new RegExp(`^(?:${patternRegexStr})$`);
        const transform =
          operation.direction === "upper"
            ? (c: string) => c.toUpperCase()
            : (c: string) => c.toLowerCase();

        let result = "";
        let converted = false;
        for (const char of value) {
          if (!operation.all && converted) {
            // Non-all mode: only convert first match
            result += char;
          } else if (charPattern.test(char)) {
            result += transform(char);
            converted = true;
          } else {
            result += char;
          }
        }
        return result;
      }

      // No pattern - convert all or first character
      if (operation.direction === "upper") {
        return operation.all
          ? value.toUpperCase()
          : value.charAt(0).toUpperCase() + value.slice(1);
      }
      return operation.all
        ? value.toLowerCase()
        : value.charAt(0).toLowerCase() + value.slice(1);
    }

    case "Transform": {
      // Handle array transformations specially
      const arrayMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
      if (arrayMatch && operation.operator === "Q") {
        // ${arr[@]@Q} - quote each element
        const elements = getArrayElements(ctx, arrayMatch[1]);
        const quotedElements = elements.map(([, v]) => quoteValue(v));
        return quotedElements.join(" ");
      }
      if (arrayMatch && operation.operator === "a") {
        // ${arr[@]@a} - return attributes of array
        return getVariableAttributes(ctx, arrayMatch[1]);
      }

      // Handle array element references like ${arr[0]@a}
      const arrayElemMatch = parameter.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[.+\]$/,
      );
      if (arrayElemMatch && operation.operator === "a") {
        // ${arr[0]@a} - return attributes of the array itself
        return getVariableAttributes(ctx, arrayElemMatch[1]);
      }

      switch (operation.operator) {
        case "Q":
          // Quote the value for reuse as shell input
          // Returns empty for unset variables
          if (isUnset) return "";
          return quoteValue(value);
        case "P":
          // Expand prompt escape sequences
          return expandPrompt(ctx, value);
        case "a":
          // Return attribute flags for the variable
          return getVariableAttributes(ctx, parameter);
        case "A":
          // Assignment format: name='value'
          // Returns empty for unset variables
          if (isUnset) return "";
          return `${parameter}=${quoteValue(value)}`;
        case "E":
          // Expand escape sequences
          return value.replace(/\\([\\abefnrtv'"?])/g, (_, c) => {
            switch (c) {
              case "\\":
                return "\\";
              case "a":
                return "\x07";
              case "b":
                return "\b";
              case "e":
                return "\x1b";
              case "f":
                return "\f";
              case "n":
                return "\n";
              case "r":
                return "\r";
              case "t":
                return "\t";
              case "v":
                return "\v";
              case "'":
                return "'";
              case '"':
                return '"';
              case "?":
                return "?";
              default:
                return c;
            }
          });
        case "K":
          // For scalars, @K behaves like @Q (quoted value)
          // Returns empty for unset variables
          if (isUnset) return "";
          return quoteValue(value);
        case "k":
          // For scalars, @k behaves like @Q (quoted value)
          // Returns empty for unset variables
          if (isUnset) return "";
          return quoteValue(value);
        case "u":
          // Capitalize first character only (ucfirst)
          return value.charAt(0).toUpperCase() + value.slice(1);
        case "U":
          // Uppercase all characters
          return value.toUpperCase();
        case "L":
          // Lowercase all characters
          return value.toLowerCase();
        default:
          return value;
      }
    }

    case "Indirection": {
      // For namerefs, ${!ref} returns the name of the target variable (inverted behavior)
      // For regular variables, ${!ref} returns the value of the variable named by $ref
      if (isNameref(ctx, parameter)) {
        // Return the target name, not the value
        return getNamerefTarget(ctx, parameter) || "";
      }

      // Check if parameter is an array expansion pattern like a[@] or a[*]
      const isArrayExpansionPattern = /^[a-zA-Z_][a-zA-Z0-9_]*\[([@*])\]$/.test(
        parameter,
      );

      // Bash 5.0+ behavior: If the reference variable itself is unset,
      // handle based on whether there's an innerOp that deals with unset vars.
      if (isUnset) {
        // For ${!var+word} (UseAlternative): when var is unset, return empty
        // because there's no target to check, and the alternative only applies
        // when the TARGET is set.
        if (operation.innerOp?.type === "UseAlternative") {
          return "";
        }
        // For other cases (plain ${!var}, ${!var-...}, ${!var:=...} etc.), error
        throw new BadSubstitutionError(`\${!${parameter}}`);
      }

      // value contains the name of the parameter, get the target variable name
      const targetName = value;

      // Bash 5.0+ behavior: For array expansion patterns (a[@] or a[*]),
      // if the target name is empty or contains spaces (multiple array values joined),
      // it's not a valid variable name, so error.
      // For simple variable indirection (${!ref} where ref='bad name'), bash
      // returns empty string without error for compatibility.
      if (
        isArrayExpansionPattern &&
        (targetName === "" || targetName.includes(" "))
      ) {
        throw new BadSubstitutionError(`\${!${parameter}}`);
      }

      // Bash 5.0+ disallows tilde expansion in array subscripts via indirection
      // e.g., ref='a[~+]'; ${!ref} is an error
      // This was a bug in Bash 4.4 that was fixed in Bash 5.0
      const arraySubscriptMatch = targetName.match(
        /^[a-zA-Z_][a-zA-Z0-9_]*\[(.+)\]$/,
      );
      if (arraySubscriptMatch) {
        const subscript = arraySubscriptMatch[1];
        if (subscript.includes("~")) {
          throw new BadSubstitutionError(`\${!${parameter}}`);
        }
      }

      // If there's an inner operation (e.g., ${!ref-default}), apply it
      if (operation.innerOp) {
        // Create a synthetic part to recursively expand with the inner operation
        const syntheticPart: ParameterExpansionPart = {
          type: "ParameterExpansion",
          parameter: targetName,
          operation: operation.innerOp,
        };
        return expandParameter(ctx, syntheticPart, inDoubleQuotes);
      }

      return getVariable(ctx, targetName);
    }

    case "ArrayKeys": {
      // ${!arr[@]} or ${!arr[*]} - return the keys/indices of an array
      const elements = getArrayElements(ctx, operation.array);
      const keys = elements.map(([k]) => String(k));
      if (operation.star) {
        // ${!arr[*]} - join with first char of IFS
        return keys.join(getIfsSeparator(ctx.state.env));
      }
      // ${!arr[@]} - join with space
      return keys.join(" ");
    }

    case "VarNamePrefix": {
      // ${!prefix*} or ${!prefix@} - list variable names with prefix
      const matchingVars = getVarNamesWithPrefix(ctx, operation.prefix);
      if (operation.star) {
        // ${!prefix*} - join with first char of IFS
        return matchingVars.join(getIfsSeparator(ctx.state.env));
      }
      // ${!prefix@} - join with space
      return matchingVars.join(" ");
    }

    default:
      return value;
  }
}

/**
 * Expand command substitutions in an array subscript.
 * e.g., "$(echo 1)" -> "1"
 * This is needed for cases like ${a[$(echo 1)]} where the subscript
 * contains a command that must be executed.
 */
async function expandSubscriptCommandSubst(
  ctx: InterpreterContext,
  subscript: string,
): Promise<string> {
  // Look for $(...) patterns and execute them
  let result = "";
  let i = 0;
  while (i < subscript.length) {
    if (subscript[i] === "$" && subscript[i + 1] === "(") {
      // Find matching closing paren
      let depth = 1;
      let j = i + 2;
      while (j < subscript.length && depth > 0) {
        if (subscript[j] === "(" && subscript[j - 1] === "$") {
          depth++;
        } else if (subscript[j] === "(") {
          depth++;
        } else if (subscript[j] === ")") {
          depth--;
        }
        j++;
      }
      // Extract and execute the command
      const cmdStr = subscript.slice(i + 2, j - 1);
      if (ctx.execFn) {
        const cmdResult = await ctx.execFn(cmdStr);
        // Strip trailing newlines like command substitution does
        result += cmdResult.stdout.replace(/\n+$/, "");
        // Forward stderr to expansion stderr
        if (cmdResult.stderr) {
          ctx.state.expansionStderr =
            (ctx.state.expansionStderr || "") + cmdResult.stderr;
        }
      }
      i = j;
    } else if (subscript[i] === "`") {
      // Legacy backtick command substitution
      let j = i + 1;
      while (j < subscript.length && subscript[j] !== "`") {
        j++;
      }
      const cmdStr = subscript.slice(i + 1, j);
      if (ctx.execFn) {
        const cmdResult = await ctx.execFn(cmdStr);
        result += cmdResult.stdout.replace(/\n+$/, "");
        if (cmdResult.stderr) {
          ctx.state.expansionStderr =
            (ctx.state.expansionStderr || "") + cmdResult.stderr;
        }
      }
      i = j + 1;
    } else {
      result += subscript[i];
      i++;
    }
  }
  return result;
}

// Async version of expandParameter for parameter expansions that contain command substitution
async function expandParameterAsync(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
  inDoubleQuotes = false,
): Promise<string> {
  let { parameter } = part;
  const { operation } = part;

  // Handle command substitution in array subscript: ${a[$(echo 1)]}
  // We need to expand the subscript before calling getVariable
  const bracketMatch = parameter.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
  if (bracketMatch) {
    const [, arrayName, subscript] = bracketMatch;
    // Check if subscript contains command substitution
    if (subscript.includes("$(") || subscript.includes("`")) {
      const expandedSubscript = await expandSubscriptCommandSubst(
        ctx,
        subscript,
      );
      parameter = `${arrayName}[${expandedSubscript}]`;
    }
  } else if (
    // Handle nameref pointing to array subscript with command substitution:
    // typeset -n ref='a[$(echo 2) + 1]'; echo $ref
    /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(parameter) &&
    isNameref(ctx, parameter)
  ) {
    const target = resolveNameref(ctx, parameter);
    if (target && target !== parameter) {
      // Check if the resolved target is an array subscript with command substitution
      const targetBracketMatch = target.match(
        /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/,
      );
      if (targetBracketMatch) {
        const [, targetArrayName, targetSubscript] = targetBracketMatch;
        if (targetSubscript.includes("$(") || targetSubscript.includes("`")) {
          const expandedSubscript = await expandSubscriptCommandSubst(
            ctx,
            targetSubscript,
          );
          // Replace the nameref's stored target with the expanded one for this expansion
          // We need to call getVariable with the expanded target directly
          parameter = `${targetArrayName}[${expandedSubscript}]`;
        }
      }
    }
  }

  // Operations that handle unset variables should not trigger nounset
  const skipNounset =
    operation &&
    (operation.type === "DefaultValue" ||
      operation.type === "AssignDefault" ||
      operation.type === "UseAlternative" ||
      operation.type === "ErrorIfUnset");

  const value = getVariable(ctx, parameter, !skipNounset);

  if (!operation) {
    return value;
  }

  const isUnset = !isVariableSet(ctx, parameter);
  // For $* and $@, when checkEmpty is true (:-/:+), bash has special rules:
  // - $*: "empty" only if $# == 0 (even if IFS="" makes expansion empty)
  // - $@: "empty" if $# == 0 OR ($# == 1 AND $1 == "")
  // This is because $@ treats a single empty param as "empty" but $* does not.
  // For a[*] and a[@], similar rules apply based on array elements and IFS.
  let isEmptyAsync: boolean;
  let effectiveValueAsync = value; // For a[*], we need IFS-joined value, not space-joined
  const numParamsAsync = Number.parseInt(ctx.state.env["#"] || "0", 10);
  // Check if this is an array expansion: varname[*] or varname[@]
  const arrayExpMatchAsync = parameter.match(
    /^([a-zA-Z_][a-zA-Z0-9_]*)\[([@*])\]$/,
  );
  if (parameter === "*") {
    // $* is only "empty" if no positional params exist
    isEmptyAsync = numParamsAsync === 0;
  } else if (parameter === "@") {
    // $@ is "empty" if no params OR exactly one empty param
    isEmptyAsync =
      numParamsAsync === 0 ||
      (numParamsAsync === 1 && ctx.state.env["1"] === "");
  } else if (arrayExpMatchAsync) {
    // a[*] or a[@] - check if expansion is empty considering IFS
    const [, arrayName, subscript] = arrayExpMatchAsync;
    const elements = getArrayElements(ctx, arrayName);
    if (elements.length === 0) {
      // Empty array - always empty
      isEmptyAsync = true;
      effectiveValueAsync = "";
    } else if (subscript === "*") {
      // a[*] behavior depends on quoting context:
      // - Quoted "${a[*]:-default}": uses default if IFS-joined result is empty
      // - Unquoted ${a[*]:-default}: like $*, only "empty" if array has no elements
      //   (even if IFS="" makes the joined expansion an empty string)
      const ifsSep = getIfsSeparator(ctx.state.env);
      const joined = elements.map(([, v]) => v).join(ifsSep);
      isEmptyAsync = inDoubleQuotes ? joined === "" : false;
      effectiveValueAsync = joined; // Use IFS-joined value instead of space-joined
    } else {
      // a[@] - empty only if all elements are empty AND there's exactly one
      // (similar to $@ behavior with single empty param)
      isEmptyAsync =
        elements.length === 1 && elements.every(([, v]) => v === "");
      // For a[@], join with space (as getVariable does)
      effectiveValueAsync = elements.map(([, v]) => v).join(" ");
    }
  } else {
    isEmptyAsync = value === "";
  }

  switch (operation.type) {
    case "DefaultValue": {
      const useDefault = isUnset || (operation.checkEmpty && isEmptyAsync);
      if (useDefault && operation.word) {
        return expandWordPartsAsync(ctx, operation.word.parts, inDoubleQuotes);
      }
      return effectiveValueAsync;
    }

    case "AssignDefault": {
      const useDefault = isUnset || (operation.checkEmpty && isEmptyAsync);
      if (useDefault && operation.word) {
        const defaultValue = await expandWordPartsAsync(
          ctx,
          operation.word.parts,
          inDoubleQuotes,
        );
        // Handle array subscript assignment (e.g., arr[0]=x)
        const arrayMatch = parameter.match(
          /^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/,
        );
        if (arrayMatch) {
          const [, arrayName, subscriptExpr] = arrayMatch;
          // Evaluate subscript as arithmetic expression
          let index: number;
          if (/^\d+$/.test(subscriptExpr)) {
            index = Number.parseInt(subscriptExpr, 10);
          } else {
            try {
              const parser = new Parser();
              const arithAst = parseArithmeticExpression(parser, subscriptExpr);
              index = await evaluateArithmetic(ctx, arithAst.expression);
            } catch {
              const varValue = ctx.state.env[subscriptExpr];
              index = varValue ? Number.parseInt(varValue, 10) : 0;
            }
            if (Number.isNaN(index)) index = 0;
          }
          // Set array element
          ctx.state.env[`${arrayName}_${index}`] = defaultValue;
          // Update array length if needed
          const currentLength = Number.parseInt(
            ctx.state.env[`${arrayName}__length`] || "0",
            10,
          );
          if (index >= currentLength) {
            ctx.state.env[`${arrayName}__length`] = String(index + 1);
          }
        } else {
          ctx.state.env[parameter] = defaultValue;
        }
        return defaultValue;
      }
      return effectiveValueAsync;
    }

    case "ErrorIfUnset": {
      const shouldError = isUnset || (operation.checkEmpty && isEmptyAsync);
      if (shouldError) {
        const message = operation.word
          ? await expandWordPartsAsync(
              ctx,
              operation.word.parts,
              inDoubleQuotes,
            )
          : `${parameter}: parameter null or not set`;
        throw new ExitError(1, "", `bash: ${message}\n`);
      }
      return effectiveValueAsync;
    }

    case "UseAlternative": {
      const useAlternative = !(
        isUnset ||
        (operation.checkEmpty && isEmptyAsync)
      );
      if (useAlternative && operation.word) {
        return expandWordPartsAsync(ctx, operation.word.parts, inDoubleQuotes);
      }
      return "";
    }

    case "PatternRemoval": {
      // Build regex pattern from parts, preserving literal vs glob distinction
      let regexStr = "";
      const extglobAsync = ctx.state.shoptOptions.extglob;
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            regexStr += patternToRegex(
              part.pattern,
              operation.greedy,
              extglobAsync,
            );
          } else if (part.type === "Literal") {
            // Unquoted literal - treat as glob pattern (may contain *, ?, [...])
            regexStr += patternToRegex(
              part.value,
              operation.greedy,
              extglobAsync,
            );
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            regexStr += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = await expandWordPartsAsync(ctx, part.parts);
            regexStr += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = await expandPart(ctx, part);
            regexStr += patternToRegex(
              expanded,
              operation.greedy,
              extglobAsync,
            );
          } else {
            const expanded = await expandPart(ctx, part);
            regexStr += escapeRegex(expanded);
          }
        }
      }

      // Use 's' flag (dotall) so that . matches newlines (bash ? matches any char including newline)
      if (operation.side === "prefix") {
        return value.replace(new RegExp(`^${regexStr}`, "s"), "");
      }
      const regex = new RegExp(`${regexStr}$`, "s");
      if (operation.greedy) {
        return value.replace(regex, "");
      }
      for (let i = value.length; i >= 0; i--) {
        const suffix = value.slice(i);
        if (regex.test(suffix)) {
          return value.slice(0, i);
        }
      }
      return value;
    }

    case "PatternReplacement": {
      let regex = "";
      const extglobReplAsync = ctx.state.shoptOptions.extglob;
      if (operation.pattern) {
        for (const part of operation.pattern.parts) {
          if (part.type === "Glob") {
            regex += patternToRegex(part.pattern, true, extglobReplAsync);
          } else if (part.type === "Literal") {
            // Unquoted literal - treat as glob pattern (may contain *, ?, [...], \X)
            regex += patternToRegex(part.value, true, extglobReplAsync);
          } else if (part.type === "SingleQuoted" || part.type === "Escaped") {
            regex += escapeRegex(part.value);
          } else if (part.type === "DoubleQuoted") {
            const expanded = await expandWordPartsAsync(ctx, part.parts);
            regex += escapeRegex(expanded);
          } else if (part.type === "ParameterExpansion") {
            const expanded = await expandPart(ctx, part);
            regex += patternToRegex(expanded, true, extglobReplAsync);
          } else {
            const expanded = await expandPart(ctx, part);
            regex += escapeRegex(expanded);
          }
        }
      }

      const replacement = operation.replacement
        ? await expandWordPartsAsync(ctx, operation.replacement.parts)
        : "";

      // Apply anchor modifiers
      if (operation.anchor === "start") {
        regex = `^${regex}`;
      } else if (operation.anchor === "end") {
        regex = `${regex}$`;
      }

      // Empty pattern (without anchor) means no replacement - return original value
      // But with anchor, empty pattern is valid: ${var/#/prefix} prepends, ${var/%/suffix} appends
      if (regex === "") {
        return value;
      }

      // Use 's' flag (dotall) so that . matches newlines (bash ? and * match any char including newline)
      const flags = operation.all ? "gs" : "s";

      try {
        const re = new RegExp(regex, flags);
        if (operation.all) {
          let result = "";
          let lastIndex = 0;
          let match: RegExpExecArray | null = re.exec(value);
          while (match !== null) {
            if (match[0].length === 0 && match.index === value.length) {
              break;
            }
            result += value.slice(lastIndex, match.index) + replacement;
            lastIndex = match.index + match[0].length;
            if (match[0].length === 0) {
              lastIndex++;
            }
            match = re.exec(value);
          }
          result += value.slice(lastIndex);
          return result;
        }
        return value.replace(re, replacement);
      } catch {
        return value;
      }
    }

    // Other operations don't have words with command substitution, use sync
    default:
      return expandParameter(ctx, part, inDoubleQuotes);
  }
}
