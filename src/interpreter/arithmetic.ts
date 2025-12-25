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
import { parseArithNumber } from "../parser/arithmetic-parser.js";
import { getVariable } from "./expansion.js";
import type { InterpreterContext } from "./types.js";

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
      return expr.value;
    case "ArithVariable": {
      const value = getArithVariable(ctx, expr.name);
      return Number.parseInt(value, 10) || 0;
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
      const index = evaluateArithmeticSync(ctx, expr.index);
      // Array elements are stored as arrayName_index in env
      const value = ctx.state.env[`${expr.array}_${index}`];
      return Number.parseInt(value || "0", 10) || 0;
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
      switch (expr.operator) {
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
            throw new Error("exponent less than 0");
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
    case "ArithUnary": {
      const operand = evaluateArithmeticSync(ctx, expr.operand);
      switch (expr.operator) {
        case "-":
          return -operand;
        case "+":
          return +operand;
        case "!":
          return operand === 0 ? 1 : 0;
        case "~":
          return ~operand;
        case "++":
        case "--":
          if (expr.operand.type === "ArithVariable") {
            const name = expr.operand.name;
            const current = Number.parseInt(getVariable(ctx, name), 10) || 0;
            const newValue = expr.operator === "++" ? current + 1 : current - 1;
            ctx.state.env[name] = String(newValue);
            return expr.prefix ? newValue : current;
          }
          return operand;
        default:
          return operand;
      }
    }
    case "ArithTernary": {
      const condition = evaluateArithmeticSync(ctx, expr.condition);
      return condition
        ? evaluateArithmeticSync(ctx, expr.consequent)
        : evaluateArithmeticSync(ctx, expr.alternate);
    }
    case "ArithAssignment": {
      const name = expr.variable;
      const current = Number.parseInt(getVariable(ctx, name), 10) || 0;
      const value = evaluateArithmeticSync(ctx, expr.value);
      let newValue: number;
      switch (expr.operator) {
        case "=":
          newValue = value;
          break;
        case "+=":
          newValue = current + value;
          break;
        case "-=":
          newValue = current - value;
          break;
        case "*=":
          newValue = current * value;
          break;
        case "/=":
          newValue = value !== 0 ? Math.trunc(current / value) : 0;
          break;
        case "%=":
          newValue = value !== 0 ? current % value : 0;
          break;
        case "<<=":
          newValue = current << value;
          break;
        case ">>=":
          newValue = current >> value;
          break;
        case "&=":
          newValue = current & value;
          break;
        case "|=":
          newValue = current | value;
          break;
        case "^=":
          newValue = current ^ value;
          break;
        default:
          newValue = value;
      }
      ctx.state.env[name] = String(newValue);
      return newValue;
    }
    case "ArithGroup":
      return evaluateArithmeticSync(ctx, expr.expression);
    default:
      return 0;
  }
}

export async function evaluateArithmetic(
  ctx: InterpreterContext,
  expr: ArithExpr,
): Promise<number> {
  switch (expr.type) {
    case "ArithNumber":
      return expr.value;

    case "ArithVariable": {
      const value = getArithVariable(ctx, expr.name);
      return Number.parseInt(value, 10) || 0;
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
      const index = await evaluateArithmetic(ctx, expr.index);
      // Array elements are stored as arrayName_index in env
      const value = ctx.state.env[`${expr.array}_${index}`];
      return Number.parseInt(value || "0", 10) || 0;
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

      switch (expr.operator) {
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
            throw new Error("exponent less than 0");
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

    case "ArithUnary": {
      const operand = await evaluateArithmetic(ctx, expr.operand);
      switch (expr.operator) {
        case "-":
          return -operand;
        case "+":
          return +operand;
        case "!":
          return operand === 0 ? 1 : 0;
        case "~":
          return ~operand;
        case "++":
        case "--": {
          if (expr.operand.type === "ArithVariable") {
            const name = expr.operand.name;
            const current = Number.parseInt(getVariable(ctx, name), 10) || 0;
            const newValue = expr.operator === "++" ? current + 1 : current - 1;
            ctx.state.env[name] = String(newValue);
            return expr.prefix ? newValue : current;
          }
          return operand;
        }
        default:
          return operand;
      }
    }

    case "ArithTernary": {
      const condition = await evaluateArithmetic(ctx, expr.condition);
      return condition
        ? await evaluateArithmetic(ctx, expr.consequent)
        : await evaluateArithmetic(ctx, expr.alternate);
    }

    case "ArithAssignment": {
      const name = expr.variable;
      const current = Number.parseInt(getVariable(ctx, name), 10) || 0;
      const value = await evaluateArithmetic(ctx, expr.value);
      let newValue: number;

      switch (expr.operator) {
        case "=":
          newValue = value;
          break;
        case "+=":
          newValue = current + value;
          break;
        case "-=":
          newValue = current - value;
          break;
        case "*=":
          newValue = current * value;
          break;
        case "/=":
          newValue = value !== 0 ? Math.trunc(current / value) : 0;
          break;
        case "%=":
          newValue = value !== 0 ? current % value : 0;
          break;
        case "<<=":
          newValue = current << value;
          break;
        case ">>=":
          newValue = current >> value;
          break;
        case "&=":
          newValue = current & value;
          break;
        case "|=":
          newValue = current | value;
          break;
        case "^=":
          newValue = current ^ value;
          break;
        default:
          newValue = value;
      }

      ctx.state.env[name] = String(newValue);
      return newValue;
    }

    case "ArithGroup":
      return await evaluateArithmetic(ctx, expr.expression);

    default:
      return 0;
  }
}
