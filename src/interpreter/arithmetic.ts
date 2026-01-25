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
 * Normalize a negative array index to a positive one.
 * Bash counts negative indices from max_index + 1.
 * Returns null if the array is empty or index is out of bounds.
 */
function normalizeArrayIndex(
  ctx: InterpreterContext,
  arrayName: string,
  index: number,
): number | null {
  if (index >= 0) {
    return index;
  }

  const elements = getArrayElements(ctx, arrayName);
  if (elements.length === 0) {
    // Empty array with negative index - output error to stderr
    ctx.state.expansionStderr =
      (ctx.state.expansionStderr || "") +
      `bash: ${arrayName}: bad array subscript\n`;
    return null;
  }

  // Find the maximum index
  const maxIndex = Math.max(
    ...elements.map(([idx]) => (typeof idx === "number" ? idx : 0)),
  );

  // Convert negative index to actual index
  const actualIdx = maxIndex + 1 + index;
  if (actualIdx < 0) {
    // Out of bounds negative index - output error to stderr
    ctx.state.expansionStderr =
      (ctx.state.expansionStderr || "") +
      `bash: ${arrayName}: bad array subscript\n`;
    return null;
  }

  return actualIdx;
}

/**
 * Look up an array element value by index.
 * Handles scalar decay (s[0] returns scalar value) and nounset checking.
 * Returns the numeric value, or 0 if not found.
 */
function lookupArrayElementByIndex(
  ctx: InterpreterContext,
  arrayName: string,
  index: number,
): number {
  const envKey = `${arrayName}_${index}`;

  // Array elements are stored as arrayName_index in env
  const arrayValue = ctx.state.env[envKey];
  if (arrayValue !== undefined) {
    return parseArithValue(arrayValue);
  }

  // Check if it's a scalar variable (strings decay to s[0] = s)
  if (index === 0) {
    const scalarValue = ctx.state.env[arrayName];
    if (scalarValue !== undefined) {
      return parseArithValue(scalarValue);
    }
  }

  // Variable is not defined - check nounset
  if (ctx.state.options.nounset) {
    // Check if there are ANY elements of this array in env
    const hasAnyElement = Object.keys(ctx.state.env).some(
      (key) => key === arrayName || key.startsWith(`${arrayName}_`),
    );
    if (!hasAnyElement) {
      throw new NounsetError(`${arrayName}[${index}]`);
    }
  }

  return 0;
}

/**
 * Look up an array element value by string key (for string literal keys or associative arrays).
 * Returns the numeric value, or 0 if not found.
 */
function lookupArrayElementByKey(
  ctx: InterpreterContext,
  arrayName: string,
  key: string,
): number {
  const envKey = `${arrayName}_${key}`;
  const arrayValue = ctx.state.env[envKey];
  if (arrayValue !== undefined) {
    return parseArithValue(arrayValue);
  }
  return 0;
}

/**
 * Compute the environment key for an array element assignment.
 * Handles string keys, associative array keys, and indexed array subscripts.
 * For indexed arrays, handles negative indices.
 */
function computeAssignmentEnvKey(
  ctx: InterpreterContext,
  arrayName: string,
  stringKey: string | undefined,
  subscript: ArithExpr | undefined,
  evaluatedIndex: number | undefined,
): string {
  if (stringKey !== undefined) {
    // Literal string key: A['key'] = V
    return `${arrayName}_${stringKey}`;
  }

  if (subscript) {
    const isAssoc = ctx.state.associativeArrays?.has(arrayName);

    if (isAssoc && subscript.type === "ArithVariable") {
      // For associative arrays, variable names are used as literal keys
      // A[K] = V where K is a variable name -> use "K" as the key
      return `${arrayName}_${subscript.name}`;
    }

    if (evaluatedIndex !== undefined) {
      let index = evaluatedIndex;
      // Handle negative indices for indexed arrays
      if (!isAssoc && index < 0) {
        const elements = getArrayElements(ctx, arrayName);
        if (elements.length > 0) {
          const maxIndex = Math.max(
            ...elements.map(([idx]) => (typeof idx === "number" ? idx : 0)),
          );
          index = maxIndex + 1 + index;
        }
      }
      return `${arrayName}_${index}`;
    }
  }

  return arrayName;
}

