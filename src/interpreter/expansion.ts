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
  ParameterExpansionPart,
  WordNode,
  WordPart,
} from "../ast/types.js";
import { GlobExpander } from "../shell/glob.js";
import { evaluateArithmetic } from "./arithmetic.js";
import type { InterpreterContext } from "./types.js";

// Helper to extract numeric value from an arithmetic expression
function getArithValue(expr: ArithExpr): number {
  if (expr.type === "ArithNumber") {
    return expr.value;
  }
  return 0;
}

// Helper to extract literal value from a word part
function getPartValue(part: WordPart): string {
  switch (part.type) {
    case "Literal":
    case "SingleQuoted":
    case "Escaped":
      return part.value;
    default:
      return "";
  }
}

// Helper to get string value from word parts
function getWordPartsValue(parts: WordPart[]): string {
  return parts.map(getPartValue).join("");
}

// Check if a word part requires async execution
function partNeedsAsync(part: WordPart): boolean {
  switch (part.type) {
    case "CommandSubstitution":
      return true;
    case "DoubleQuoted":
      return part.parts.some(partNeedsAsync);
    case "BraceExpansion":
      return part.items.some(
        (item) => item.type === "Word" && wordNeedsAsync(item.word),
      );
    default:
      return false;
  }
}

// Check if a word requires async execution
function wordNeedsAsync(word: WordNode): boolean {
  return word.parts.some(partNeedsAsync);
}

// Sync version of expandPart for parts that don't need async
function expandPartSync(ctx: InterpreterContext, part: WordPart): string {
  switch (part.type) {
    case "Literal":
      return part.value;

    case "SingleQuoted":
      return part.value;

    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        parts.push(expandPartSync(ctx, p));
      }
      return parts.join("");
    }

    case "Escaped":
      return part.value;

    case "ParameterExpansion":
      return expandParameter(ctx, part);

    case "ArithmeticExpansion": {
      const value = evaluateArithmetic(ctx, part.expression.expression);
      return String(value);
    }

    case "TildeExpansion":
      if (part.user === null) {
        return ctx.state.env.HOME || "/home/user";
      }
      return `/home/${part.user}`;

    case "BraceExpansion": {
      const results: string[] = [];
      for (const item of part.items) {
        if (item.type === "Range") {
          const start = item.start;
          const end = item.end;
          if (typeof start === "number" && typeof end === "number") {
            const step = item.step || 1;
            if (start <= end) {
              for (let i = start; i <= end; i += step) results.push(String(i));
            } else {
              for (let i = start; i >= end; i -= step) results.push(String(i));
            }
          } else if (typeof start === "string" && typeof end === "string") {
            const startCode = start.charCodeAt(0);
            const endCode = end.charCodeAt(0);
            if (startCode <= endCode) {
              for (let i = startCode; i <= endCode; i++)
                results.push(String.fromCharCode(i));
            } else {
              for (let i = startCode; i >= endCode; i--)
                results.push(String.fromCharCode(i));
            }
          }
        } else {
          results.push(expandWordSync(ctx, item.word));
        }
      }
      return results.join(" ");
    }

    case "Glob":
      return part.pattern;

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

// Analyze word parts for expansion behavior
function analyzeWordParts(parts: WordPart[]): {
  hasQuoted: boolean;
  hasCommandSub: boolean;
  hasArrayVar: boolean;
} {
  let hasQuoted = false;
  let hasCommandSub = false;
  let hasArrayVar = false;

  for (const part of parts) {
    if (part.type === "SingleQuoted" || part.type === "DoubleQuoted") {
      hasQuoted = true;
    }
    if (part.type === "CommandSubstitution") {
      hasCommandSub = true;
    }
    if (
      part.type === "ParameterExpansion" &&
      (part.parameter === "@" || part.parameter === "*")
    ) {
      hasArrayVar = true;
    }
  }

  return { hasQuoted, hasCommandSub, hasArrayVar };
}

