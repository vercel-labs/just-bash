/**
 * Arithmetic Evaluation
 *
 * Evaluates bash arithmetic expressions including:
 * - Basic operators (+, -, *, /, %)
 * - Comparison operators (<, <=, >, >=, ==, !=)
 * - Bitwise operators (&, |, ^, ~, <<, >>)
 * - Logical operators (&&, ||, !)
 * - Assignment operators (=, +=, -=, etc.)
 * - Ternary operator (? :)
 * - Pre/post increment/decrement (++, --)
 * - Nested arithmetic: $((expr))
 * - Command substitution: $(cmd) or `cmd`
 *
 * Known limitations:
 * - Bitwise operations use JavaScript's 32-bit signed integers, not 64-bit.
 *   This means values like (1 << 31) will be negative (-2147483648) instead
 *   of the bash 64-bit result (2147483648).
 * - Dynamic arithmetic expressions (e.g., ${base}#a where base=16) are not
 *   fully supported - variable expansion happens at parse time, not runtime.
 */

import type { ArithExpr } from "../ast/types.js";
import {
  parseArithExpr,
  parseArithNumber,
} from "../parser/arithmetic-parser.js";
import { Parser } from "../parser/parser.js";
import { ArithmeticError, NounsetError } from "./errors.js";
import { getArrayElements, getVariable } from "./expansion.js";
import type { InterpreterContext } from "./types.js";

/**
 * Pure binary operator evaluation - no async, no side effects.
 * Shared by both sync and async evaluators.
 */
function applyBinaryOp(left: number, right: number, operator: string): number {
  switch (operator) {
    case "+":
      return left + right;
    case "-":
      return left - right;
    case "*":
      return left * right;
    case "/":
      return right !== 0 ? Math.trunc(left / right) : 0;
    case "%":
      return right !== 0 ? left % right : 0;
    case "**":
      // Bash disallows negative exponents
      if (right < 0) {
        throw new ArithmeticError("exponent less than 0");
      }
      return left ** right;
    case "<<":
      return left << right;
    case ">>":
      return left >> right;
    case "<":
      return left < right ? 1 : 0;
    case "<=":
      return left <= right ? 1 : 0;
    case ">":
      return left > right ? 1 : 0;
    case ">=":
      return left >= right ? 1 : 0;
    case "==":
      return left === right ? 1 : 0;
    case "!=":
      return left !== right ? 1 : 0;
    case "&":
      return left & right;
    case "|":
      return left | right;
    case "^":
      return left ^ right;
    case ",":
      return right;
    default:
      return 0;
  }
}

/**
 * Pure assignment operator evaluation - no async, no side effects on ctx.
 * Returns the new value to be assigned.
 */
function applyAssignmentOp(
  current: number,
  value: number,
  operator: string,
): number {
  switch (operator) {
    case "=":
      return value;
    case "+=":
      return current + value;
    case "-=":
      return current - value;
    case "*=":
      return current * value;
    case "/=":
      return value !== 0 ? Math.trunc(current / value) : 0;
    case "%=":
      return value !== 0 ? current % value : 0;
    case "<<=":
      return current << value;
    case ">>=":
      return current >> value;
    case "&=":
      return current & value;
    case "|=":
      return current | value;
    case "^=":
      return current ^ value;
    default:
      return value;
  }
}

/**
 * Pure unary operator evaluation - no async, no side effects.
 * For ++/-- operators, this only handles the operand transformation,
 * not the variable assignment which must be done by the caller.
 */
function applyUnaryOp(operand: number, operator: string): number {
  switch (operator) {
    case "-":
      return -operand;
    case "+":
      return +operand;
    case "!":
      return operand === 0 ? 1 : 0;
    case "~":
      return ~operand;
    default:
      return operand;
  }
}

/**
 * Get an arithmetic variable value with array[0] decay support.
 * In bash, when an array variable is used without an index in arithmetic context,
 * it decays to the value at index 0.
 */
function getArithVariable(ctx: InterpreterContext, name: string): string {
  // First try to get the direct variable value
  const directValue = ctx.state.env[name];
  if (directValue !== undefined) {
    return directValue;
  }
  // Array decay: if varName_0 exists, the variable is an array and we use element 0
  const arrayZeroValue = ctx.state.env[`${name}_0`];
  if (arrayZeroValue !== undefined) {
    return arrayZeroValue;
  }
  // Fall back to getVariable for special variables
  return getVariable(ctx, name);
}

/**
 * Parse a string value as an arithmetic expression.
 * Unlike resolveArithVariable, this throws on parse errors (e.g., "12 34" is invalid).
 * Used for array element access where the value must be valid arithmetic.
 */
