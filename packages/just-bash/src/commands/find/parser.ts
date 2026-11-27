// Parser for find expressions

import { parseBareISOInTimezone } from "../date/date.js";
import type { Expression, ParseResult, SizeUnit } from "./types.js";

// Token types for parsing
type Token =
  | { type: "expr"; expr: Expression }
  | { type: "op"; op: "and" | "or" }
  | { type: "not" }
  | { type: "lparen" }
  | { type: "rparen" };

export function parseExpressions(
  args: string[],
  startIndex: number,
  options: { tz?: string } = {},
): ParseResult {
  // Parse into tokens: expressions, operators, negations, and parentheses
  const tokens: Token[] = [];
  let i = startIndex;

  const missingArgument = (predicate: string): ParseResult => ({
    expr: null,
    pathIndex: i,
    error: `find: missing argument to \`${predicate}'\n`,
  });

  const invalidArgument = (predicate: string, value: string): ParseResult => ({
    expr: null,
    pathIndex: i,
    error: `find: invalid argument \`${value}' to \`${predicate}'\n`,
  });

  while (i < args.length) {
    const arg = args[i];

    // Handle parentheses for grouping
    if (arg === "(" || arg === "\\(") {
      tokens.push({ type: "lparen" });
      i++;
      continue;
    }
    if (arg === ")" || arg === "\\)") {
      tokens.push({ type: "rparen" });
      i++;
      continue;
    }

    if (arg === "-name") {
      if (i + 1 >= args.length) return missingArgument(arg);
      tokens.push({ type: "expr", expr: { type: "name", pattern: args[++i] } });
    } else if (arg === "-iname") {
      if (i + 1 >= args.length) return missingArgument(arg);
      tokens.push({
        type: "expr",
        expr: { type: "name", pattern: args[++i], ignoreCase: true },
      });
    } else if (arg === "-path") {
      if (i + 1 >= args.length) return missingArgument(arg);
      tokens.push({ type: "expr", expr: { type: "path", pattern: args[++i] } });
    } else if (arg === "-ipath") {
      if (i + 1 >= args.length) return missingArgument(arg);
      tokens.push({
        type: "expr",
        expr: { type: "path", pattern: args[++i], ignoreCase: true },
      });
    } else if (arg === "-regex") {
      if (i + 1 >= args.length) return missingArgument(arg);
      tokens.push({
        type: "expr",
        expr: { type: "regex", pattern: args[++i] },
      });
    } else if (arg === "-iregex") {
      if (i + 1 >= args.length) return missingArgument(arg);
      tokens.push({
        type: "expr",
        expr: { type: "regex", pattern: args[++i], ignoreCase: true },
      });
    } else if (arg === "-type") {
      if (i + 1 >= args.length) return missingArgument(arg);
      const fileType = args[++i];
      if (fileType === "f" || fileType === "d") {
        tokens.push({ type: "expr", expr: { type: "type", fileType } });
      } else {
        return {
          expr: null,
          pathIndex: i,
          error: `find: Unknown argument to -type: ${fileType}\n`,
        };
      }
    } else if (arg === "-empty") {
      tokens.push({ type: "expr", expr: { type: "empty" } });
    } else if (arg === "-mtime") {
      if (i + 1 >= args.length) return missingArgument(arg);
      const mtimeArg = args[++i];
      let comparison: "exact" | "more" | "less" = "exact";
      let daysStr = mtimeArg;
      if (mtimeArg.startsWith("+")) {
        comparison = "more";
        daysStr = mtimeArg.slice(1);
      } else if (mtimeArg.startsWith("-")) {
        comparison = "less";
        daysStr = mtimeArg.slice(1);
      }
      if (!/^\d+$/.test(daysStr)) return invalidArgument(arg, mtimeArg);
      const days = Number(daysStr);
      if (!Number.isSafeInteger(days)) return invalidArgument(arg, mtimeArg);
      tokens.push({
        type: "expr",
        expr: { type: "mtime", days, comparison },
      });
    } else if (arg === "-mmin") {
      if (i + 1 >= args.length) return missingArgument(arg);
      const mminArg = args[++i];
      let comparison: "exact" | "more" | "less" = "exact";
      let minutesStr = mminArg;
      if (mminArg.startsWith("+")) {
        comparison = "more";
        minutesStr = mminArg.slice(1);
      } else if (mminArg.startsWith("-")) {
        comparison = "less";
        minutesStr = mminArg.slice(1);
      }
      if (!/^\d+$/.test(minutesStr)) return invalidArgument(arg, mminArg);
      const minutes = Number(minutesStr);
      if (!Number.isSafeInteger(minutes)) return invalidArgument(arg, mminArg);
      tokens.push({
        type: "expr",
        expr: { type: "mmin", minutes, comparison },
      });
    } else if (arg === "-newermt") {
      if (i + 1 >= args.length) return missingArgument(arg);
      const dateArg = args[++i];
      const time = parseDateArgument(dateArg, options.tz);
      if (time === undefined) {
        return {
          expr: null,
          pathIndex: i,
          error: `find: I cannot figure out how to interpret \`${dateArg}' as a date or time\n`,
        };
      }
      tokens.push({ type: "expr", expr: { type: "newermt", time } });
    } else if (arg === "-newer") {
      if (i + 1 >= args.length) return missingArgument(arg);
      const refPath = args[++i];
      tokens.push({ type: "expr", expr: { type: "newer", refPath } });
    } else if (arg === "-size") {
      if (i + 1 >= args.length) return missingArgument(arg);
      const sizeArg = args[++i];
      let comparison: "exact" | "more" | "less" = "exact";
      let sizeStr = sizeArg;
      if (sizeArg.startsWith("+")) {
        comparison = "more";
        sizeStr = sizeArg.slice(1);
      } else if (sizeArg.startsWith("-")) {
        comparison = "less";
        sizeStr = sizeArg.slice(1);
      }
      // Parse size with optional suffix (c=bytes, k=KB, M=MB, G=GB, default=512-byte blocks)
      const sizeMatch = sizeStr.match(/^(\d+)([ckMGb])?$/);
      if (!sizeMatch) return invalidArgument(arg, sizeArg);
      const value = Number(sizeMatch[1]);
      if (!Number.isSafeInteger(value)) return invalidArgument(arg, sizeArg);
      const unit = (sizeMatch[2] || "b") as SizeUnit;
      const multiplier =
        unit === "G"
          ? 1024 ** 3
          : unit === "M"
            ? 1024 ** 2
            : unit === "k"
              ? 1024
              : unit === "b"
                ? 512
                : 1;
      if (!Number.isSafeInteger(value * multiplier)) {
        return invalidArgument(arg, sizeArg);
      }
      tokens.push({
        type: "expr",
        expr: { type: "size", value, unit, comparison },
      });
    } else if (arg === "-perm") {
      if (i + 1 >= args.length) return missingArgument(arg);
      const permArg = args[++i];
      // Parse permission mode: octal, -mode (all bits), /mode (any bit)
      let matchType: "exact" | "all" | "any" = "exact";
      let modeStr = permArg;
      if (permArg.startsWith("-")) {
        matchType = "all";
        modeStr = permArg.slice(1);
      } else if (permArg.startsWith("/")) {
        matchType = "any";
        modeStr = permArg.slice(1);
      }
      // Parse as octal
      if (!/^[0-7]{1,4}$/.test(modeStr)) return invalidArgument(arg, permArg);
      const mode = Number.parseInt(modeStr, 8);
      tokens.push({
        type: "expr",
        expr: { type: "perm", mode, matchType },
      });
    } else if (arg === "-prune") {
      tokens.push({ type: "expr", expr: { type: "prune" } });
    } else if (arg === "-not" || arg === "!") {
      tokens.push({ type: "not" });
    } else if (arg === "-o" || arg === "-or") {
      tokens.push({ type: "op", op: "or" });
    } else if (arg === "-a" || arg === "-and") {
      tokens.push({ type: "op", op: "and" });
    } else if (arg === "-maxdepth" || arg === "-mindepth") {
      // These are handled separately, skip them
      if (i + 1 >= args.length) return missingArgument(arg);
      i++;
    } else if (arg === "-depth") {
      // Handled separately in find.ts, skip it
    } else if (arg === "-exec") {
      // Parse -exec command {} ; or -exec command {} +
      const commandParts: string[] = [];
      i++;
      while (i < args.length && args[i] !== ";" && args[i] !== "+") {
        commandParts.push(args[i]);
        i++;
      }
      if (i >= args.length) {
        return {
          expr: null,
          pathIndex: i,
          error: "find: missing argument to `-exec'\n",
        };
      }
      if (commandParts.length === 0) {
        return missingArgument("-exec");
      }
      const batchMode = args[i] === "+";
      if (
        batchMode &&
        (commandParts.at(-1) !== "{}" ||
          commandParts.filter((part) => part === "{}").length !== 1)
      ) {
        return invalidArgument("-exec", "+");
      }
      tokens.push({
        type: "expr",
        expr: {
          type: "action",
          action: { type: "exec", command: commandParts, batchMode },
        },
      });
    } else if (arg === "-print") {
      tokens.push({
        type: "expr",
        expr: { type: "action", action: { type: "print" } },
      });
    } else if (arg === "-print0") {
      tokens.push({
        type: "expr",
        expr: { type: "action", action: { type: "print0" } },
      });
    } else if (arg === "-printf") {
      if (i + 1 >= args.length) return missingArgument(arg);
      const format = args[++i];
      tokens.push({
        type: "expr",
        expr: { type: "action", action: { type: "printf", format } },
      });
    } else if (arg === "-delete") {
      tokens.push({
        type: "expr",
        expr: { type: "action", action: { type: "delete" } },
      });
    } else if (arg.startsWith("-")) {
      // Unknown predicate
      return {
        expr: null,
        pathIndex: i,
        error: `find: unknown predicate '${arg}'\n`,
      };
    } else {
      return {
        expr: null,
        pathIndex: i,
        error: `find: paths must precede expression: \`${arg}'\n`,
      };
    }
    i++;
  }

  if (tokens.length === 0) {
    return { expr: null, pathIndex: i };
  }

  // Build expression tree using recursive descent parsing
  // Handles: parentheses > NOT > AND > OR (precedence high to low)
  const result = buildExpressionTree(tokens);
  if (result.error) {
    return { expr: null, pathIndex: i, error: result.error };
  }

  return { expr: result.expr, pathIndex: i };
}

