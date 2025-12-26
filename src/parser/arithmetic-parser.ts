/**
 * Arithmetic Expression Parser
 *
 * Parses bash arithmetic expressions like:
 * - $((1 + 2))
 * - $((x++))
 * - $((a ? b : c))
 * - $((2#1010))
 *
 * All functions take a Parser instance as the first argument for shared state access.
 */

import type {
  ArithAssignmentOperator,
  ArithExpr,
  ArithmeticExpressionNode,
} from "../ast/types.js";
import { ArithmeticError } from "../interpreter/errors.js";
import type { Parser } from "./parser.js";

/**
 * Parse an arithmetic expression string into an AST node
 */
export function parseArithmeticExpression(
  _p: Parser,
  input: string,
): ArithmeticExpressionNode {
  const expression = parseArithExpr(_p, input, 0).expr;
  return { type: "ArithmeticExpression", expression };
}

export function parseArithExpr(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  // Comma operator has the lowest precedence
  return parseArithComma(p, input, pos);
}

function parseArithComma(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithTernary(p, input, pos);

  currentPos = skipArithWhitespace(input, currentPos);
  while (input[currentPos] === ",") {
    currentPos++; // Skip comma
    const { expr: right, pos: p2 } = parseArithTernary(p, input, currentPos);
    left = { type: "ArithBinary", operator: ",", left, right };
    currentPos = skipArithWhitespace(input, p2);
  }

  return { expr: left, pos: currentPos };
}

function parseArithTernary(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: condition, pos: currentPos } = parseArithLogicalOr(p, input, pos);

  currentPos = skipArithWhitespace(input, currentPos);
  if (input[currentPos] === "?") {
    currentPos++;
    const { expr: consequent, pos: p2 } = parseArithExpr(p, input, currentPos);
    currentPos = skipArithWhitespace(input, p2);
    if (input[currentPos] === ":") {
      currentPos++;
      const { expr: alternate, pos: p3 } = parseArithExpr(p, input, currentPos);
      return {
        expr: { type: "ArithTernary", condition, consequent, alternate },
        pos: p3,
      };
    }
  }

  return { expr: condition, pos: currentPos };
}

