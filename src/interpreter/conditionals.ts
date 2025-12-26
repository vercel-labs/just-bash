/**
 * Conditional Expression Evaluation
 *
 * Handles:
 * - [[ ... ]] conditional commands
 * - [ ... ] and test commands
 * - File tests (-f, -d, -e, etc.)
 * - String tests (-z, -n, =, !=)
 * - Numeric comparisons (-eq, -ne, -lt, etc.)
 * - Pattern matching (==, =~)
 */

import type { ConditionalExpressionNode } from "../ast/types.js";
import { parseArithmeticExpression } from "../parser/arithmetic-parser.js";
import { Parser } from "../parser/parser.js";
import type { ExecResult } from "../types.js";
import { evaluateArithmeticSync } from "./arithmetic.js";
import { expandWord } from "./expansion.js";
import type { InterpreterContext } from "./types.js";

export async function evaluateConditional(
  ctx: InterpreterContext,
  expr: ConditionalExpressionNode,
): Promise<boolean> {
  switch (expr.type) {
    case "CondBinary": {
      const left = await expandWord(ctx, expr.left);
      const right = await expandWord(ctx, expr.right);

      // Check if RHS is fully quoted (should be treated literally, not as pattern)
      const isRhsQuoted =
        expr.right.parts.length > 0 &&
        expr.right.parts.every(
          (p) =>
            p.type === "SingleQuoted" ||
            p.type === "DoubleQuoted" ||
            p.type === "Escaped",
        );

      switch (expr.operator) {
        case "==":
        case "=":
          // If RHS is quoted, use literal comparison; otherwise use pattern matching
          return isRhsQuoted ? left === right : matchPattern(left, right);
        case "!=":
          return isRhsQuoted ? left !== right : !matchPattern(left, right);
        case "=~": {
          try {
            const regex = new RegExp(right);
            const match = left.match(regex);
            if (match) {
              ctx.state.env.BASH_REMATCH = match[0];
              for (let i = 1; i < match.length; i++) {
                ctx.state.env[`BASH_REMATCH_${i}`] = match[i] || "";
              }
            }
            return match !== null;
          } catch {
            return false;
          }
        }
        case "<":
          return left < right;
        case ">":
          return left > right;
        case "-eq":
          return evalArithExpr(ctx, left) === evalArithExpr(ctx, right);
        case "-ne":
          return evalArithExpr(ctx, left) !== evalArithExpr(ctx, right);
        case "-lt":
          return evalArithExpr(ctx, left) < evalArithExpr(ctx, right);
        case "-le":
          return evalArithExpr(ctx, left) <= evalArithExpr(ctx, right);
        case "-gt":
          return evalArithExpr(ctx, left) > evalArithExpr(ctx, right);
        case "-ge":
          return evalArithExpr(ctx, left) >= evalArithExpr(ctx, right);
        case "-nt":
        case "-ot":
        case "-ef":
          return false;
        default:
          return false;
      }
    }

    case "CondUnary": {
      const operand = await expandWord(ctx, expr.operand);

      switch (expr.operator) {
        case "-z":
          return operand === "";
        case "-n":
          return operand !== "";
        case "-e":
        case "-a":
          return await ctx.fs.exists(resolvePath(ctx, operand));
        case "-f": {
          const path = resolvePath(ctx, operand);
          if (await ctx.fs.exists(path)) {
            const stat = await ctx.fs.stat(path);
            return stat.isFile;
          }
          return false;
        }
        case "-d": {
          const path = resolvePath(ctx, operand);
          if (await ctx.fs.exists(path)) {
            const stat = await ctx.fs.stat(path);
            return stat.isDirectory;
          }
          return false;
        }
        case "-r":
        case "-w":
        case "-x":
          return await ctx.fs.exists(resolvePath(ctx, operand));
        case "-s": {
          const path = resolvePath(ctx, operand);
          if (await ctx.fs.exists(path)) {
            const content = await ctx.fs.readFile(path);
            return content.length > 0;
          }
          return false;
        }
        case "-L":
        case "-h": {
          const path = resolvePath(ctx, operand);
          if (await ctx.fs.exists(path)) {
            const stat = await ctx.fs.lstat(path);
            return stat.isSymbolicLink;
          }
          return false;
        }
        case "-v": {
          // Check for array element syntax: var[index]
          const arrayMatch = operand.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
          if (arrayMatch) {
            const arrayName = arrayMatch[1];
            let indexExpr = arrayMatch[2];
            // Expand variables in index
            indexExpr = indexExpr.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, varName) => {
              return ctx.state.env[varName] || "";
            });
            // Evaluate as arithmetic or number
            let index: number;
            if (/^-?\d+$/.test(indexExpr)) {
              index = Number.parseInt(indexExpr, 10);
            } else {
              // Try to evaluate as arithmetic expression
              try {
                const result = Function(`"use strict"; return (${indexExpr})`)();
                index = typeof result === "number" ? Math.floor(result) : 0;
              } catch {
                const varValue = ctx.state.env[indexExpr];
                index = varValue ? Number.parseInt(varValue, 10) : 0;
              }
            }
            // Handle negative indices - convert to actual index
            if (index < 0) {
              // Need to import getArrayElements, for now use simple lookup
              const prefix = `${arrayName}_`;
              const indices: number[] = [];
              for (const key of Object.keys(ctx.state.env)) {
                if (key.startsWith(prefix)) {
                  const idx = Number.parseInt(key.slice(prefix.length), 10);
                  if (!Number.isNaN(idx)) indices.push(idx);
                }
              }
              indices.sort((a, b) => a - b);
              const actualIdx = indices.length + index;
              if (actualIdx < 0 || actualIdx >= indices.length) return false;
              index = indices[actualIdx];
            }
            return `${arrayName}_${index}` in ctx.state.env;
          }
          return operand in ctx.state.env;
        }
        default:
          return false;
      }
    }

    case "CondNot":
      return !(await evaluateConditional(ctx, expr.operand));

    case "CondAnd": {
      const left = await evaluateConditional(ctx, expr.left);
      if (!left) return false;
      return await evaluateConditional(ctx, expr.right);
    }

    case "CondOr": {
      const left = await evaluateConditional(ctx, expr.left);
      if (left) return true;
      return await evaluateConditional(ctx, expr.right);
    }

    case "CondGroup":
      return await evaluateConditional(ctx, expr.expression);

    case "CondWord": {
      const value = await expandWord(ctx, expr.word);
      return value !== "";
    }

    default:
      return false;
  }
}

