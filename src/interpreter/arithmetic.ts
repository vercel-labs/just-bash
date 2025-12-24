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
 */

import type { ArithExpr } from "../ast/types.js";
import { getVariable } from "./expansion.js";
import type { InterpreterContext } from "./types.js";

export function evaluateArithmetic(
  ctx: InterpreterContext,
  expr: ArithExpr,
): number {
  switch (expr.type) {
    case "ArithNumber":
      return expr.value;

    case "ArithVariable": {
      const value = getVariable(ctx, expr.name);
      return Number.parseInt(value, 10) || 0;
    }

    case "ArithBinary": {
      const left = evaluateArithmetic(ctx, expr.left);
      const right = evaluateArithmetic(ctx, expr.right);

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
        case "&&":
          return left && right ? 1 : 0;
        case "||":
          return left || right ? 1 : 0;
        case ",":
          return right;
        default:
          return 0;
      }
    }

    case "ArithUnary": {
      const operand = evaluateArithmetic(ctx, expr.operand);
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
      const condition = evaluateArithmetic(ctx, expr.condition);
      return condition
        ? evaluateArithmetic(ctx, expr.consequent)
        : evaluateArithmetic(ctx, expr.alternate);
    }

    case "ArithAssignment": {
      const name = expr.variable;
      const current = Number.parseInt(getVariable(ctx, name), 10) || 0;
      const value = evaluateArithmetic(ctx, expr.value);
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
      return evaluateArithmetic(ctx, expr.expression);

    default:
      return 0;
  }
}