/**
 * Compute the environment key for an array element in increment/decrement operations.
 * Unlike computeAssignmentEnvKey, this doesn't handle negative indices since
 * increment/decrement creates the element if it doesn't exist.
 * Returns null if the key cannot be computed (operand should be returned as-is).
 */
function computeIncrementEnvKey(
  ctx: InterpreterContext,
  arrayName: string,
  stringKey: string | undefined,
  index: ArithExpr | undefined,
  evaluatedIndex: number | undefined,
): string | null {
  if (stringKey !== undefined) {
    return `${arrayName}_${stringKey}`;
  }

  const isAssoc = ctx.state.associativeArrays?.has(arrayName);
  if (isAssoc && index?.type === "ArithVariable") {
    return `${arrayName}_${index.name}`;
  }

  if (evaluatedIndex !== undefined) {
    return `${arrayName}_${evaluatedIndex}`;
  }

  return null;
}

/**
 * Perform an increment or decrement operation on a variable at envKey.
 * Returns the appropriate value based on prefix/postfix semantics.
 */
function performIncrement(
  ctx: InterpreterContext,
  envKey: string,
  operator: "++" | "--",
  isPrefix: boolean,
): number {
  const current = Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
  const newValue = operator === "++" ? current + 1 : current - 1;
  ctx.state.env[envKey] = String(newValue);
  return isPrefix ? newValue : current;
}

/**
 * Core arithmetic evaluation using CPS (Continuation-Passing Style) pattern.
 * Single implementation for both sync and async paths.
 *
 * CPS Callback Contract:
 * - Each callback (`then`, `done`) must be invoked exactly once per code path
 * - Callbacks may throw exceptions, which propagate normally
 * - The return value of the callback becomes the return value of the CPS function
 *
 * For sync (R = number):
 *   - `executeCommand` returns `then("")` (command substitution unsupported)
 *   - `recurse` calls evaluateArithmeticSync and passes result to `then`
 *   - `done` returns the value directly
 *
 * For async (R = Promise<number>):
 *   - `executeCommand` awaits the command and passes stdout to `then`
 *   - `recurse` awaits evaluateArithmetic and passes result to `then`
 *   - `done` returns the value wrapped in a resolved promise
 */