function parseArithValue(value: string): number {
  if (!value) {
    return 0;
  }

  // Try to parse as a simple number
  const num = Number.parseInt(value, 10);
  if (!Number.isNaN(num) && /^-?\d+$/.test(value.trim())) {
    return num;
  }

  const trimmed = value.trim();

  // If it's empty, return 0
  if (!trimmed) {
    return 0;
  }

  // If it contains spaces and isn't a valid arithmetic expression, it's an error
  // Parse it to validate - if parsing fails, throw
  try {
    const parser = new Parser();
    const { expr, pos } = parseArithExpr(parser, trimmed, 0);
    // Check if we parsed the whole string (pos should be at the end)
    if (pos < trimmed.length) {
      // There's unparsed content - find the error token
      const errorToken = trimmed.slice(pos).trim().split(/\s+/)[0];
      throw new ArithmeticError(
        `${trimmed}: syntax error in expression (error token is "${errorToken}")`,
      );
    }
    // We don't actually evaluate here - just return the parsed number
    // Since this is for scalar decay, we just want to validate it's parseable
    if (expr.type === "ArithNumber") {
      return expr.value;
    }
    // For other expression types, return 0 (they need full evaluation)
    return num || 0;
  } catch (error) {
    if (error instanceof ArithmeticError) {
      throw error;
    }
    // Parse failed - find the error token
    const errorToken = trimmed.split(/\s+/).slice(1)[0] || trimmed;
    throw new ArithmeticError(
      `${trimmed}: syntax error in expression (error token is "${errorToken}")`,
    );
  }
}

/**
 * Recursively resolve a variable name to its numeric value.
 * In bash arithmetic, if a variable contains a string that is another variable name
 * or an arithmetic expression, it is recursively evaluated:
 *   foo=5; bar=foo; $((bar)) => 5
 *   e=1+2; $((e + 3)) => 6
 */
function resolveArithVariable(
  ctx: InterpreterContext,
  name: string,
  visited: Set<string> = new Set(),
): number {
  // Prevent infinite recursion
  if (visited.has(name)) {
    return 0;
  }
  visited.add(name);

  const value = getArithVariable(ctx, name);

  // If value is empty or undefined, return 0
  if (!value) {
    return 0;
  }

  // Try to parse as a number
  const num = Number.parseInt(value, 10);
  if (!Number.isNaN(num) && /^-?\d+$/.test(value.trim())) {
    return num;
  }

  const trimmed = value.trim();

  // If it's not a number, check if it's a variable name
  // In bash, arithmetic context recursively evaluates variable names
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    return resolveArithVariable(ctx, trimmed, visited);
  }

  // Dynamic arithmetic: If the value contains arithmetic operators, parse and evaluate it
  // This handles cases like e=1+2; $((e + 3)) => 6
  try {
    const parser = new Parser();
    const { expr } = parseArithExpr(parser, trimmed, 0);
    // Evaluate the parsed expression (with visited set to prevent infinite recursion)
    return evaluateArithmeticSyncWithVisited(ctx, expr, visited);
  } catch {
    // If parsing fails, return 0
    return 0;
  }
}

/**
 * Internal version of evaluateArithmeticSync that passes through visited set
 * for dynamic parsing recursion detection.
 */
function evaluateArithmeticSyncWithVisited(
  ctx: InterpreterContext,
  expr: ArithExpr,
  visited: Set<string>,
): number {
  switch (expr.type) {
    case "ArithNumber":
      if (Number.isNaN(expr.value)) {
        throw new ArithmeticError("value too great for base");
      }
      return expr.value;
    case "ArithVariable": {
      return resolveArithVariable(ctx, expr.name, visited);
    }
    case "ArithSpecialVar": {
      // Get the special variable value (e.g., $*, $@, $#) and parse as arithmetic
      const value = getVariable(ctx, expr.name);
      // For arithmetic, parse the resulting string
      const trimmed = value.trim();
      if (!trimmed) return 0;
      // Try to parse as a simple integer first (must be all digits, not "1 + 1")
      const num = Number.parseInt(trimmed, 10);
      if (!Number.isNaN(num) && /^-?\d+$/.test(trimmed)) return num;
      // If not a simple number, evaluate as arithmetic expression
      const parser = new Parser();
      const { expr: parsed } = parseArithExpr(parser, trimmed, 0);
      return evaluateArithmeticSyncWithVisited(ctx, parsed, visited);
    }
    case "ArithBinary": {
      // Short-circuit evaluation for logical operators
      if (expr.operator === "||") {
        const left = evaluateArithmeticSyncWithVisited(ctx, expr.left, visited);
        if (left) return 1;
        return evaluateArithmeticSyncWithVisited(ctx, expr.right, visited)
          ? 1
          : 0;
      }
      if (expr.operator === "&&") {
        const left = evaluateArithmeticSyncWithVisited(ctx, expr.left, visited);
        if (!left) return 0;
        return evaluateArithmeticSyncWithVisited(ctx, expr.right, visited)
          ? 1
          : 0;
      }
      const left = evaluateArithmeticSyncWithVisited(ctx, expr.left, visited);
      const right = evaluateArithmeticSyncWithVisited(ctx, expr.right, visited);
      return applyBinaryOp(left, right, expr.operator);
    }
    case "ArithUnary": {
      const operand = evaluateArithmeticSyncWithVisited(
        ctx,
        expr.operand,
        visited,
      );
      return applyUnaryOp(operand, expr.operator);
    }
    case "ArithTernary": {
      const condition = evaluateArithmeticSyncWithVisited(
        ctx,
        expr.condition,
        visited,
      );
      return condition
        ? evaluateArithmeticSyncWithVisited(ctx, expr.consequent, visited)
        : evaluateArithmeticSyncWithVisited(ctx, expr.alternate, visited);
    }
    case "ArithGroup":
      return evaluateArithmeticSyncWithVisited(ctx, expr.expression, visited);
    default:
      // For other types, fall back to regular sync evaluation
      return evaluateArithmeticSync(ctx, expr);
  }
}