export async function evaluateTestArgs(
  ctx: InterpreterContext,
  args: string[],
): Promise<ExecResult> {
  if (args.length === 0) {
    return { stdout: "", stderr: "", exitCode: 1 };
  }

  if (args.length === 1) {
    return { stdout: "", stderr: "", exitCode: args[0] ? 0 : 1 };
  }

  if (args.length === 2) {
    const op = args[0];
    const operand = args[1];

    switch (op) {
      case "-z":
        return { stdout: "", stderr: "", exitCode: operand === "" ? 0 : 1 };
      case "-n":
        return { stdout: "", stderr: "", exitCode: operand !== "" ? 0 : 1 };
      case "-e":
      case "-a": {
        const exists = await ctx.fs.exists(resolvePath(ctx, operand));
        return { stdout: "", stderr: "", exitCode: exists ? 0 : 1 };
      }
      case "-f": {
        const path = resolvePath(ctx, operand);
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.stat(path);
          return { stdout: "", stderr: "", exitCode: stat.isFile ? 0 : 1 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      case "-d": {
        const path = resolvePath(ctx, operand);
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.stat(path);
          return {
            stdout: "",
            stderr: "",
            exitCode: stat.isDirectory ? 0 : 1,
          };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      case "-r":
      case "-w":
      case "-x": {
        const exists = await ctx.fs.exists(resolvePath(ctx, operand));
        return { stdout: "", stderr: "", exitCode: exists ? 0 : 1 };
      }
      case "-s": {
        const path = resolvePath(ctx, operand);
        if (await ctx.fs.exists(path)) {
          const content = await ctx.fs.readFile(path);
          return {
            stdout: "",
            stderr: "",
            exitCode: content.length > 0 ? 0 : 1,
          };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      case "!":
        return { stdout: "", stderr: "", exitCode: operand ? 1 : 0 };
      case "-v": {
        // Check for array element syntax: var[index]
        const arrayMatch = operand.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
        if (arrayMatch) {
          const arrayName = arrayMatch[1];
          let indexExpr = arrayMatch[2];
          // Expand variables in index
          indexExpr = indexExpr.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, vn) => {
            return ctx.state.env[vn] || "";
          });
          // Evaluate as arithmetic or number
          let index: number;
          if (/^-?\d+$/.test(indexExpr)) {
            index = Number.parseInt(indexExpr, 10);
          } else {
            try {
              const result = Function(`"use strict"; return (${indexExpr})`)();
              index = typeof result === "number" ? Math.floor(result) : 0;
            } catch {
              const varValue = ctx.state.env[indexExpr];
              index = varValue ? Number.parseInt(varValue, 10) : 0;
            }
          }
          // Handle negative indices
          if (index < 0) {
            const prefix = `${arrayName}_`;
            const indices: number[] = [];
            for (const key of Object.keys(ctx.state.env)) {
              if (key.startsWith(prefix)) {
                const idx = Number.parseInt(key.slice(prefix.length), 10);
                if (!Number.isNaN(idx)) indices.push(idx);
              }
            }
            indices.sort((a, b) => a - b);
            const actualIdx = indices.length + index;
            if (actualIdx < 0 || actualIdx >= indices.length) {
              return { stdout: "", stderr: "", exitCode: 1 };
            }
            index = indices[actualIdx];
          }
          return { stdout: "", stderr: "", exitCode: `${arrayName}_${index}` in ctx.state.env ? 0 : 1 };
        }
        return { stdout: "", stderr: "", exitCode: operand in ctx.state.env ? 0 : 1 };
      }
      default:
        return { stdout: "", stderr: "", exitCode: 1 };
    }
  }

  if (args.length === 3) {
    const left = args[0];
    const op = args[1];
    const right = args[2];

    // Only handle simple binary comparisons in the fast path
    // Let -a, -o, and parentheses fall through to compound handler
    // Note: [ / test uses literal string comparison, NOT pattern matching
    // Pattern matching is only for [[ ]]
    switch (op) {
      case "=":
      case "==":
        return {
          stdout: "",
          stderr: "",
          exitCode: left === right ? 0 : 1,
        };
      case "!=":
        return {
          stdout: "",
          stderr: "",
          exitCode: left !== right ? 0 : 1,
        };
      case "-eq":
      case "-ne":
      case "-lt":
      case "-le":
      case "-gt":
      case "-ge": {
        const leftNum = parseNumericDecimal(left);
        const rightNum = parseNumericDecimal(right);
        // Invalid operand returns exit code 2
        if (!leftNum.valid || !rightNum.valid) {
          return { stdout: "", stderr: "", exitCode: 2 };
        }
        let result: boolean;
        switch (op) {
          case "-eq": result = leftNum.value === rightNum.value; break;
          case "-ne": result = leftNum.value !== rightNum.value; break;
          case "-lt": result = leftNum.value < rightNum.value; break;
          case "-le": result = leftNum.value <= rightNum.value; break;
          case "-gt": result = leftNum.value > rightNum.value; break;
          case "-ge": result = leftNum.value >= rightNum.value; break;
          default: result = false;
        }
        return { stdout: "", stderr: "", exitCode: result ? 0 : 1 };
      }
      // Let -a, -o, and other cases fall through to compound handler
    }
  }

  // Handle compound expressions with -a (AND) and -o (OR)
  const result = await evaluateTestExpr(ctx, args, 0);

  // Check for unconsumed tokens (extra arguments = syntax error)
  if (result.pos < args.length) {
    return {
      stdout: "",
      stderr: `test: too many arguments\n`,
      exitCode: 2,
    };
  }

  return { stdout: "", stderr: "", exitCode: result.value ? 0 : 1 };
}

// Recursive expression evaluator for test command
async function evaluateTestExpr(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  return evaluateTestOr(ctx, args, pos);
}

async function evaluateTestOr(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  let { value, pos: newPos } = await evaluateTestAnd(ctx, args, pos);
  while (args[newPos] === "-o") {
    const right = await evaluateTestAnd(ctx, args, newPos + 1);
    value = value || right.value;
    newPos = right.pos;
  }
  return { value, pos: newPos };
}

async function evaluateTestAnd(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  let { value, pos: newPos } = await evaluateTestNot(ctx, args, pos);
  while (args[newPos] === "-a") {
    const right = await evaluateTestNot(ctx, args, newPos + 1);
    value = value && right.value;
    newPos = right.pos;
  }
  return { value, pos: newPos };
}

async function evaluateTestNot(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  if (args[pos] === "!") {
    const { value, pos: newPos } = await evaluateTestNot(ctx, args, pos + 1);
    return { value: !value, pos: newPos };
  }
  return evaluateTestPrimary(ctx, args, pos);
}

async function evaluateTestPrimary(
  ctx: InterpreterContext,
  args: string[],
  pos: number,
): Promise<{ value: boolean; pos: number }> {
  const token = args[pos];

  // Parentheses grouping
  if (token === "(") {
    const { value, pos: newPos } = await evaluateTestExpr(ctx, args, pos + 1);
    // Skip closing )
    return { value, pos: args[newPos] === ")" ? newPos + 1 : newPos };
  }

  // Unary file tests
  const fileOps = ["-e", "-a", "-f", "-d", "-r", "-w", "-x", "-s", "-L", "-h"];
  if (fileOps.includes(token)) {
    const operand = args[pos + 1] ?? "";
    const path = resolvePath(ctx, operand);

    let value = false;
    switch (token) {
      case "-e":
      case "-a":
        value = await ctx.fs.exists(path);
        break;
      case "-f":
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.stat(path);
          value = stat.isFile;
        }
        break;
      case "-d":
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.stat(path);
          value = stat.isDirectory;
        }
        break;
      case "-r":
      case "-w":
      case "-x":
        value = await ctx.fs.exists(path);
        break;
      case "-s":
        if (await ctx.fs.exists(path)) {
          const content = await ctx.fs.readFile(path);
          value = content.length > 0;
        }
        break;
      case "-L":
      case "-h":
        if (await ctx.fs.exists(path)) {
          const stat = await ctx.fs.lstat(path);
          value = stat.isSymbolicLink;
        }
        break;
    }
    return { value, pos: pos + 2 };
  }

  // Unary string tests
  if (token === "-z") {
    const operand = args[pos + 1] ?? "";
    return { value: operand === "", pos: pos + 2 };
  }
  if (token === "-n") {
    const operand = args[pos + 1] ?? "";
    return { value: operand !== "", pos: pos + 2 };
  }

  // Variable tests
  if (token === "-v") {
    const varName = args[pos + 1] ?? "";
    // Check for array element syntax: var[index]
    const arrayMatch = varName.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(.+)\]$/);
    if (arrayMatch) {
      const arrayName = arrayMatch[1];
      let indexExpr = arrayMatch[2];
      // Expand variables in index
      indexExpr = indexExpr.replace(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g, (_, vn) => {
        return ctx.state.env[vn] || "";
      });
      // Evaluate as arithmetic or number
      let index: number;
      if (/^-?\d+$/.test(indexExpr)) {
        index = Number.parseInt(indexExpr, 10);
      } else {
        try {
          const result = Function(`"use strict"; return (${indexExpr})`)();
          index = typeof result === "number" ? Math.floor(result) : 0;
        } catch {
          const varValue = ctx.state.env[indexExpr];
          index = varValue ? Number.parseInt(varValue, 10) : 0;
        }
      }
      // Handle negative indices
      if (index < 0) {
        const prefix = `${arrayName}_`;
        const indices: number[] = [];
        for (const key of Object.keys(ctx.state.env)) {
          if (key.startsWith(prefix)) {
            const idx = Number.parseInt(key.slice(prefix.length), 10);
            if (!Number.isNaN(idx)) indices.push(idx);
          }
        }
        indices.sort((a, b) => a - b);
        const actualIdx = indices.length + index;
        if (actualIdx < 0 || actualIdx >= indices.length) {
          return { value: false, pos: pos + 2 };
        }
        index = indices[actualIdx];
      }
      return { value: `${arrayName}_${index}` in ctx.state.env, pos: pos + 2 };
    }
    return { value: varName in ctx.state.env, pos: pos + 2 };
  }

  // Check for binary operators
  // Note: [ / test uses literal string comparison, NOT pattern matching
  const next = args[pos + 1];
  if (next === "=" || next === "==" || next === "!=") {
    const left = token;
    const right = args[pos + 2] ?? "";
    const isEqual = left === right;
    return { value: next === "!=" ? !isEqual : isEqual, pos: pos + 3 };
  }

  const numericOps = ["-eq", "-ne", "-lt", "-le", "-gt", "-ge"];
  if (numericOps.includes(next)) {
    const leftParsed = parseNumericDecimal(token);
    const rightParsed = parseNumericDecimal(args[pos + 2] ?? "0");
    // Invalid operands - return false (will cause exit code 2 at higher level)
    if (!leftParsed.valid || !rightParsed.valid) {
      // For now, return false which is at least consistent with "comparison failed"
      return { value: false, pos: pos + 3 };
    }
    const left = leftParsed.value;
    const right = rightParsed.value;
    let value = false;
    switch (next) {
      case "-eq":
        value = left === right;
        break;
      case "-ne":
        value = left !== right;
        break;
      case "-lt":
        value = left < right;
        break;
      case "-le":
        value = left <= right;
        break;
      case "-gt":
        value = left > right;
        break;
      case "-ge":
        value = left >= right;
        break;
    }
    return { value, pos: pos + 3 };
  }

  // Single argument: true if non-empty
  return { value: token !== undefined && token !== "", pos: pos + 1 };
}