function evaluateArithmeticCPS<R>(
  ctx: InterpreterContext,
  expr: ArithExpr,
  ops: {
    /** Execute a command substitution, pass stdout to continuation */
    executeCommand: (command: string, then: (output: string) => R) => R;
    /** Recursively evaluate a sub-expression, pass result to continuation */
    recurse: (expr: ArithExpr, then: (result: number) => R) => R;
    /** Return a final result from the CPS function */
    done: (result: number) => R;
  },
): R {
  switch (expr.type) {
    case "ArithNumber":
      if (Number.isNaN(expr.value)) {
        throw new ArithmeticError("value too great for base");
      }
      return ops.done(expr.value);

    case "ArithVariable":
      return ops.done(resolveArithVariable(ctx, expr.name));

    case "ArithNested":
      return ops.recurse(expr.expression, ops.done);

    case "ArithCommandSubst":
      return ops.executeCommand(expr.command, (output) =>
        ops.done(Number.parseInt(output.trim(), 10) || 0),
      );

    case "ArithBracedExpansion": {
      const expanded = expandBracedContent(ctx, expr.content);
      return ops.done(Number.parseInt(expanded, 10) || 0);
    }

    case "ArithDynamicBase": {
      const baseStr = expandBracedContent(ctx, expr.baseExpr);
      const base = Number.parseInt(baseStr, 10);
      if (base < 2 || base > 64) return ops.done(0);
      const numStr = `${base}#${expr.value}`;
      return ops.done(parseArithNumber(numStr));
    }

    case "ArithDynamicNumber": {
      const prefix = expandBracedContent(ctx, expr.prefix);
      const numStr = prefix + expr.suffix;
      return ops.done(parseArithNumber(numStr));
    }

    case "ArithArrayElement": {
      const isAssoc = ctx.state.associativeArrays?.has(expr.array);

      if (expr.stringKey !== undefined) {
        return ops.done(
          lookupArrayElementByKey(ctx, expr.array, expr.stringKey),
        );
      }

      if (isAssoc && expr.index?.type === "ArithVariable") {
        return ops.done(
          lookupArrayElementByKey(ctx, expr.array, expr.index.name),
        );
      }

      if (expr.index) {
        return ops.recurse(expr.index, (rawIndex) => {
          const index = normalizeArrayIndex(ctx, expr.array, rawIndex);
          if (index === null) {
            return ops.done(0);
          }
          return ops.done(lookupArrayElementByIndex(ctx, expr.array, index));
        });
      }

      return ops.done(0);
    }

    case "ArithDoubleSubscript":
      throw new ArithmeticError("double subscript", "", "");

    case "ArithNumberSubscript":
      throw new ArithmeticError(
        `${expr.number}${expr.errorToken}: syntax error: invalid arithmetic operator (error token is "${expr.errorToken}")`,
      );

    case "ArithBinary": {
      // Short-circuit evaluation for logical operators
      if (expr.operator === "||") {
        return ops.recurse(expr.left, (left) => {
          if (left) return ops.done(1);
          return ops.recurse(expr.right, (right) => ops.done(right ? 1 : 0));
        });
      }
      if (expr.operator === "&&") {
        return ops.recurse(expr.left, (left) => {
          if (!left) return ops.done(0);
          return ops.recurse(expr.right, (right) => ops.done(right ? 1 : 0));
        });
      }
      return ops.recurse(expr.left, (left) =>
        ops.recurse(expr.right, (right) =>
          ops.done(applyBinaryOp(left, right, expr.operator)),
        ),
      );
    }

    case "ArithUnary": {
      return ops.recurse(expr.operand, (operand) => {
        // Handle ++/-- with side effects
        if (expr.operator === "++" || expr.operator === "--") {
          const op = expr.operator; // Narrow the type to "++" | "--"
          if (expr.operand.type === "ArithVariable") {
            return ops.done(
              performIncrement(ctx, expr.operand.name, op, expr.prefix),
            );
          }
          if (expr.operand.type === "ArithArrayElement") {
            const arrayOp = expr.operand; // Narrow the type
            // Need to evaluate index for array element increment
            const evalIndexAndIncrement = (
              evaluatedIndex: number | undefined,
            ) => {
              const envKey = computeIncrementEnvKey(
                ctx,
                arrayOp.array,
                arrayOp.stringKey,
                arrayOp.index,
                evaluatedIndex,
              );
              if (envKey === null) return ops.done(operand);
              return ops.done(performIncrement(ctx, envKey, op, expr.prefix));
            };

            if (arrayOp.index) {
              return ops.recurse(arrayOp.index, (idx) =>
                evalIndexAndIncrement(idx),
              );
            }
            return evalIndexAndIncrement(undefined);
          }
          return ops.done(operand);
        }
        return ops.done(applyUnaryOp(operand, expr.operator));
      });
    }

    case "ArithTernary":
      return ops.recurse(expr.condition, (condition) =>
        condition
          ? ops.recurse(expr.consequent, ops.done)
          : ops.recurse(expr.alternate, ops.done),
      );

    case "ArithAssignment": {
      const name = expr.variable;
      const needsIndexEval =
        expr.subscript &&
        !(
          ctx.state.associativeArrays?.has(name) &&
          expr.subscript.type === "ArithVariable"
        );

      const doAssignment = (evaluatedIndex: number | undefined) => {
        const envKey = computeAssignmentEnvKey(
          ctx,
          name,
          expr.stringKey,
          expr.subscript,
          evaluatedIndex,
        );
        const current = Number.parseInt(ctx.state.env[envKey] || "0", 10) || 0;
        return ops.recurse(expr.value, (value) => {
          const newValue = applyAssignmentOp(current, value, expr.operator);
          ctx.state.env[envKey] = String(newValue);
          return ops.done(newValue);
        });
      };

      if (needsIndexEval && expr.subscript) {
        return ops.recurse(expr.subscript, doAssignment);
      }
      return doAssignment(undefined);
    }

    case "ArithGroup":
      return ops.recurse(expr.expression, ops.done);

    case "ArithConcat": {
      // Process parts sequentially to build concatenated string
      const processPartsAt = (
        index: number,
        accumulated: string,
        partToString: (e: ArithExpr, then: (s: string) => R) => R,
      ): R => {
        if (index >= expr.parts.length) {
          return ops.done(Number.parseInt(accumulated, 10) || 0);
        }
        return partToString(expr.parts[index], (s) =>
          processPartsAt(index + 1, accumulated + s, partToString),
        );
      };
      // Use evalPartToStringCPS with same ops pattern
      return processPartsAt(0, "", (part, then) =>
        evalPartToStringCPS(ctx, part, {
          executeCommand: ops.executeCommand,
          recurse: ops.recurse,
          done: then,
        }),
      );
    }

    default:
      return ops.done(0);
  }
}