/**
 * Expand braced parameter content like "j:-5" or "var:=default"
 * Returns the expanded value as a string
 */
function expandBracedContent(ctx: InterpreterContext, content: string): string {
  // Handle ${#var} - length
  if (content.startsWith("#")) {
    const varName = content.slice(1);
    const value = ctx.state.env[varName] || "";
    return String(value.length);
  }

  // Handle ${!var} - indirection
  if (content.startsWith("!")) {
    const varName = content.slice(1);
    const indirect = ctx.state.env[varName] || "";
    return ctx.state.env[indirect] || "";
  }

  // Find operator position
  const operators = [":-", ":=", ":?", ":+", "-", "=", "?", "+"];
  let opIndex = -1;
  let op = "";
  for (const operator of operators) {
    const idx = content.indexOf(operator);
    if (idx > 0 && (opIndex === -1 || idx < opIndex)) {
      opIndex = idx;
      op = operator;
    }
  }

  if (opIndex === -1) {
    // Simple ${var} - just get the variable
    return getVariable(ctx, content);
  }

  const varName = content.slice(0, opIndex);
  const defaultValue = content.slice(opIndex + op.length);
  const value = ctx.state.env[varName];
  const isUnset = value === undefined;
  const isEmpty = value === "";
  const checkEmpty = op.startsWith(":");

  switch (op) {
    case ":-":
    case "-": {
      const useDefault = isUnset || (checkEmpty && isEmpty);
      return useDefault ? defaultValue : value || "";
    }
    case ":=":
    case "=": {
      const useDefault = isUnset || (checkEmpty && isEmpty);
      if (useDefault) {
        ctx.state.env[varName] = defaultValue;
        return defaultValue;
      }
      return value || "";
    }
    case ":+":
    case "+": {
      const useAlternative = !(isUnset || (checkEmpty && isEmpty));
      return useAlternative ? defaultValue : "";
    }
    case ":?":
    case "?": {
      const shouldError = isUnset || (checkEmpty && isEmpty);
      if (shouldError) {
        throw new Error(
          defaultValue || `${varName}: parameter null or not set`,
        );
      }
      return value || "";
    }
    default:
      return value || "";
  }
}

/**
 * Synchronous version of evaluateArithmetic for simple expressions.
 * Does not support command substitution - those will return 0.
 */
