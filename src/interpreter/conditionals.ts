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
import {
  evaluateBinaryFileTest,
  evaluateFileTest,
  isBinaryFileTestOperator,
  isFileTestOperator,
} from "./helpers/file-tests.js";
import { compareNumeric, isNumericOp } from "./helpers/numeric-compare.js";
import { result as execResult, failure, testResult } from "./helpers/result.js";
import { compareStrings, isStringCompareOp } from "./helpers/string-compare.js";
import { evaluateStringTest, isStringTestOp } from "./helpers/string-tests.js";
import { evaluateVariableTest } from "./helpers/variable-tests.js";
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

      // String comparisons (with pattern matching support in [[ ]])
      if (isStringCompareOp(expr.operator)) {
        return compareStrings(expr.operator, left, right, !isRhsQuoted);
      }

      // Numeric comparisons
      if (isNumericOp(expr.operator)) {
        return compareNumeric(
          expr.operator,
          evalArithExpr(ctx, left),
          evalArithExpr(ctx, right),
        );
      }

      // Binary file tests
      if (isBinaryFileTestOperator(expr.operator)) {
        return evaluateBinaryFileTest(ctx, expr.operator, left, right);
      }

      switch (expr.operator) {
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
            // Invalid regex pattern is a syntax error (exit code 2)
            throw new Error("syntax error in regular expression");
          }
        }
        case "<":
          return left < right;
        case ">":
          return left > right;
        default:
          return false;
      }
    }

    case "CondUnary": {
      const operand = await expandWord(ctx, expr.operand);

      // Handle file test operators using shared helper
      if (isFileTestOperator(expr.operator)) {
        return evaluateFileTest(ctx, expr.operator, operand);
      }

      if (isStringTestOp(expr.operator)) {
        return evaluateStringTest(expr.operator, operand);
      }
      if (expr.operator === "-v") {
        return evaluateVariableTest(ctx, operand);
      }
      if (expr.operator === "-o") {
        return evaluateShellOption(ctx, operand);
      }
      return false;
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
    return execResult("", "", 1);
  }

  if (args.length === 1) {
    return testResult(Boolean(args[0]));
  }

  if (args.length === 2) {
    const op = args[0];
    const operand = args[1];

    // "(" without matching ")" is a syntax error
    if (op === "(") {
      return failure("test: '(' without matching ')'\n", 2);
    }

    // Handle file test operators using shared helper
    if (isFileTestOperator(op)) {
      return testResult(await evaluateFileTest(ctx, op, operand));
    }

    if (isStringTestOp(op)) {
      return testResult(evaluateStringTest(op, operand));
    }
    if (op === "!") {
      return testResult(!operand);
    }
    if (op === "-v") {
      return testResult(evaluateVariableTest(ctx, operand));
    }
    if (op === "-o") {
      return testResult(evaluateShellOption(ctx, operand));
    }
    // If the first arg is a known binary operator but used in 2-arg context, it's an error
    if (
      op === "=" ||
      op === "==" ||
      op === "!=" ||
      op === "<" ||
      op === ">" ||
      op === "-eq" ||
      op === "-ne" ||
      op === "-lt" ||
      op === "-le" ||
      op === "-gt" ||
      op === "-ge" ||
      op === "-nt" ||
      op === "-ot" ||
      op === "-ef"
    ) {
      return failure(`test: ${op}: unary operator expected\n`, 2);
    }
    return execResult("", "", 1);
  }

  if (args.length === 3) {
    const left = args[0];
    const op = args[1];
    const right = args[2];

    // POSIX 3-argument rules:
    // If $2 is a binary primary, evaluate as: $1 op $3
    // Binary primaries include: =, !=, -eq, -ne, -lt, -le, -gt, -ge, -a, -o, -nt, -ot, -ef
    // Note: -a and -o as binary primaries test if both/either operand is non-empty

    // String comparisons (no pattern matching in test/[)
    if (isStringCompareOp(op)) {
      return testResult(compareStrings(op, left, right));
    }

    if (isNumericOp(op)) {
      const leftNum = parseNumericDecimal(left);
      const rightNum = parseNumericDecimal(right);
      // Invalid operand returns exit code 2
      if (!leftNum.valid || !rightNum.valid) {
        return execResult("", "", 2);
      }
      return testResult(compareNumeric(op, leftNum.value, rightNum.value));
    }

    // Binary file tests
    if (isBinaryFileTestOperator(op)) {
      return testResult(await evaluateBinaryFileTest(ctx, op, left, right));
    }

    switch (op) {
      case "-a":
        // In 3-arg context, -a is binary AND: both operands must be non-empty
        return testResult(left !== "" && right !== "");
      case "-o":
        // In 3-arg context, -o is binary OR: at least one operand must be non-empty
        return testResult(left !== "" || right !== "");
      case ">":
        // String comparison: left > right (lexicographically)
        return testResult(left > right);
      case "<":
        // String comparison: left < right (lexicographically)
        return testResult(left < right);
    }

    // If $1 is '!', negate the 2-argument test
    if (left === "!") {
      const negResult = await evaluateTestArgs(ctx, [op, right]);
      return execResult(
        "",
        negResult.stderr,
        negResult.exitCode === 0
          ? 1
          : negResult.exitCode === 1
            ? 0
            : negResult.exitCode,
      );
    }

    // If $1 is '(' and $3 is ')', evaluate $2 as single-arg test
    if (left === "(" && right === ")") {
      return testResult(op !== "");
    }
  }

  // POSIX 4-argument rules
  if (args.length === 4) {
    // If $1 is '!', negate the 3-argument expression
    if (args[0] === "!") {
      const negResult = await evaluateTestArgs(ctx, args.slice(1));
      return execResult(
        "",
        negResult.stderr,
        negResult.exitCode === 0
          ? 1
          : negResult.exitCode === 1
            ? 0
            : negResult.exitCode,
      );
    }

    // If $1 is '(' and $4 is ')', evaluate $2 and $3 as 2-arg expression
    if (args[0] === "(" && args[3] === ")") {
      return evaluateTestArgs(ctx, [args[1], args[2]]);
    }
  }

  // Handle compound expressions with -a (AND) and -o (OR)
  const exprResult = await evaluateTestExpr(ctx, args, 0);

  // Check for unconsumed tokens (extra arguments = syntax error)
  if (exprResult.pos < args.length) {
    return failure("test: too many arguments\n", 2);
  }

  return testResult(exprResult.value);
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

  // Unary file tests - use shared helper
  if (isFileTestOperator(token)) {
    const operand = args[pos + 1] ?? "";
    const value = await evaluateFileTest(ctx, token, operand);
    return { value, pos: pos + 2 };
  }

  // Unary string tests - use shared helper
  if (isStringTestOp(token)) {
    const operand = args[pos + 1] ?? "";
    return { value: evaluateStringTest(token, operand), pos: pos + 2 };
  }

  // Variable tests
  if (token === "-v") {
    const varName = args[pos + 1] ?? "";
    const value = evaluateVariableTest(ctx, varName);
    return { value, pos: pos + 2 };
  }

  // Shell option tests
  if (token === "-o") {
    const optName = args[pos + 1] ?? "";
    const value = evaluateShellOption(ctx, optName);
    return { value, pos: pos + 2 };
  }

  // Check for binary operators
  // Note: [ / test uses literal string comparison, NOT pattern matching
  const next = args[pos + 1];
  if (isStringCompareOp(next)) {
    const left = token;
    const right = args[pos + 2] ?? "";
    return { value: compareStrings(next, left, right), pos: pos + 3 };
  }

  if (isNumericOp(next)) {
    const leftParsed = parseNumericDecimal(token);
    const rightParsed = parseNumericDecimal(args[pos + 2] ?? "0");
    // Invalid operands - return false (will cause exit code 2 at higher level)
    if (!leftParsed.valid || !rightParsed.valid) {
      // For now, return false which is at least consistent with "comparison failed"
      return { value: false, pos: pos + 3 };
    }
    const value = compareNumeric(next, leftParsed.value, rightParsed.value);
    return { value, pos: pos + 3 };
  }

  // Binary file tests
  if (isBinaryFileTestOperator(next)) {
    const left = token;
    const right = args[pos + 2] ?? "";
    const value = await evaluateBinaryFileTest(ctx, next, left, right);
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

/**
 * Evaluate -o option test (check if shell option is enabled).
 * Maps option names to interpreter state flags.
 */
function evaluateShellOption(ctx: InterpreterContext, option: string): boolean {
  // Map of option names to their state in ctx.state.options
  // Only includes options that are actually implemented
  const optionMap: Record<string, () => boolean> = {
    // Implemented options (set -o)
    errexit: () => ctx.state.options.errexit === true,
    nounset: () => ctx.state.options.nounset === true,
    pipefail: () => ctx.state.options.pipefail === true,
    xtrace: () => ctx.state.options.xtrace === true,
    // Single-letter aliases for implemented options
    e: () => ctx.state.options.errexit === true,
    u: () => ctx.state.options.nounset === true,
    x: () => ctx.state.options.xtrace === true,
  };

  const getter = optionMap[option];
  if (getter) {
    return getter();
  }
  // Unknown or unimplemented option - return false
  return false;
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