export function matchPattern(value: string, pattern: string): boolean {
  let regex = "^";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    // Handle backslash escapes - next char is literal
    if (char === "\\") {
      if (i + 1 < pattern.length) {
        const next = pattern[i + 1];
        // Escape regex special chars
        if (/[\\^$.|+(){}[\]*?]/.test(next)) {
          regex += `\\${next}`;
        } else {
          regex += next;
        }
        i++; // Skip the escaped character
      } else {
        regex += "\\\\"; // Trailing backslash
      }
    } else if (char === "*") {
      regex += ".*";
    } else if (char === "?") {
      regex += ".";
    } else if (char === "[") {
      const closeIdx = pattern.indexOf("]", i + 1);
      if (closeIdx !== -1) {
        regex += pattern.slice(i, closeIdx + 1);
        i = closeIdx;
      } else {
        regex += "\\[";
      }
    } else if (/[\\^$.|+(){}]/.test(char)) {
      regex += `\\${char}`;
    } else {
      regex += char;
    }
  }
  regex += "$";

  return new RegExp(regex).test(value);
}

function resolvePath(ctx: InterpreterContext, path: string): string {
  return ctx.fs.resolvePath(ctx.state.cwd, path);
}

/**
 * Evaluate an arithmetic expression string for [[ ]] comparisons.
 * In bash, [[ -eq ]] etc. evaluate operands as arithmetic expressions.
 */