export function evaluateArithmeticSync(
  ctx: InterpreterContext,
  expr: ArithExpr,
): number {
  switch (expr.type) {
    case "ArithNumber":
      if (Number.isNaN(expr.value)) {
        throw new ArithmeticError("value too great for base");
      }
      return expr.value;
    case "ArithVariable": {
      // Use recursive resolution - bash evaluates variable names recursively
      return resolveArithVariable(ctx, expr.name);
    }
    case "ArithSpecialVar": {
      // Get the special variable value and parse as arithmetic
      const value = getVariable(ctx, expr.name);
      const trimmed = value.trim();
      if (!trimmed) return 0;
      // Try to parse as a simple integer first (must be all digits, not "1 + 1")
      const num = Number.parseInt(trimmed, 10);
      if (!Number.isNaN(num) && /^-?\d+$/.test(trimmed)) return num;
      // If not a simple number, evaluate as arithmetic expression
      const parser = new Parser();
      const { expr: parsed } = parseArithExpr(parser, trimmed, 0);
      return evaluateArithmeticSync(ctx, parsed);
    }
    case "ArithNested":
      return evaluateArithmeticSync(ctx, expr.expression);
    case "ArithCommandSubst":
      // Command substitution not supported in sync version
      return 0;
    case "ArithBracedExpansion": {
      const expanded = expandBracedContent(ctx, expr.content);
      return Number.parseInt(expanded, 10) || 0;
    }
    case "ArithDynamicBase": {
      // ${base}#value - expand base, then parse value in that base
      const baseStr = expandBracedContent(ctx, expr.baseExpr);
      const base = Number.parseInt(baseStr, 10);
      if (base < 2 || base > 64) return 0;
      const numStr = `${base}#${expr.value}`;
      return parseArithNumber(numStr);
    }
    case "ArithDynamicNumber": {
      // ${zero}11 or ${zero}xAB - expand prefix, combine with suffix
      const prefix = expandBracedContent(ctx, expr.prefix);
      const numStr = prefix + expr.suffix;
      return parseArithNumber(numStr);
    }
    case "ArithArrayElement": {
      const isAssoc = ctx.state.associativeArrays?.has(expr.array);
      let envKey: string;

      if (expr.stringKey !== undefined) {
        // Literal string key: A['key']
        envKey = `${expr.array}_${expr.stringKey}`;
      } else if (isAssoc && expr.index?.type === "ArithVariable") {
        // For associative arrays, variable names are used as literal keys
        // A[K] where K is a variable name -> use "K" as the key
        envKey = `${expr.array}_${expr.index.name}`;
      } else if (expr.index) {
        // For indexed arrays, evaluate the index as arithmetic
        let index = evaluateArithmeticSync(ctx, expr.index);

        // Handle negative indices - bash counts from max_index + 1
        if (index < 0) {
          const elements = getArrayElements(ctx, expr.array);
          const lineNum = ctx.state.currentLine;
          if (elements.length === 0) {
            // Empty array with negative index - output error to stderr and return 0
            ctx.state.expansionStderr =
              (ctx.state.expansionStderr || "") +
              `bash: line ${lineNum}: ${expr.array}: bad array subscript\n`;
            return 0;
          }
          // Find the maximum index
          const maxIndex = Math.max(
            ...elements.map(([idx]) => (typeof idx === "number" ? idx : 0)),
          );
          // Convert negative index to actual index
          const actualIdx = maxIndex + 1 + index;
          if (actualIdx < 0) {
            // Out of bounds negative index - output error to stderr and return 0
            ctx.state.expansionStderr =
              (ctx.state.expansionStderr || "") +
              `bash: line ${lineNum}: ${expr.array}: bad array subscript\n`;
            return 0;
          }
          index = actualIdx;
        }
        envKey = `${expr.array}_${index}`;

        // Array elements are stored as arrayName_index in env
        // But if the variable is a scalar (not an array), s[0] returns the scalar value
        const arrayValue = ctx.state.env[envKey];
        if (arrayValue !== undefined) {
          return parseArithValue(arrayValue);
        }
        // Check if it's a scalar variable (strings decay to s[0] = s)
        if (index === 0) {
          const scalarValue = ctx.state.env[expr.array];
          if (scalarValue !== undefined) {
            return parseArithValue(scalarValue);
          }
        }
        // Variable is not defined - check nounset
        if (ctx.state.options.nounset) {
          // Check if there are ANY elements of this array in env
          const hasAnyElement = Object.keys(ctx.state.env).some(
            (key) => key === expr.array || key.startsWith(`${expr.array}_`),
          );
          if (!hasAnyElement) {
            throw new NounsetError(`${expr.array}[${index}]`);
          }
        }
        return 0;
      } else {
        return 0;
      }

      const arrayValue = ctx.state.env[envKey];
      if (arrayValue !== undefined) {
        return parseArithValue(arrayValue);
      }
      return 0;
    }
    case "ArithDoubleSubscript": {
      // Double subscript like a[1][1] is not valid - fail silently with exit code 1
      throw new ArithmeticError("double subscript", "", "");
    }
    case "ArithNumberSubscript": {
      // Number subscript like 1[2] is not valid - throw syntax error at evaluation time
      throw new ArithmeticError(
        `${expr.number}${expr.errorToken}: syntax error: invalid arithmetic operator (error token is "${expr.errorToken}")`,
      );
    }
    case "ArithSyntaxError": {
      // Syntax error node - throw at evaluation time so script can parse successfully
      throw new ArithmeticError(expr.message);
    }
    case "ArithBinary": {
      // Short-circuit evaluation for logical operators
      if (expr.operator === "||") {
        const left = evaluateArithmeticSync(ctx, expr.left);
        if (left) return 1;
        return evaluateArithmeticSync(ctx, expr.right) ? 1 : 0;
      }
      if (expr.operator === "&&") {
        const left = evaluateArithmeticSync(ctx, expr.left);
        if (!left) return 0;
        return evaluateArithmeticSync(ctx, expr.right) ? 1 : 0;
      }
      const left = evaluateArithmeticSync(ctx, expr.left);
      const right = evaluateArithmeticSync(ctx, expr.right);
      return applyBinaryOp(left, right, expr.operator);
    }
    case "ArithUnary": {
      const operand = evaluateArithmeticSync(ctx, expr.operand);
      // Handle ++/-- with side effects separately
      if (expr.operator === "++" || expr.operator === "--") {
        if (expr.operand.type === "ArithVariable") {
          const name = expr.operand.name;
          const current = Number.parseInt(getVariable(ctx, name), 10) || 0;
          const newValue = expr.operator === "++" ? current + 1 : current - 1;
          ctx.state.env[name] = String(newValue);
          return expr.prefix ? newValue : current;
        }
        if (expr.operand.type === "ArithArrayElement") {
          // Handle array element increment/decrement: a[0]++, ++a[0], etc.
          const arrayName = expr.operand.array;
          const isAssoc = ctx.state.associativeArrays?.has(arrayName);
          let envKey: string;

          if (expr.operand.stringKey !== undefined) {
            envKey = `${arrayName}_${expr.operand.stringKey}`;
          } else if (isAssoc && expr.operand.index?.type === "ArithVariable") {
            envKey = `${arrayName}_${expr.operand.index.name}`;
          } else if (expr.operand.index) {
            const index = evaluateArithmeticSync(ctx, expr.operand.index);
            envKey = `${arrayName}_${index}`;
          } else {
            return operand;
          }

          const current =
            Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
          const newValue = expr.operator === "++" ? current + 1 : current - 1;
          ctx.state.env[envKey] = String(newValue);
          return expr.prefix ? newValue : current;
        }
        if (expr.operand.type === "ArithConcat") {
          // Handle dynamic variable name increment/decrement: x$foo++
          let varName = "";
          for (const part of expr.operand.parts) {
            varName += evalConcatPartToStringSync(ctx, part);
          }
          if (varName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
            const current =
              Number.parseInt(ctx.state.env[varName] || "0", 10) || 0;
            const newValue = expr.operator === "++" ? current + 1 : current - 1;
            ctx.state.env[varName] = String(newValue);
            return expr.prefix ? newValue : current;
          }
        }
        if (expr.operand.type === "ArithDynamicElement") {
          // Handle dynamic array element increment/decrement: x$foo[5]++
          let varName = "";
          if (expr.operand.nameExpr.type === "ArithConcat") {
            for (const part of expr.operand.nameExpr.parts) {
              varName += evalConcatPartToStringSync(ctx, part);
            }
          } else if (expr.operand.nameExpr.type === "ArithVariable") {
            varName = expr.operand.nameExpr.hasDollarPrefix
              ? getVariable(ctx, expr.operand.nameExpr.name)
              : expr.operand.nameExpr.name;
          }
          if (varName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
            const index = evaluateArithmeticSync(ctx, expr.operand.subscript);
            const envKey = `${varName}_${index}`;
            const current =
              Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
            const newValue = expr.operator === "++" ? current + 1 : current - 1;
            ctx.state.env[envKey] = String(newValue);
            return expr.prefix ? newValue : current;
          }
        }
        return operand;
      }
      return applyUnaryOp(operand, expr.operator);
    }
    case "ArithTernary": {
      const condition = evaluateArithmeticSync(ctx, expr.condition);
      return condition
        ? evaluateArithmeticSync(ctx, expr.consequent)
        : evaluateArithmeticSync(ctx, expr.alternate);
    }
    case "ArithAssignment": {
      const name = expr.variable;
      let envKey = name;

      // Handle array element assignment
      if (expr.stringKey !== undefined) {
        // Literal string key: A['key'] = V
        envKey = `${name}_${expr.stringKey}`;
      } else if (expr.subscript) {
        const isAssoc = ctx.state.associativeArrays?.has(name);
        if (isAssoc && expr.subscript.type === "ArithVariable") {
          // For associative arrays, variable names are used as literal keys
          // A[K] = V where K is a variable name -> use "K" as the key, not K's value
          envKey = `${name}_${expr.subscript.name}`;
        } else if (isAssoc) {
          // For non-variable subscripts on associative arrays, evaluate and convert to string
          const index = evaluateArithmeticSync(ctx, expr.subscript);
          envKey = `${name}_${index}`;
        } else {
          // For indexed arrays, evaluate the subscript as arithmetic
          let index = evaluateArithmeticSync(ctx, expr.subscript);
          // Handle negative indices
          if (index < 0) {
            const elements = getArrayElements(ctx, name);
            if (elements.length > 0) {
              const maxIndex = Math.max(
                ...elements.map(([idx]) => (typeof idx === "number" ? idx : 0)),
              );
              index = maxIndex + 1 + index;
            }
          }
          envKey = `${name}_${index}`;
        }
      }

      const current = Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
      const value = evaluateArithmeticSync(ctx, expr.value);
      const newValue = applyAssignmentOp(current, value, expr.operator);
      ctx.state.env[envKey] = String(newValue);
      return newValue;
    }
    case "ArithGroup":
      return evaluateArithmeticSync(ctx, expr.expression);
    case "ArithConcat": {
      // Concatenate all parts to form a dynamic variable name or number
      // For ArithVariable without $, use the literal name; with $, use the value
      let concatenated = "";
      for (const part of expr.parts) {
        concatenated += evalConcatPartToStringSync(ctx, part);
      }
      // If the result is a valid identifier, look it up as a variable
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(concatenated)) {
        return resolveArithVariable(ctx, concatenated);
      }
      // Otherwise parse as a number
      return Number.parseInt(concatenated, 10) || 0;
    }
    case "ArithDynamicAssignment": {
      // Dynamic assignment: x$foo = 42 or x$foo[5] = 42 assigns to variable built from concatenation
      let varName = "";
      // Build the variable name from the target expression
      if (expr.target.type === "ArithConcat") {
        for (const part of expr.target.parts) {
          varName += evalConcatPartToStringSync(ctx, part);
        }
      } else if (expr.target.type === "ArithVariable") {
        varName = expr.target.hasDollarPrefix
          ? getVariable(ctx, expr.target.name)
          : expr.target.name;
      }
      if (!varName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
        return 0; // Invalid variable name
      }
      // Build the env key - include subscript for array assignment
      let envKey = varName;
      if (expr.subscript) {
        const index = evaluateArithmeticSync(ctx, expr.subscript);
        envKey = `${varName}_${index}`;
      }
      const current = Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
      const value = evaluateArithmeticSync(ctx, expr.value);
      const newValue = applyAssignmentOp(current, value, expr.operator);
      ctx.state.env[envKey] = String(newValue);
      return newValue;
    }
    case "ArithDynamicElement": {
      // Dynamic array element: x$foo[5] - build array name from concat, then access element
      let varName = "";
      if (expr.nameExpr.type === "ArithConcat") {
        for (const part of expr.nameExpr.parts) {
          varName += evalConcatPartToStringSync(ctx, part);
        }
      } else if (expr.nameExpr.type === "ArithVariable") {
        varName = expr.nameExpr.hasDollarPrefix
          ? getVariable(ctx, expr.nameExpr.name)
          : expr.nameExpr.name;
      }
      if (!varName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
        return 0; // Invalid variable name
      }
      const index = evaluateArithmeticSync(ctx, expr.subscript);
      const envKey = `${varName}_${index}`;
      const value = ctx.state.env[envKey];
      if (value !== undefined) {
        return parseArithValue(value);
      }
      return 0;
    }
    default:
      return 0;
  }
}