/**
 * Recursive descent parser for find expressions with proper precedence:
 * - Parentheses have highest precedence
 * - NOT binds tightly to the next expression
 * - AND (implicit or explicit) binds tighter than OR
 * - OR has lowest precedence
 */
function buildExpressionTree(tokens: Token[]): {
  expr: Expression | null;
  error?: string;
} {
  let pos = 0;
  let error: string | undefined;

  // Parse OR expressions (lowest precedence)
  function parseOr(): Expression | null {
    let left = parseAnd();
    if (!left) return null;

    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token.type === "op" && token.op === "or") {
        pos++;
        const right = parseAnd();
        if (!right) {
          error = "find: expected an expression after `-o'\n";
          return null;
        }
        left = { type: "or", left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // Parse AND expressions (implicit or explicit -a)
  function parseAnd(): Expression | null {
    let left = parseNot();
    if (!left) return null;

    while (pos < tokens.length) {
      const token = tokens[pos];
      // Explicit AND
      if (token.type === "op" && token.op === "and") {
        pos++;
        const right = parseNot();
        if (!right) {
          error = "find: expected an expression after `-a'\n";
          return null;
        }
        left = { type: "and", left, right };
      }
      // Implicit AND: two adjacent expressions (not OR, not rparen)
      else if (
        token.type === "expr" ||
        token.type === "not" ||
        token.type === "lparen"
      ) {
        const right = parseNot();
        if (!right) return left;
        left = { type: "and", left, right };
      } else {
        break;
      }
    }
    return left;
  }

  // Parse NOT expressions
  function parseNot(): Expression | null {
    if (pos < tokens.length && tokens[pos].type === "not") {
      pos++;
      const expr = parseNot(); // NOT can chain: ! ! expr
      if (!expr) {
        error = "find: expected an expression after `!'\n";
        return null;
      }
      return { type: "not", expr };
    }
    return parsePrimary();
  }

  // Parse primary expressions (atoms and parenthesized groups)
  function parsePrimary(): Expression | null {
    if (pos >= tokens.length) return null;

    const token = tokens[pos];

    // Parenthesized group
    if (token.type === "lparen") {
      pos++;
      const expr = parseOr();
      if (!expr || pos >= tokens.length || tokens[pos].type !== "rparen") {
        error = "find: missing closing `)'\n";
        return null;
      }
      pos++;
      return expr;
    }

    // Simple expression
    if (token.type === "expr") {
      pos++;
      return token.expr;
    }

    // Skip rparen (handled by lparen case)
    if (token.type === "rparen") {
      return null;
    }

    return null;
  }

  const expr = parseOr();
  if (!error && pos < tokens.length) {
    error =
      tokens[pos].type === "rparen"
        ? "find: unexpected `)'\n"
        : "find: invalid expression\n";
  }
  if (!error && expr && containsNegatedDelete(expr)) {
    error = "find: refusing to evaluate `-delete' under negation\n";
  }
  return { expr: error ? null : expr, error };
}

function containsNegatedDelete(expr: Expression, negated = false): boolean {
  if (expr.type === "action") {
    return negated && expr.action.type === "delete";
  }
  if (expr.type === "not") return containsNegatedDelete(expr.expr, !negated);
  if (expr.type === "and" || expr.type === "or") {
    return (
      containsNegatedDelete(expr.left, negated) ||
      containsNegatedDelete(expr.right, negated)
    );
  }
  return false;
}

/**
 * Read a -newermt date: a date alone (`2026-09-20`) or with a time
 * (`2026-09-20 14:30`, `2026-09-20T14:30:00`) is wall-clock time in `tz`, or
 * in UTC without one, and an ISO string carrying `Z` or an offset is that
 * instant. Returns ms since the epoch, or undefined for a string it cannot
 * read or a date or time that does not exist (`2026-02-31`, `10:60`).
 */
function parseDateArgument(value: string, tz?: string): number | undefined {
  const text = value.trim();
  const bare =
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (bare) {
    const [, y, mo, d, h = "00", mi = "00", sec = "00"] = bare;
    const wall = Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(sec),
    );
    // Date.UTC carries an overflow into the next field (2026-02-31 is March
    // 3rd, 10:60 is 11:00), so a component that did not survive is invalid.
    const check = new Date(wall);
    if (
      check.getUTCFullYear() !== Number(y) ||
      check.getUTCMonth() !== Number(mo) - 1 ||
      check.getUTCDate() !== Number(d) ||
      check.getUTCHours() !== Number(h) ||
      check.getUTCMinutes() !== Number(mi) ||
      check.getUTCSeconds() !== Number(sec)
    ) {
      return undefined;
    }
    if (!tz) return wall;
    return parseBareISOInTimezone(
      `${y}-${mo}-${d}T${h}:${mi}:${sec}`,
      tz,
    )?.getTime();
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    return undefined;
  }
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : time;
}