/**
 * Evaluate an arithmetic expression part to its string representation using CPS.
 * Used for ArithConcat where parts need to be converted to strings before joining.
 *
 * See evaluateArithmeticCPS for CPS callback contract documentation.
 */
function evalPartToStringCPS<R>(
  ctx: InterpreterContext,
  expr: ArithExpr,
  ops: {
    executeCommand: (command: string, then: (output: string) => R) => R;
    recurse: (expr: ArithExpr, then: (result: number) => R) => R;
    /** Return a final string result */
    done: (result: string) => R;
  },
): R {
  switch (expr.type) {
    case "ArithNumber":
      return ops.done(String(expr.value));
    case "ArithVariable":
      return ops.done(getVariable(ctx, expr.name));
    case "ArithBracedExpansion":
      return ops.done(expandBracedContent(ctx, expr.content));
    case "ArithCommandSubst":
      return ops.executeCommand(expr.command, (output) =>
        ops.done(output.trim()),
      );
    case "ArithConcat": {
      const processPartsAt = (index: number, accumulated: string): R => {
        if (index >= expr.parts.length) {
          return ops.done(accumulated);
        }
        return evalPartToStringCPS(ctx, expr.parts[index], {
          executeCommand: ops.executeCommand,
          recurse: ops.recurse,
          done: (s) => processPartsAt(index + 1, accumulated + s),
        });
      };
      return processPartsAt(0, "");
    }
    default:
      return ops.recurse(expr, (result) => ops.done(String(result)));
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
  return evaluateArithmeticCPS(ctx, expr, {
    executeCommand: (_cmd, then) => then(""), // sync can't execute commands
    recurse: (e, then) => then(evaluateArithmeticSync(ctx, e)),
    done: (v) => v,
  });
}

export async function evaluateArithmetic(
  ctx: InterpreterContext,
  expr: ArithExpr,
): Promise<number> {
  return evaluateArithmeticCPS(ctx, expr, {
    executeCommand: async (cmd, then) => {
      if (ctx.execFn) {
        const result = await ctx.execFn(cmd);
        return then(result.stdout);
      }
      return then("");
    },
    recurse: async (e, then) => then(await evaluateArithmetic(ctx, e)),
    done: async (v) => v,
  });
}