/**
 * Evaluate an arithmetic expression part for concatenation purposes (sync).
 * For ArithVariable without $ prefix, returns the literal name.
 * For ArithVariable with $ prefix, returns the variable's value.
 */
function evalConcatPartToStringSync(
  ctx: InterpreterContext,
  expr: ArithExpr,
): string {
  switch (expr.type) {
    case "ArithNumber":
      return String(expr.value);
    case "ArithVariable":
      // If no $ prefix, use the literal name for building dynamic var names
      // If has $ prefix, expand to the variable's value
      if (expr.hasDollarPrefix) {
        return getVariable(ctx, expr.name);
      }
      return expr.name;
    case "ArithSpecialVar":
      return getVariable(ctx, expr.name);
    case "ArithBracedExpansion":
      return expandBracedContent(ctx, expr.content);
    case "ArithCommandSubst":
      // Not supported in sync
      return "0";
    case "ArithConcat": {
      let result = "";
      for (const part of expr.parts) {
        result += evalConcatPartToStringSync(ctx, part);
      }
      return result;
    }
    default:
      return String(evaluateArithmeticSync(ctx, expr));
  }
}

export async function evaluateArithmetic(
  ctx: InterpreterContext,
  expr: ArithExpr,
): Promise<number> {
  switch (expr.type) {
    case "ArithNumber":
      if (Number.isNaN(expr.value)) {
        throw new ArithmeticError("value too great for base");
      }
      return expr.value;

    case "ArithVariable": {
      // Use recursive resolution - bash evaluates variable names recursively
      return resolveArithVariable(ctx, expr.name);
    }

    case "ArithSpecialVar": {
      // Get the special variable value and parse as arithmetic
      const value = getVariable(ctx, expr.name);
      const trimmed = value.trim();
      if (!trimmed) return 0;
      // Try to parse as a simple integer first (must be all digits, not "1 + 1")
      const num = Number.parseInt(trimmed, 10);
      if (!Number.isNaN(num) && /^-?\d+$/.test(trimmed)) return num;
      // If not a simple number, evaluate as arithmetic expression
      const parser = new Parser();
      const { expr: parsed } = parseArithExpr(parser, trimmed, 0);
      return evaluateArithmetic(ctx, parsed);
    }

    case "ArithNested":
      return evaluateArithmetic(ctx, expr.expression);

    case "ArithCommandSubst": {
      // Execute the command and parse the result as a number
      if (ctx.execFn) {
        const result = await ctx.execFn(expr.command);
        const output = result.stdout.trim();
        return Number.parseInt(output, 10) || 0;
      }
      return 0;
    }

    case "ArithBracedExpansion": {
      const expanded = expandBracedContent(ctx, expr.content);
      return Number.parseInt(expanded, 10) || 0;
    }

    case "ArithDynamicBase": {
      // ${base}#value - expand base, then parse value in that base
      const baseStr = expandBracedContent(ctx, expr.baseExpr);
      const base = Number.parseInt(baseStr, 10);
      if (base < 2 || base > 64) return 0;
      const numStr = `${base}#${expr.value}`;
      return parseArithNumber(numStr);
    }

    case "ArithDynamicNumber": {
      // ${zero}11 or ${zero}xAB - expand prefix, combine with suffix
      const prefix = expandBracedContent(ctx, expr.prefix);
      const numStr = prefix + expr.suffix;
      return parseArithNumber(numStr);
    }

    case "ArithArrayElement": {
      const isAssoc = ctx.state.associativeArrays?.has(expr.array);
      let envKey: string;

      if (expr.stringKey !== undefined) {
        // Literal string key: A['key']
        envKey = `${expr.array}_${expr.stringKey}`;
      } else if (isAssoc && expr.index?.type === "ArithVariable") {
        // For associative arrays, variable names are used as literal keys
        // A[K] where K is a variable name -> use "K" as the key
        envKey = `${expr.array}_${expr.index.name}`;
      } else if (expr.index) {
        // For indexed arrays, evaluate the index as arithmetic
        const index = await evaluateArithmetic(ctx, expr.index);
        envKey = `${expr.array}_${index}`;

        // Array elements are stored as arrayName_index in env
        // But if the variable is a scalar (not an array), s[0] returns the scalar value
        const arrayValue = ctx.state.env[envKey];
        if (arrayValue !== undefined) {
          return parseArithValue(arrayValue);
        }
        // Check if it's a scalar variable (strings decay to s[0] = s)
        if (index === 0) {
          const scalarValue = ctx.state.env[expr.array];
          if (scalarValue !== undefined) {
            return parseArithValue(scalarValue);
          }
        }
        // Variable is not defined - check nounset
        if (ctx.state.options.nounset) {
          // Check if there are ANY elements of this array in env
          const hasAnyElement = Object.keys(ctx.state.env).some(
            (key) => key === expr.array || key.startsWith(`${expr.array}_`),
          );
          if (!hasAnyElement) {
            throw new NounsetError(`${expr.array}[${index}]`);
          }
        }
        return 0;
      } else {
        return 0;
      }

      const arrayValue = ctx.state.env[envKey];
      if (arrayValue !== undefined) {
        return parseArithValue(arrayValue);
      }
      return 0;
    }

    case "ArithDoubleSubscript": {
      // Double subscript like a[1][1] is not valid - fail silently with exit code 1
      throw new ArithmeticError("double subscript", "", "");
    }

    case "ArithNumberSubscript": {
      // Number subscript like 1[2] is not valid - throw syntax error at evaluation time
      throw new ArithmeticError(
        `${expr.number}${expr.errorToken}: syntax error: invalid arithmetic operator (error token is "${expr.errorToken}")`,
      );
    }

    case "ArithSyntaxError": {
      // Syntax error node - throw at evaluation time so script can parse successfully
      throw new ArithmeticError(expr.message);
    }

    case "ArithBinary": {
      // Short-circuit evaluation for logical operators
      if (expr.operator === "||") {
        const left = await evaluateArithmetic(ctx, expr.left);
        if (left) return 1;
        return (await evaluateArithmetic(ctx, expr.right)) ? 1 : 0;
      }
      if (expr.operator === "&&") {
        const left = await evaluateArithmetic(ctx, expr.left);
        if (!left) return 0;
        return (await evaluateArithmetic(ctx, expr.right)) ? 1 : 0;
      }

      const left = await evaluateArithmetic(ctx, expr.left);
      const right = await evaluateArithmetic(ctx, expr.right);
      return applyBinaryOp(left, right, expr.operator);
    }

    case "ArithUnary": {
      const operand = await evaluateArithmetic(ctx, expr.operand);
      // Handle ++/-- with side effects separately
      if (expr.operator === "++" || expr.operator === "--") {
        if (expr.operand.type === "ArithVariable") {
          const name = expr.operand.name;
          const current = Number.parseInt(getVariable(ctx, name), 10) || 0;
          const newValue = expr.operator === "++" ? current + 1 : current - 1;
          ctx.state.env[name] = String(newValue);
          return expr.prefix ? newValue : current;
        }
        if (expr.operand.type === "ArithArrayElement") {
          // Handle array element increment/decrement: a[0]++, ++a[0], etc.
          const arrayName = expr.operand.array;
          const isAssoc = ctx.state.associativeArrays?.has(arrayName);
          let envKey: string;

          if (expr.operand.stringKey !== undefined) {
            envKey = `${arrayName}_${expr.operand.stringKey}`;
          } else if (isAssoc && expr.operand.index?.type === "ArithVariable") {
            envKey = `${arrayName}_${expr.operand.index.name}`;
          } else if (expr.operand.index) {
            const index = await evaluateArithmetic(ctx, expr.operand.index);
            envKey = `${arrayName}_${index}`;
          } else {
            return operand;
          }

          const current =
            Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
          const newValue = expr.operator === "++" ? current + 1 : current - 1;
          ctx.state.env[envKey] = String(newValue);
          return expr.prefix ? newValue : current;
        }
        if (expr.operand.type === "ArithConcat") {
          // Handle dynamic variable name increment/decrement: x$foo++
          let varName = "";
          for (const part of expr.operand.parts) {
            varName += await evalConcatPartToStringAsync(ctx, part);
          }
          if (varName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
            const current =
              Number.parseInt(ctx.state.env[varName] || "0", 10) || 0;
            const newValue = expr.operator === "++" ? current + 1 : current - 1;
            ctx.state.env[varName] = String(newValue);
            return expr.prefix ? newValue : current;
          }
        }
        if (expr.operand.type === "ArithDynamicElement") {
          // Handle dynamic array element increment/decrement: x$foo[5]++
          let varName = "";
          if (expr.operand.nameExpr.type === "ArithConcat") {
            for (const part of expr.operand.nameExpr.parts) {
              varName += await evalConcatPartToStringAsync(ctx, part);
            }
          } else if (expr.operand.nameExpr.type === "ArithVariable") {
            varName = expr.operand.nameExpr.hasDollarPrefix
              ? getVariable(ctx, expr.operand.nameExpr.name)
              : expr.operand.nameExpr.name;
          }
          if (varName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
            const index = await evaluateArithmetic(ctx, expr.operand.subscript);
            const envKey = `${varName}_${index}`;
            const current =
              Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
            const newValue = expr.operator === "++" ? current + 1 : current - 1;
            ctx.state.env[envKey] = String(newValue);
            return expr.prefix ? newValue : current;
          }
        }
        return operand;
      }
      return applyUnaryOp(operand, expr.operator);
    }

    case "ArithTernary": {
      const condition = await evaluateArithmetic(ctx, expr.condition);
      return condition
        ? await evaluateArithmetic(ctx, expr.consequent)
        : await evaluateArithmetic(ctx, expr.alternate);
    }

    case "ArithAssignment": {
      const name = expr.variable;
      let envKey = name;

      // Handle array element assignment
      if (expr.stringKey !== undefined) {
        // Literal string key: A['key'] = V
        envKey = `${name}_${expr.stringKey}`;
      } else if (expr.subscript) {
        const isAssoc = ctx.state.associativeArrays?.has(name);
        if (isAssoc && expr.subscript.type === "ArithVariable") {
          // For associative arrays, variable names are used as literal keys
          // A[K] = V where K is a variable name -> use "K" as the key, not K's value
          envKey = `${name}_${expr.subscript.name}`;
        } else if (isAssoc) {
          // For non-variable subscripts on associative arrays, evaluate and convert to string
          const index = await evaluateArithmetic(ctx, expr.subscript);
          envKey = `${name}_${index}`;
        } else {
          // For indexed arrays, evaluate the subscript as arithmetic
          let index = await evaluateArithmetic(ctx, expr.subscript);
          // Handle negative indices
          if (index < 0) {
            const elements = getArrayElements(ctx, name);
            if (elements.length > 0) {
              const maxIndex = Math.max(
                ...elements.map(([idx]) => (typeof idx === "number" ? idx : 0)),
              );
              index = maxIndex + 1 + index;
            }
          }
          envKey = `${name}_${index}`;
        }
      }

      const current = Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
      const value = await evaluateArithmetic(ctx, expr.value);
      const newValue = applyAssignmentOp(current, value, expr.operator);
      ctx.state.env[envKey] = String(newValue);
      return newValue;
    }

    case "ArithGroup":
      return await evaluateArithmetic(ctx, expr.expression);

    case "ArithConcat": {
      // Concatenate all parts to form a dynamic variable name or number
      // For ArithVariable without $, use the literal name; with $, use the value
      let concatenated = "";
      for (const part of expr.parts) {
        concatenated += await evalConcatPartToStringAsync(ctx, part);
      }
      // If the result is a valid identifier, look it up as a variable
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(concatenated)) {
        return resolveArithVariable(ctx, concatenated);
      }
      // Otherwise parse as a number
      return Number.parseInt(concatenated, 10) || 0;
    }

    case "ArithDynamicAssignment": {
      // Dynamic assignment: x$foo = 42 or x$foo[5] = 42 assigns to variable built from concatenation
      let varName = "";
      // Build the variable name from the target expression
      if (expr.target.type === "ArithConcat") {
        for (const part of expr.target.parts) {
          varName += await evalConcatPartToStringAsync(ctx, part);
        }
      } else if (expr.target.type === "ArithVariable") {
        varName = expr.target.hasDollarPrefix
          ? getVariable(ctx, expr.target.name)
          : expr.target.name;
      }
      if (!varName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
        return 0; // Invalid variable name
      }
      // Build the env key - include subscript for array assignment
      let envKey = varName;
      if (expr.subscript) {
        const index = await evaluateArithmetic(ctx, expr.subscript);
        envKey = `${varName}_${index}`;
      }
      const current = Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
      const value = await evaluateArithmetic(ctx, expr.value);
      const newValue = applyAssignmentOp(current, value, expr.operator);
      ctx.state.env[envKey] = String(newValue);
      return newValue;
    }

    case "ArithDynamicElement": {
      // Dynamic array element: x$foo[5] - build array name from concat, then access element
      let varName = "";
      if (expr.nameExpr.type === "ArithConcat") {
        for (const part of expr.nameExpr.parts) {
          varName += await evalConcatPartToStringAsync(ctx, part);
        }
      } else if (expr.nameExpr.type === "ArithVariable") {
        varName = expr.nameExpr.hasDollarPrefix
          ? getVariable(ctx, expr.nameExpr.name)
          : expr.nameExpr.name;
      }
      if (!varName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
        return 0; // Invalid variable name
      }
      const index = await evaluateArithmetic(ctx, expr.subscript);
      const envKey = `${varName}_${index}`;
      const value = ctx.state.env[envKey];
      if (value !== undefined) {
        return parseArithValue(value);
      }
      return 0;
    }

    default:
      return 0;
  }
}

/**
 * Evaluate an arithmetic expression part for concatenation purposes (async).
 * For ArithVariable without $ prefix, returns the literal name.
 * For ArithVariable with $ prefix, returns the variable's value.
 */
async function evalConcatPartToStringAsync(
  ctx: InterpreterContext,
  expr: ArithExpr,
): Promise<string> {
  switch (expr.type) {
    case "ArithNumber":
      return String(expr.value);
    case "ArithVariable":
      // If no $ prefix, use the literal name for building dynamic var names
      // If has $ prefix, expand to the variable's value
      if (expr.hasDollarPrefix) {
        return getVariable(ctx, expr.name);
      }
      return expr.name;
    case "ArithSpecialVar":
      return getVariable(ctx, expr.name);
    case "ArithBracedExpansion":
      return expandBracedContent(ctx, expr.content);
    case "ArithCommandSubst": {
      if (ctx.execFn) {
        const result = await ctx.execFn(expr.command);
        return result.stdout.trim();
      }
      return "0";
    }
    case "ArithConcat": {
      let result = "";
      for (const part of expr.parts) {
        result += await evalConcatPartToStringAsync(ctx, part);
      }
      return result;
    }
    default:
      return String(await evaluateArithmetic(ctx, expr));
  }
}
