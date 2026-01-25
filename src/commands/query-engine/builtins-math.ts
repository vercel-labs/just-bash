/**
 * Math builtin functions for the query engine.
 * These are extracted to reduce the size of the main evaluator.
 */

import type { EvalContext, QueryValue } from "./evaluator.js";
import type { AstNode } from "./parser.js";

/**
 * Map of simple unary math functions that take a number and return a number.
 * These all follow the same pattern: check typeof === "number", apply Math.fn, return [null] otherwise.
 */
const UNARY_MATH_BUILTINS: Record<string, (n: number) => number> = {
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sqrt: Math.sqrt,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  asinh: Math.asinh,
  acosh: Math.acosh,
  atanh: Math.atanh,
  cbrt: Math.cbrt,
  expm1: Math.expm1,
  log1p: Math.log1p,
  trunc: Math.trunc,
};

// exp10 and exp2 are not in Math, define them separately
const CUSTOM_MATH_BUILTINS: Record<string, (n: number) => number> = {
  exp10: (n: number) => 10 ** n,
  exp2: (n: number) => 2 ** n,
};

/**
 * Try to evaluate a simple unary math builtin.
 * Returns the result array if handled, or null if not a unary math builtin.
 */
export function tryEvalUnaryMathBuiltin(
  name: string,
  value: QueryValue,
): QueryValue[] | null {
  const mathFn = UNARY_MATH_BUILTINS[name] ?? CUSTOM_MATH_BUILTINS[name];
  if (mathFn) {
    if (typeof value === "number") return [mathFn(value)];
    return [null];
  }
  return null;
}

/**
 * Evaluate binary math builtins (functions that take one argument from piped value and one from args).
 * Returns the result array if handled, or null if not a binary math builtin.
 */
export function tryEvalBinaryMathBuiltin(
  name: string,
  value: QueryValue,
  args: AstNode[],
  evaluate: (v: QueryValue, ast: AstNode, ctx: EvalContext) => QueryValue[],
  ctx: EvalContext,
): QueryValue[] | null {
  switch (name) {
    case "pow": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const exps = evaluate(value, args[0], ctx);
      const exp = exps[0] as number;
      return [value ** exp];
    }

    case "atan2": {
      // jq syntax: atan2(y; x) - two explicit arguments
      if (args.length < 2) return [null];
      const y = evaluate(value, args[0], ctx)[0];
      const x = evaluate(value, args[1], ctx)[0];
      if (typeof y !== "number" || typeof x !== "number") return [null];
      return [Math.atan2(y, x)];
    }

    case "hypot": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const y = evaluate(value, args[0], ctx)[0] as number;
      return [Math.hypot(value, y)];
    }

    case "fma": {
      if (typeof value !== "number" || args.length < 2) return [null];
      const y = evaluate(value, args[0], ctx)[0] as number;
      const z = evaluate(value, args[1], ctx)[0] as number;
      return [value * y + z];
    }

    case "copysign": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const y = evaluate(value, args[0], ctx)[0] as number;
      return [Math.sign(y) * Math.abs(value)];
    }

    case "drem":
    case "remainder": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const y = evaluate(value, args[0], ctx)[0] as number;
      return [value - Math.round(value / y) * y];
    }

    case "fdim": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const y = evaluate(value, args[0], ctx)[0] as number;
      return [Math.max(0, value - y)];
    }

    case "fmax": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const y = evaluate(value, args[0], ctx)[0] as number;
      return [Math.max(value, y)];
    }

    case "fmin": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const y = evaluate(value, args[0], ctx)[0] as number;
      return [Math.min(value, y)];
    }

    case "ldexp":
    case "scalbn":
    case "scalbln": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const exp = evaluate(value, args[0], ctx)[0] as number;
      return [value * 2 ** exp];
    }

    case "j0":
    case "j1":
    case "y0":
    case "y1":
      // Bessel functions - not implemented in standard JS Math
      // jq returns null for unimplemented functions
      return [null];

    case "nearbyint":
    case "rint":
      // These are similar to round but with specific IEEE rounding behavior
      // For simplicity, use round
      if (typeof value === "number") return [Math.round(value)];
      return [null];

    case "significand": {
      // Returns significand (mantissa) of a floating point number
      if (typeof value !== "number") return [null];
      if (value === 0) return [0];
      const expS = Math.floor(Math.log2(Math.abs(value)));
      return [value / 2 ** expS];
    }

    case "logb":
      if (typeof value === "number")
        return [Math.floor(Math.log2(Math.abs(value)))];
      return [null];

    case "frexp":
      if (typeof value === "number") {
        if (value === 0) return [[0, 0]];
        const expF = Math.floor(Math.log2(Math.abs(value))) + 1;
        const mantissa = value / 2 ** expF;
        return [[mantissa, expF]];
      }
      return [null];

    case "modf":
      if (typeof value === "number") {
        const intPart = Math.trunc(value);
        const fracPart = value - intPart;
        return [[fracPart, intPart]];
      }
      return [null];

    default:
      return null;
  }
}

/**
 * Handle special math builtins that need custom handling.
 */
export function tryEvalSpecialMathBuiltin(
  name: string,
  value: QueryValue,
): QueryValue[] | null {
  switch (name) {
    case "fabs":
    case "abs":
      // abs has special handling: returns strings unchanged
      if (typeof value === "number") return [Math.abs(value)];
      if (typeof value === "string") return [value];
      return [null];

    case "nan":
      return [Number.NaN];

    case "infinite":
      return [Number.POSITIVE_INFINITY];

    case "isnan":
      return [typeof value === "number" && Number.isNaN(value)];

    case "isinfinite":
      return [
        typeof value === "number" &&
          !Number.isFinite(value) &&
          !Number.isNaN(value),
      ];

    case "isfinite":
      return [typeof value === "number" && Number.isFinite(value)];

    case "isnormal":
      // A number is normal if it's finite, non-zero, and not denormalized
      if (typeof value !== "number") return [false];
      return [
        Number.isFinite(value) &&
          value !== 0 &&
          Math.abs(value) >= Number.MIN_VALUE,
      ];

    default:
      return null;
  }
}