function parseArithLogicalOr(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithLogicalAnd(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (input.slice(currentPos, currentPos + 2) === "||") {
      currentPos += 2;
      const { expr: right, pos: p2 } = parseArithLogicalAnd(
        p,
        input,
        currentPos,
      );
      left = { type: "ArithBinary", operator: "||", left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithLogicalAnd(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithBitwiseOr(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (input.slice(currentPos, currentPos + 2) === "&&") {
      currentPos += 2;
      const { expr: right, pos: p2 } = parseArithBitwiseOr(
        p,
        input,
        currentPos,
      );
      left = { type: "ArithBinary", operator: "&&", left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithBitwiseOr(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithBitwiseXor(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (input[currentPos] === "|" && input[currentPos + 1] !== "|") {
      currentPos++;
      const { expr: right, pos: p2 } = parseArithBitwiseXor(
        p,
        input,
        currentPos,
      );
      left = { type: "ArithBinary", operator: "|", left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithBitwiseXor(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithBitwiseAnd(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (input[currentPos] === "^") {
      currentPos++;
      const { expr: right, pos: p2 } = parseArithBitwiseAnd(
        p,
        input,
        currentPos,
      );
      left = { type: "ArithBinary", operator: "^", left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithBitwiseAnd(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithEquality(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (input[currentPos] === "&" && input[currentPos + 1] !== "&") {
      currentPos++;
      const { expr: right, pos: p2 } = parseArithEquality(p, input, currentPos);
      left = { type: "ArithBinary", operator: "&", left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithEquality(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithRelational(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (
      input.slice(currentPos, currentPos + 2) === "==" ||
      input.slice(currentPos, currentPos + 2) === "!="
    ) {
      const op = input.slice(currentPos, currentPos + 2) as "==" | "!=";
      currentPos += 2;
      const { expr: right, pos: p2 } = parseArithRelational(
        p,
        input,
        currentPos,
      );
      left = { type: "ArithBinary", operator: op, left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithRelational(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithShift(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (
      input.slice(currentPos, currentPos + 2) === "<=" ||
      input.slice(currentPos, currentPos + 2) === ">="
    ) {
      const op = input.slice(currentPos, currentPos + 2) as "<=" | ">=";
      currentPos += 2;
      const { expr: right, pos: p2 } = parseArithShift(p, input, currentPos);
      left = { type: "ArithBinary", operator: op, left, right };
      currentPos = p2;
    } else if (input[currentPos] === "<" || input[currentPos] === ">") {
      const op = input[currentPos] as "<" | ">";
      currentPos++;
      const { expr: right, pos: p2 } = parseArithShift(p, input, currentPos);
      left = { type: "ArithBinary", operator: op, left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithShift(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithAdditive(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (
      input.slice(currentPos, currentPos + 2) === "<<" ||
      input.slice(currentPos, currentPos + 2) === ">>"
    ) {
      const op = input.slice(currentPos, currentPos + 2) as "<<" | ">>";
      currentPos += 2;
      const { expr: right, pos: p2 } = parseArithAdditive(p, input, currentPos);
      left = { type: "ArithBinary", operator: op, left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithAdditive(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithMultiplicative(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (
      (input[currentPos] === "+" || input[currentPos] === "-") &&
      input[currentPos + 1] !== input[currentPos]
    ) {
      const op = input[currentPos] as "+" | "-";
      currentPos++;
      const { expr: right, pos: p2 } = parseArithMultiplicative(
        p,
        input,
        currentPos,
      );
      left = { type: "ArithBinary", operator: op, left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithMultiplicative(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr: left, pos: currentPos } = parseArithPower(p, input, pos);

  while (true) {
    currentPos = skipArithWhitespace(input, currentPos);
    if (input[currentPos] === "*" && input[currentPos + 1] !== "*") {
      currentPos++;
      const { expr: right, pos: p2 } = parseArithPower(p, input, currentPos);
      left = { type: "ArithBinary", operator: "*", left, right };
      currentPos = p2;
    } else if (input[currentPos] === "/" || input[currentPos] === "%") {
      const op = input[currentPos] as "/" | "%";
      currentPos++;
      const { expr: right, pos: p2 } = parseArithPower(p, input, currentPos);
      left = { type: "ArithBinary", operator: op, left, right };
      currentPos = p2;
    } else {
      break;
    }
  }

  return { expr: left, pos: currentPos };
}

function parseArithPower(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  const { expr: base, pos: currentPos } = parseArithUnary(p, input, pos);
  let p2 = skipArithWhitespace(input, currentPos);

  if (input.slice(p2, p2 + 2) === "**") {
    p2 += 2;
    const { expr: exponent, pos: p3 } = parseArithPower(p, input, p2); // Right associative
    return {
      expr: {
        type: "ArithBinary",
        operator: "**",
        left: base,
        right: exponent,
      },
      pos: p3,
    };
  }

  return { expr: base, pos: currentPos };
}

function parseArithUnary(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let currentPos = skipArithWhitespace(input, pos);

  // Prefix operators: ++ -- + - ! ~
  if (
    input.slice(currentPos, currentPos + 2) === "++" ||
    input.slice(currentPos, currentPos + 2) === "--"
  ) {
    const op = input.slice(currentPos, currentPos + 2) as "++" | "--";
    currentPos += 2;
    const { expr: operand, pos: p2 } = parseArithUnary(p, input, currentPos);
    return {
      expr: { type: "ArithUnary", operator: op, operand, prefix: true },
      pos: p2,
    };
  }

  if (
    input[currentPos] === "+" ||
    input[currentPos] === "-" ||
    input[currentPos] === "!" ||
    input[currentPos] === "~"
  ) {
    const op = input[currentPos] as "+" | "-" | "!" | "~";
    currentPos++;
    const { expr: operand, pos: p2 } = parseArithUnary(p, input, currentPos);
    return {
      expr: { type: "ArithUnary", operator: op, operand, prefix: true },
      pos: p2,
    };
  }

  return parseArithPostfix(p, input, currentPos);
}

/**
 * Check if a character can start another concatenated primary (expansion)
 * This is used to detect adjacent expansions like $(cmd)${var}
 */
function canStartConcatPrimary(input: string, pos: number): boolean {
  const c = input[pos];
  // $ starts command sub, parameter expansion, nested arith, or variable
  if (c === "$") return true;
  // ` starts backtick command substitution
  if (c === "`") return true;
  return false;
}

function parseArithPostfix(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let { expr, pos: currentPos } = parseArithPrimary(p, input, pos);

  // Check for adjacent primaries without whitespace (concatenation)
  // e.g., $(echo 1)${undefined:-3} → "13"
  const parts: ArithExpr[] = [expr];
  while (canStartConcatPrimary(input, currentPos)) {
    const { expr: nextExpr, pos: nextPos } = parseArithPrimary(
      p,
      input,
      currentPos,
    );
    parts.push(nextExpr);
    currentPos = nextPos;
  }

  if (parts.length > 1) {
    expr = { type: "ArithConcat", parts };
  }

  currentPos = skipArithWhitespace(input, currentPos);

  // Postfix operators: ++ --
  if (
    input.slice(currentPos, currentPos + 2) === "++" ||
    input.slice(currentPos, currentPos + 2) === "--"
  ) {
    const op = input.slice(currentPos, currentPos + 2) as "++" | "--";
    currentPos += 2;
    return {
      expr: {
        type: "ArithUnary",
        operator: op,
        operand: expr,
        prefix: false,
      },
      pos: currentPos,
    };
  }

  return { expr, pos: currentPos };
}

function parseArithPrimary(
  p: Parser,
  input: string,
  pos: number,
): { expr: ArithExpr; pos: number } {
  let currentPos = skipArithWhitespace(input, pos);

  // Nested arithmetic: $((expr))
  if (input.slice(currentPos, currentPos + 3) === "$((") {
    currentPos += 3;
    // Find matching ))
    let depth = 1;
    const exprStart = currentPos;
    while (currentPos < input.length - 1 && depth > 0) {
      if (input[currentPos] === "(" && input[currentPos + 1] === "(") {
        depth++;
        currentPos += 2;
      } else if (input[currentPos] === ")" && input[currentPos + 1] === ")") {
        depth--;
        if (depth > 0) currentPos += 2;
      } else {
        currentPos++;
      }
    }
    const nestedExpr = input.slice(exprStart, currentPos);
    const { expr } = parseArithExpr(p, nestedExpr, 0);
    currentPos += 2; // Skip ))
    return { expr: { type: "ArithNested", expression: expr }, pos: currentPos };
  }

  // Command substitution: $(cmd)
  if (
    input.slice(currentPos, currentPos + 2) === "$(" &&
    input[currentPos + 2] !== "("
  ) {
    currentPos += 2;
    // Find matching )
    let depth = 1;
    const cmdStart = currentPos;
    while (currentPos < input.length && depth > 0) {
      if (input[currentPos] === "(") depth++;
      else if (input[currentPos] === ")") depth--;
      if (depth > 0) currentPos++;
    }
    const cmd = input.slice(cmdStart, currentPos);
    currentPos++; // Skip )
    return {
      expr: { type: "ArithCommandSubst", command: cmd },
      pos: currentPos,
    };
  }

  // Backtick command substitution: `cmd`
  if (input[currentPos] === "`") {
    currentPos++;
    const cmdStart = currentPos;
    while (currentPos < input.length && input[currentPos] !== "`") {
      currentPos++;
    }
    const cmd = input.slice(cmdStart, currentPos);
    if (input[currentPos] === "`") currentPos++;
    return {
      expr: { type: "ArithCommandSubst", command: cmd },
      pos: currentPos,
    };
  }

  // Grouped expression
  if (input[currentPos] === "(") {
    currentPos++;
    const { expr, pos: p2 } = parseArithExpr(p, input, currentPos);
    currentPos = skipArithWhitespace(input, p2);
    if (input[currentPos] === ")") currentPos++;
    return { expr: { type: "ArithGroup", expression: expr }, pos: currentPos };
  }

  // Number
  if (/[0-9]/.test(input[currentPos])) {
    let numStr = "";
    let seenHash = false;
    // Handle different bases: 0x, 0, base#num
    while (currentPos < input.length) {
      const ch = input[currentPos];
      // After #, allow alphanumeric plus @ and _ for base#num format (e.g., 64#_)
      if (seenHash) {
        if (/[0-9a-zA-Z@_]/.test(ch)) {
          numStr += ch;
          currentPos++;
        } else {
          break;
        }
      } else if (ch === "#") {
        seenHash = true;
        numStr += ch;
        currentPos++;
      } else if (/[0-9a-fA-FxX]/.test(ch)) {
        numStr += ch;
        currentPos++;
      } else {
        break;
      }
    }
    // Check for floating point (not supported in bash arithmetic)
    if (input[currentPos] === "." && /[0-9]/.test(input[currentPos + 1])) {
      throw new ArithmeticError(
        `${numStr}.${input[currentPos + 1]}...: syntax error: invalid arithmetic operator`,
      );
    }
    // Check for array subscript on number: 1[2] is invalid - numbers can't be indexed
    // Instead of throwing at parse time, return a special node that throws at evaluation
    if (input[currentPos] === "[") {
      // Find the error token (everything from [ onwards)
      const errorToken = input.slice(currentPos).trim();
      return {
        expr: {
          type: "ArithNumberSubscript" as const,
          number: numStr,
          errorToken,
        },
        pos: input.length, // Consume the rest
      };
    }
    const value = parseArithNumber(numStr);
    return { expr: { type: "ArithNumber", value }, pos: currentPos };
  }

  // Variable (optionally with $ prefix)
  // Handle ${...} braced parameter expansion
  if (input[currentPos] === "$" && input[currentPos + 1] === "{") {
    const braceStart = currentPos + 2;
    let braceDepth = 1;
    let i = braceStart;
    while (i < input.length && braceDepth > 0) {
      if (input[i] === "{") braceDepth++;
      else if (input[i] === "}") braceDepth--;
      if (braceDepth > 0) i++;
    }
    const content = input.slice(braceStart, i);
    const afterBrace = i + 1; // Position past the closing }

    // Check for dynamic base constant: ${base}#value or ${base}xHEX or ${base}octal
    // This handles cases like: ${base}#a, ${zero}11, ${zero}xAB
    if (input[afterBrace] === "#") {
      // Dynamic base#value: ${base}#digits
      let valueEnd = afterBrace + 1;
      while (valueEnd < input.length && /[0-9a-zA-Z@_]/.test(input[valueEnd])) {
        valueEnd++;
      }
      const valueStr = input.slice(afterBrace + 1, valueEnd);
      return {
        expr: { type: "ArithDynamicBase", baseExpr: content, value: valueStr },
        pos: valueEnd,
      };
    }
    if (
      /[0-9]/.test(input[afterBrace]) ||
      input[afterBrace] === "x" ||
      input[afterBrace] === "X"
    ) {
      // Dynamic octal (${zero}11) or hex (${zero}xAB)
      let numEnd = afterBrace;
      if (input[afterBrace] === "x" || input[afterBrace] === "X") {
        numEnd++; // Skip x/X
        while (numEnd < input.length && /[0-9a-fA-F]/.test(input[numEnd])) {
          numEnd++;
        }
      } else {
        while (numEnd < input.length && /[0-9]/.test(input[numEnd])) {
          numEnd++;
        }
      }
      const suffix = input.slice(afterBrace, numEnd);
      return {
        expr: { type: "ArithDynamicNumber", prefix: content, suffix },
        pos: numEnd,
      };
    }

    currentPos = afterBrace;
    return { expr: { type: "ArithBracedExpansion", content }, pos: currentPos };
  }
  // Handle $1, $2, etc. (positional parameters)
  if (
    input[currentPos] === "$" &&
    currentPos + 1 < input.length &&
    /[0-9]/.test(input[currentPos + 1])
  ) {
    currentPos++; // Skip the $
    let name = "";
    while (currentPos < input.length && /[0-9]/.test(input[currentPos])) {
      name += input[currentPos];
      currentPos++;
    }
    return { expr: { type: "ArithVariable", name }, pos: currentPos };
  }
  // Handle $name (regular variables with $ prefix)
  if (
    input[currentPos] === "$" &&
    currentPos + 1 < input.length &&
    /[a-zA-Z_]/.test(input[currentPos + 1])
  ) {
    currentPos++; // Skip the $ prefix
  }
  if (/[a-zA-Z_]/.test(input[currentPos])) {
    let name = "";
    while (
      currentPos < input.length &&
      /[a-zA-Z0-9_]/.test(input[currentPos])
    ) {
      name += input[currentPos];
      currentPos++;
    }

    // Check for array indexing: array[index]
    if (input[currentPos] === "[") {
      currentPos++; // Skip [

      // Check for quoted string key: array['key'] or array["key"]
      let stringKey: string | undefined;
      if (input[currentPos] === "'" || input[currentPos] === '"') {
        const quote = input[currentPos];
        currentPos++;
        stringKey = "";
        while (currentPos < input.length && input[currentPos] !== quote) {
          stringKey += input[currentPos];
          currentPos++;
        }
        if (input[currentPos] === quote) currentPos++;
        // Skip to ]
        currentPos = skipArithWhitespace(input, currentPos);
        if (input[currentPos] === "]") currentPos++;
      }

      let indexExpr: ArithExpr | undefined;
      if (stringKey === undefined) {
        const { expr, pos: p2 } = parseArithExpr(p, input, currentPos);
        indexExpr = expr;
        currentPos = p2;
        if (input[currentPos] === "]") currentPos++; // Skip ]
      }

      currentPos = skipArithWhitespace(input, currentPos);
      // Detect double subscript: a[1][1] is not valid - mark as error but don't throw during parsing
      if (input[currentPos] === "[" && indexExpr) {
        // Return a special error node that will fail during evaluation
        return {
          expr: { type: "ArithDoubleSubscript", array: name, index: indexExpr },
          pos: currentPos,
        };
      }

      // Check for assignment operators after array subscript
      const assignOps = [
        "=",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "<<=",
        ">>=",
        "&=",
        "|=",
        "^=",
      ];
      for (const op of assignOps) {
        if (
          input.slice(currentPos, currentPos + op.length) === op &&
          input.slice(currentPos, currentPos + op.length + 1) !== "=="
        ) {
          currentPos += op.length;
          const { expr: value, pos: p2 } = parseArithTernary(
            p,
            input,
            currentPos,
          );
          return {
            expr: {
              type: "ArithAssignment",
              operator: op as ArithAssignmentOperator,
              variable: name,
              subscript: indexExpr,
              stringKey,
              value,
            },
            pos: p2,
          };
        }
      }

      return {
        expr: {
          type: "ArithArrayElement",
          array: name,
          index: indexExpr,
          stringKey,
        },
        pos: currentPos,
      };
    }

    currentPos = skipArithWhitespace(input, currentPos);

    // Check for assignment operators
    // Assignment has higher precedence than comma, so parse RHS with parseArithTernary
    // This makes `a = b, c` parse as `(a = b), c` not `a = (b, c)`
    const assignOps = [
      "=",
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "<<=",
      ">>=",
      "&=",
      "|=",
      "^=",
    ];
    for (const op of assignOps) {
      if (
        input.slice(currentPos, currentPos + op.length) === op &&
        input.slice(currentPos, currentPos + op.length + 1) !== "=="
      ) {
        currentPos += op.length;
        // Use parseArithTernary instead of parseArithExpr to give assignment higher precedence than comma
        const { expr: value, pos: p2 } = parseArithTernary(
          p,
          input,
          currentPos,
        );
        return {
          expr: {
            type: "ArithAssignment",
            operator: op as ArithAssignmentOperator,
            variable: name,
            value,
          },
          pos: p2,
        };
      }
    }

    return { expr: { type: "ArithVariable", name }, pos: currentPos };
  }

  // Default: 0
  return { expr: { type: "ArithNumber", value: 0 }, pos: currentPos };
}

/**
 * Parse a number string with various bases (decimal, hex, octal, base#num)
 */
export function parseArithNumber(str: string): number {
  // Handle base#num format
  // Bash supports bases 2-64 with digits: 0-9, a-z (10-35), A-Z (36-61), @ (62), _ (63)
  if (str.includes("#")) {
    const [baseStr, numStr] = str.split("#");
    const base = Number.parseInt(baseStr, 10);
    if (base < 2 || base > 64) {
      return Number.NaN;
    }
    // For bases <= 36, we can use parseInt
    if (base <= 36) {
      return Number.parseInt(numStr, base);
    }
    // For bases 37-64, we need to manually parse
    let result = 0;
    for (const char of numStr) {
      let digit: number;
      if (char >= "0" && char <= "9") {
        digit = char.charCodeAt(0) - 48; // '0' = 48
      } else if (char >= "a" && char <= "z") {
        digit = char.charCodeAt(0) - 97 + 10; // 'a' = 97, value = 10
      } else if (char >= "A" && char <= "Z") {
        digit = char.charCodeAt(0) - 65 + 36; // 'A' = 65, value = 36
      } else if (char === "@") {
        digit = 62;
      } else if (char === "_") {
        digit = 63;
      } else {
        return Number.NaN;
      }
      if (digit >= base) {
        return Number.NaN;
      }
      result = result * base + digit;
    }
    return result;
  }

  // Handle hex
  if (str.startsWith("0x") || str.startsWith("0X")) {
    return Number.parseInt(str.slice(2), 16);
  }

  // Handle octal
  if (str.startsWith("0") && str.length > 1 && /^[0-9]+$/.test(str)) {
    // If it looks like octal (0-prefixed digits) but has 8 or 9, it's an error
    if (/[89]/.test(str)) {
      return Number.NaN;
    }
    return Number.parseInt(str, 8);
  }

  return Number.parseInt(str, 10);
}

function skipArithWhitespace(input: string, pos: number): number {
  while (pos < input.length) {
    // Skip line continuations (backslash followed by newline)
    if (input[pos] === "\\" && input[pos + 1] === "\n") {
      pos += 2;
      continue;
    }
    // Skip regular whitespace
    if (/\s/.test(input[pos])) {
      pos++;
      continue;
    }
    break;
  }
  return pos;
}