function evalArithExpr(ctx: InterpreterContext, expr: string): number {
  expr = expr.trim();
  if (expr === "") return 0;

  // First try simple numeric parsing (handles octal, hex, base-N)
  // If the expression is just a number, parseNumeric handles it correctly
  if (/^[+-]?(\d+#[a-zA-Z0-9@_]+|0[xX][0-9a-fA-F]+|0[0-7]+|\d+)$/.test(expr)) {
    return parseNumeric(expr);
  }

  // Otherwise, parse and evaluate as arithmetic expression
  try {
    const parser = new Parser();
    const arithAst = parseArithmeticExpression(parser, expr);
    return evaluateArithmeticSync(ctx, arithAst.expression);
  } catch {
    // If parsing fails, try simple numeric
    return parseNumeric(expr);
  }
}

/**
 * Parse a number in base N (2-64).
 * Digit values: 0-9=0-9, a-z=10-35, A-Z=36-61, @=62, _=63
 */
function parseBaseN(digits: string, base: number): number {
  let result = 0;
  for (const char of digits) {
    let digitValue: number;
    if (char >= "0" && char <= "9") {
      digitValue = char.charCodeAt(0) - 48; // '0' = 48
    } else if (char >= "a" && char <= "z") {
      digitValue = char.charCodeAt(0) - 97 + 10; // 'a' = 97
    } else if (char >= "A" && char <= "Z") {
      digitValue = char.charCodeAt(0) - 65 + 36; // 'A' = 65
    } else if (char === "@") {
      digitValue = 62;
    } else if (char === "_") {
      digitValue = 63;
    } else {
      return Number.NaN;
    }
    if (digitValue >= base) {
      return Number.NaN;
    }
    result = result * base + digitValue;
  }
  return result;
}

/**
 * Parse a bash numeric value, supporting:
 * - Decimal: 42, -42
 * - Octal: 0777, -0123
 * - Hex: 0xff, 0xFF, -0xff
 * - Base-N: 64#a, 2#1010
 * - Strings are coerced to 0
 */
function parseNumeric(value: string): number {
  value = value.trim();
  if (value === "") return 0;

  // Handle negative numbers
  let negative = false;
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }

  let result: number;

  // Base-N syntax: base#value
  const baseMatch = value.match(/^(\d+)#([a-zA-Z0-9@_]+)$/);
  if (baseMatch) {
    const base = Number.parseInt(baseMatch[1], 10);
    if (base >= 2 && base <= 64) {
      result = parseBaseN(baseMatch[2], base);
    } else {
      result = 0;
    }
  }
  // Hex: 0x or 0X
  else if (/^0[xX][0-9a-fA-F]+$/.test(value)) {
    result = Number.parseInt(value, 16);
  }
  // Octal: starts with 0 followed by digits (0-7)
  else if (/^0[0-7]+$/.test(value)) {
    result = Number.parseInt(value, 8);
  }
  // Decimal
  else {
    result = Number.parseInt(value, 10);
  }

  // NaN becomes 0 (bash coerces invalid strings to 0)
  if (Number.isNaN(result)) {
    result = 0;
  }

  return negative ? -result : result;
}

/**
 * Parse a number as plain decimal (for test/[ command).
 * Unlike parseNumeric, this does NOT interpret octal/hex/base-N.
 * Leading zeros are treated as decimal.
 * Returns { value, valid } - valid is false if input is invalid.
 */
function parseNumericDecimal(value: string): { value: number; valid: boolean } {
  value = value.trim();
  if (value === "") return { value: 0, valid: true };

  // Handle negative numbers
  let negative = false;
  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  } else if (value.startsWith("+")) {
    value = value.slice(1);
  }

  // Check if it's a valid decimal number (only digits)
  if (!/^\d+$/.test(value)) {
    // Invalid format (hex, base-N, letters, etc.)
    return { value: 0, valid: false };
  }

  // Always parse as decimal (base 10)
  const result = Number.parseInt(value, 10);

  // NaN is invalid
  if (Number.isNaN(result)) {
    return { value: 0, valid: false };
  }

  return { value: negative ? -result : result, valid: true };
}