export async function expandWordWithGlob(
  ctx: InterpreterContext,
  word: WordNode,
): Promise<{ values: string[]; quoted: boolean }> {
  const wordParts = word.parts;
  const { hasQuoted, hasCommandSub, hasArrayVar } = analyzeWordParts(wordParts);

  // Fast path: no async needed, use sync expansion
  const needsAsync = wordNeedsAsync(word);
  const value = needsAsync
    ? await expandWordAsync(ctx, word)
    : expandWordSync(ctx, word);

  if (!hasQuoted && (hasCommandSub || hasArrayVar) && value.includes(" ")) {
    const splitValues = value.split(/\s+/).filter((v) => v !== "");
    if (splitValues.length > 1) {
      return { values: splitValues, quoted: false };
    }
  }

  if (!hasQuoted && /[*?[]/.test(value)) {
    const globExpander = new GlobExpander(ctx.fs, ctx.state.cwd);
    const matches = await globExpander.expand(value);
    if (matches.length > 0) {
      return { values: matches, quoted: false };
    }
  }

  return { values: [value], quoted: hasQuoted };
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

async function expandPart(
  ctx: InterpreterContext,
  part: WordPart,
): Promise<string> {
  switch (part.type) {
    case "Literal":
      return part.value;

    case "SingleQuoted":
      return part.value;

    case "DoubleQuoted": {
      const parts: string[] = [];
      for (const p of part.parts) {
        parts.push(await expandPart(ctx, p));
      }
      return parts.join("");
    }

    case "Escaped":
      return part.value;

    case "ParameterExpansion":
      return expandParameter(ctx, part);

    case "CommandSubstitution": {
      const result = await ctx.executeScript(part.body);
      return result.stdout.replace(/\n+$/, "");
    }

    case "ArithmeticExpansion": {
      const value = evaluateArithmetic(ctx, part.expression.expression);
      return String(value);
    }

    case "TildeExpansion":
      if (part.user === null) {
        return ctx.state.env.HOME || "/home/user";
      }
      return `/home/${part.user}`;

    case "BraceExpansion": {
      const results: string[] = [];
      for (const item of part.items) {
        if (item.type === "Range") {
          const start = item.start;
          const end = item.end;
          if (typeof start === "number" && typeof end === "number") {
            const step = item.step || 1;
            if (start <= end) {
              for (let i = start; i <= end; i += step) results.push(String(i));
            } else {
              for (let i = start; i >= end; i -= step) results.push(String(i));
            }
          } else if (typeof start === "string" && typeof end === "string") {
            const startCode = start.charCodeAt(0);
            const endCode = end.charCodeAt(0);
            if (startCode <= endCode) {
              for (let i = startCode; i <= endCode; i++)
                results.push(String.fromCharCode(i));
            } else {
              for (let i = startCode; i >= endCode; i--)
                results.push(String.fromCharCode(i));
            }
          }
        } else {
          results.push(await expandWord(ctx, item.word));
        }
      }
      return results.join(" ");
    }

    case "Glob":
      return part.pattern;

    default:
      return "";
  }
}

function expandParameter(
  ctx: InterpreterContext,
  part: ParameterExpansionPart,
): string {
  const { parameter, operation } = part;
  const value = getVariable(ctx, parameter);

  if (!operation) {
    return value;
  }

  const isUnset = !(parameter in ctx.state.env);
  const isEmpty = value === "";

  switch (operation.type) {
    case "DefaultValue": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        return getWordPartsValue(operation.word.parts);
      }
      return value;
    }

    case "AssignDefault": {
      const useDefault = isUnset || (operation.checkEmpty && isEmpty);
      if (useDefault && operation.word) {
        const defaultValue = getWordPartsValue(operation.word.parts);
        ctx.state.env[parameter] = defaultValue;
        return defaultValue;
      }
      return value;
    }

    case "ErrorIfUnset": {
      const shouldError = isUnset || (operation.checkEmpty && isEmpty);
      if (shouldError) {
        const message = operation.word
          ? getWordPartsValue(operation.word.parts)
          : `${parameter}: parameter null or not set`;
        throw new Error(message);
      }
      return value;
    }

    case "UseAlternative": {
      const useAlternative = !(isUnset || (operation.checkEmpty && isEmpty));
      if (useAlternative && operation.word) {
        return getWordPartsValue(operation.word.parts);
      }
      return "";
    }

    case "Length":
      return String(value.length);

    case "Substring": {
      const offset = operation.offset
        ? getArithValue(operation.offset.expression)
        : 0;
      const length = operation.length
        ? getArithValue(operation.length.expression)
        : undefined;
      let start = offset;
      if (start < 0) start = Math.max(0, value.length + start);
      if (length !== undefined) {
        if (length < 0) {
          return value.slice(start, Math.max(start, value.length + length));
        }
        return value.slice(start, start + length);
      }
      return value.slice(start);
    }

    case "PatternRemoval": {
      const pattern = operation.pattern
        ? getWordPartsValue(operation.pattern.parts)
        : "";
      const regex = patternToRegex(pattern, operation.greedy);
      if (operation.side === "prefix") {
        return value.replace(new RegExp(`^${regex}`), "");
      }
      return value.replace(new RegExp(`${regex}$`), "");
    }

    case "PatternReplacement": {
      const pattern = operation.pattern
        ? getWordPartsValue(operation.pattern.parts)
        : "";
      const replacement = operation.replacement
        ? getWordPartsValue(operation.replacement.parts)
        : "";
      const regex = patternToRegex(pattern, true);
      const flags = operation.all ? "g" : "";
      return value.replace(new RegExp(regex, flags), replacement);
    }

    case "CaseModification": {
      if (operation.direction === "upper") {
        return operation.all
          ? value.toUpperCase()
          : value.charAt(0).toUpperCase() + value.slice(1);
      }
      return operation.all
        ? value.toLowerCase()
        : value.charAt(0).toLowerCase() + value.slice(1);
    }

    case "Indirection": {
      return getVariable(ctx, value);
    }

    default:
      return value;
  }
}

export function getVariable(ctx: InterpreterContext, name: string): string {
  switch (name) {
    case "?":
      return String(ctx.state.lastExitCode);
    case "$":
      return String(process.pid);
    case "#":
      return ctx.state.env["#"] || "0";
    case "@":
    case "*":
      return ctx.state.env["@"] || "";
    case "0":
      return ctx.state.env["0"] || "bash";
    case "PWD":
      return ctx.state.cwd;
    case "OLDPWD":
      return ctx.state.previousDir;
  }

  if (/^[1-9][0-9]*$/.test(name)) {
    return ctx.state.env[name] || "";
  }

  return ctx.state.env[name] || "";
}

export function patternToRegex(pattern: string, greedy: boolean): string {
  let regex = "";
  for (const char of pattern) {
    if (char === "*") {
      regex += greedy ? ".*" : ".*?";
    } else if (char === "?") {
      regex += ".";
    } else if (/[\\^$.|+(){}[\]]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  return regex;
}
