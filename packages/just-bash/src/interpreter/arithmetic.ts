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
import { getArrayElement, hasArray, setArrayElement } from "./helpers/array.js";
import type { InterpreterContext } from "./types.js";

interface ArithmeticResolutionContext {
  readonly visited: Set<string>;
  depth: number;
}

function createArithmeticResolutionContext(): ArithmeticResolutionContext {
  return { visited: new Set(), depth: 0 };
}

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
      if (right === 0) {
        throw new ArithmeticError("division by 0");
      }
      return Math.trunc(left / right);
    case "%":
      if (right === 0) {
        throw new ArithmeticError("division by 0");
      }
      return left % right;
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
async function getArithVariable(
  ctx: InterpreterContext,
  name: string,
): Promise<string> {
  // First try to get the direct variable value
  const directValue = ctx.state.env.get(name);
  if (directValue !== undefined) {
    return directValue;
  }
  // Array decay: if varName_0 exists, the variable is an array and we use element 0
  const arrayZeroValue = getArrayElement(ctx, name, 0);
  if (arrayZeroValue !== undefined) {
    return arrayZeroValue;
  }
  // Fall back to getVariable for special variables
  return await getVariable(ctx, name);
}

/**
 * Evaluate a string value as an arithmetic expression with full context.
 * This properly handles expressions like "1+2+3" or "x+y" by parsing and evaluating them.
 */
async function evaluateArithValue(
  ctx: InterpreterContext,
  value: string,
  resolution: ArithmeticResolutionContext,
): Promise<number> {
  if (!value) {
    return 0;
  }

  // Try to parse as a simple number first (fast path)
  const num = Number.parseInt(value, 10);
  if (!Number.isNaN(num) && /^-?\d+$/.test(value.trim())) {
    return num;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }

  // Parse and evaluate as arithmetic expression
  const parser = new Parser();
  const { expr, pos } = parseArithExpr(parser, trimmed, 0);
  if (pos < trimmed.length) {
    // There's unparsed content - this is a syntax error
    // Find the unparsed token for error message
    const unparsed = trimmed.slice(pos).trim();
    const errorToken = unparsed.split(/\s+/)[0] || unparsed;
    throw new ArithmeticError(
      `syntax error in expression (error token is "${errorToken}")`,
      "",
      "",
    );
  }
  return await evaluateArithmeticInternal(ctx, expr, false, resolution);
}

async function evaluateResolvedArithValue(
  ctx: InterpreterContext,
  key: string,
  value: string,
  resolution: ArithmeticResolutionContext,
): Promise<number> {
  if (resolution.depth > 100) {
    throw new ArithmeticError("maximum variable indirection depth exceeded");
  }
  if (resolution.visited.has(key)) {
    throw new ArithmeticError(`arithmetic variable cycle detected at ${key}`);
  }

  resolution.visited.add(key);
  resolution.depth++;
  try {
    return await evaluateArithValue(ctx, value, resolution);
  } finally {
    resolution.depth--;
    resolution.visited.delete(key);
  }
}

/**
 * Recursively resolve a variable name to its numeric value.
 * In bash arithmetic, if a variable contains a string that is another variable name
 * or an arithmetic expression, it is recursively evaluated:
 *   foo=5; bar=foo; $((bar)) => 5
 *   e=1+2; $((e + 3)) => 6
 */
async function resolveArithVariable(
  ctx: InterpreterContext,
  name: string,
  resolution: ArithmeticResolutionContext,
): Promise<number> {
  // Prevent excessively long non-repeating chains
  if (resolution.depth > 100) {
    throw new ArithmeticError("maximum variable indirection depth exceeded");
  }
  // Prevent infinite recursion
  if (resolution.visited.has(name)) {
    throw new ArithmeticError(`arithmetic variable cycle detected at ${name}`);
  }
  resolution.visited.add(name);
  resolution.depth++;

  try {
    const value = await getArithVariable(ctx, name);

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
      return await resolveArithVariable(ctx, trimmed, resolution);
    }

    // Dynamic arithmetic: If the value contains arithmetic operators, parse and evaluate it
    // This handles cases like e=1+2; $((e + 3)) => 6
    const parser = new Parser();
    const { expr, pos } = parseArithExpr(parser, trimmed, 0);

    // Check if we parsed the entire string - if not, it's a syntax error
    // This handles cases like array element "1 3" which parses as "1" leaving " 3" unparsed
    if (pos < trimmed.length) {
      const unparsed = trimmed.slice(pos).trim();
      const errorToken = unparsed.split(/\s+/)[0] || unparsed;
      throw new ArithmeticError(
        `${trimmed}: syntax error in expression (error token is "${errorToken}")`,
      );
    }

    // Evaluate the parsed expression
    return await evaluateArithmeticInternal(ctx, expr, false, resolution);
  } finally {
    resolution.depth--;
    resolution.visited.delete(name);
  }
}

/**
 * Expand braced parameter content like "j:-5" or "var:=default"
 * Returns the expanded value as a string
 */
async function expandBracedContent(
  ctx: InterpreterContext,
  content: string,
): Promise<string> {
  // Handle ${#var} - length
  if (content.startsWith("#")) {
    const varName = content.slice(1);
    // Handle ${#arr[@]} and ${#arr[*]} - array length
    const arrayMatch = varName.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[[@*]\]$/);
    if (arrayMatch) {
      const arrayName = arrayMatch[1];
      const elements = getArrayElements(ctx, arrayName);
      return String(elements.length);
    }
    // Regular ${#var} - string length
    const value = ctx.state.env.get(varName) || "";
    return String(value.length);
  }

  // Handle ${!var} - indirection
  if (content.startsWith("!")) {
    const varName = content.slice(1);
    const indirect = ctx.state.env.get(varName) || "";
    return ctx.state.env.get(indirect) || "";
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
    return await getVariable(ctx, content);
  }

  const varName = content.slice(0, opIndex);
  const defaultValue = content.slice(opIndex + op.length);
  const value = ctx.state.env.get(varName);
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
        ctx.state.env.set(varName, defaultValue);
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

export async function evaluateArithmetic(
  ctx: InterpreterContext,
  expr: ArithExpr,
  isExpansionContext = false,
): Promise<number> {
  return evaluateArithmeticInternal(
    ctx,
    expr,
    isExpansionContext,
    createArithmeticResolutionContext(),
  );
}

async function evaluateArithmeticInternal(
  ctx: InterpreterContext,
  expr: ArithExpr,
  isExpansionContext: boolean,
  resolution: ArithmeticResolutionContext,
): Promise<number> {
  const evaluate = (nestedExpr: ArithExpr, expansion = isExpansionContext) =>
    evaluateArithmeticInternal(ctx, nestedExpr, expansion, resolution);

  switch (expr.type) {
    case "ArithNumber":
      if (Number.isNaN(expr.value)) {
        throw new ArithmeticError("value too great for base");
      }
      return expr.value;

    case "ArithVariable": {
      // Use recursive resolution - bash evaluates variable names recursively
      return await resolveArithVariable(ctx, expr.name, resolution);
    }

    case "ArithSpecialVar": {
      // Get the special variable value and parse as arithmetic
      const value = await getVariable(ctx, expr.name);
      const trimmed = value.trim();
      if (!trimmed) return 0;
      // Try to parse as a simple integer first (must be all digits, not "1 + 1")
      const num = Number.parseInt(trimmed, 10);
      if (!Number.isNaN(num) && /^-?\d+$/.test(trimmed)) return num;
      // If not a simple number, evaluate as arithmetic expression
      const parser = new Parser();
      const { expr: parsed } = parseArithExpr(parser, trimmed, 0);
      return await evaluate(parsed);
    }

    case "ArithNested":
      return await evaluate(expr.expression);

    case "ArithCommandSubst": {
      // Execute the command and parse the result as a number
      if (ctx.execFn) {
        const result = await ctx.execFn(expr.command, {
          signal: ctx.state.signal,
        });
        // Command substitution stderr should go to the shell's stderr at expansion time
        if (result.stderr) {
          ctx.state.expansionStderr =
            (ctx.state.expansionStderr || "") + result.stderr;
        }
        const output = result.stdout.trim();
        return Number.parseInt(output, 10) || 0;
      }
      return 0;
    }

    case "ArithBracedExpansion": {
      const expanded = await expandBracedContent(ctx, expr.content);
      return Number.parseInt(expanded, 10) || 0;
    }

    case "ArithDynamicBase": {
      // ${base}#value - expand base, then parse value in that base
      const baseStr = await expandBracedContent(ctx, expr.baseExpr);
      const base = Number.parseInt(baseStr, 10);
      if (base < 2 || base > 64) return 0;
      const numStr = `${base}#${expr.value}`;
      return parseArithNumber(numStr);
    }

    case "ArithDynamicNumber": {
      // ${zero}11 or ${zero}xAB - expand prefix, combine with suffix
      const prefix = await expandBracedContent(ctx, expr.prefix);
      const numStr = prefix + expr.suffix;
      return parseArithNumber(numStr);
    }

    case "ArithArrayElement": {
      const isAssoc = ctx.state.associativeArrays?.has(expr.array);

      // Helper function to lookup and evaluate array value
      const lookupArrayValue = async (
        key: string | number,
      ): Promise<number> => {
        const arrayValue = getArrayElement(ctx, expr.array, key);
        if (arrayValue !== undefined) {
          return await evaluateResolvedArithValue(
            ctx,
            `${expr.array}[${key}]`,
            arrayValue,
            resolution,
          );
        }
        return 0;
      };

      // Case 1: Literal string key - A['key']
      if (expr.stringKey !== undefined) {
        return await lookupArrayValue(expr.stringKey);
      }

      // Case 2: Associative array with variable name (no $ prefix) - A[K]
      if (
        isAssoc &&
        expr.index?.type === "ArithVariable" &&
        !expr.index.hasDollarPrefix
      ) {
        return await lookupArrayValue(expr.index.name);
      }

      // Case 3: Associative array with $ prefix - A[$key]
      if (
        isAssoc &&
        expr.index?.type === "ArithVariable" &&
        expr.index.hasDollarPrefix
      ) {
        const expandedKey = await getVariable(ctx, expr.index.name);
        return await lookupArrayValue(expandedKey);
      }

      // Case 4: Indexed array - A[expr]
      if (expr.index) {
        let index = await evaluate(expr.index);

        // Handle negative indices - bash counts from max_index + 1
        if (index < 0) {
          const elements = getArrayElements(ctx, expr.array);
          const lineNum = ctx.state.currentLine;
          if (elements.length === 0) {
            ctx.state.expansionStderr =
              (ctx.state.expansionStderr || "") +
              `bash: line ${lineNum}: ${expr.array}: bad array subscript\n`;
            return 0;
          }
          const maxIndex = Math.max(
            ...elements.map(([idx]) => (typeof idx === "number" ? idx : 0)),
          );
          const actualIdx = maxIndex + 1 + index;
          if (actualIdx < 0) {
            ctx.state.expansionStderr =
              (ctx.state.expansionStderr || "") +
              `bash: line ${lineNum}: ${expr.array}: bad array subscript\n`;
            return 0;
          }
          index = actualIdx;
        }

        const envKey = `${expr.array}[${index}]`;
        const arrayValue = getArrayElement(ctx, expr.array, index);
        if (arrayValue !== undefined) {
          return evaluateResolvedArithValue(
            ctx,
            envKey,
            arrayValue,
            resolution,
          );
        }
        // Scalar decay: s[0] returns scalar value s
        if (index === 0) {
          const scalarValue = ctx.state.env.get(expr.array);
          if (scalarValue !== undefined) {
            return evaluateResolvedArithValue(
              ctx,
              expr.array,
              scalarValue,
              resolution,
            );
          }
        }
        // Check nounset
        if (ctx.state.options.nounset) {
          const hasAnyElement =
            ctx.state.env.has(expr.array) || hasArray(ctx, expr.array);
          if (!hasAnyElement) {
            throw new NounsetError(`${expr.array}[${index}]`);
          }
        }
        return 0;
      }

      // No index and no stringKey - invalid
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
      // These are fatal errors (like missing operand) that should abort the script
      throw new ArithmeticError(expr.message, "", "", true);
    }

    case "ArithSingleQuote": {
      // Single-quoted string - behavior depends on context
      // In $(()) expansion context, single quotes cause an error
      // In (()) command context, single quotes work like numbers
      if (isExpansionContext) {
        // This is NOT a fatal error - script continues after
        throw new ArithmeticError(
          `syntax error: operand expected (error token is "'${expr.content}'")`,
        );
      }
      return expr.value;
    }

    case "ArithBinary": {
      // Short-circuit evaluation for logical operators
      if (expr.operator === "||") {
        const left = await evaluate(expr.left);
        if (left) return 1;
        return (await evaluate(expr.right)) ? 1 : 0;
      }
      if (expr.operator === "&&") {
        const left = await evaluate(expr.left);
        if (!left) return 0;
        return (await evaluate(expr.right)) ? 1 : 0;
      }

      const left = await evaluate(expr.left);
      const right = await evaluate(expr.right);
      return applyBinaryOp(left, right, expr.operator);
    }

    case "ArithUnary": {
      const operand = await evaluate(expr.operand);
      // Handle ++/-- with side effects separately
      if (expr.operator === "++" || expr.operator === "--") {
        if (expr.operand.type === "ArithVariable") {
          const name = expr.operand.name;
          const current =
            Number.parseInt(await getVariable(ctx, name), 10) || 0;
          const newValue = expr.operator === "++" ? current + 1 : current - 1;
          ctx.state.env.set(name, String(newValue));
          return expr.prefix ? newValue : current;
        }
        if (expr.operand.type === "ArithArrayElement") {
          // Handle array element increment/decrement: a[0]++, ++a[0], etc.
          const arrayName = expr.operand.array;
          const isAssoc = ctx.state.associativeArrays?.has(arrayName);
          let elementKey: string;

          if (expr.operand.stringKey !== undefined) {
            elementKey = expr.operand.stringKey;
          } else if (
            isAssoc &&
            expr.operand.index?.type === "ArithVariable" &&
            !expr.operand.index.hasDollarPrefix
          ) {
            // A[K]++ where K is without $ -> use "K" as literal key
            elementKey = expr.operand.index.name;
          } else if (
            isAssoc &&
            expr.operand.index?.type === "ArithVariable" &&
            expr.operand.index.hasDollarPrefix
          ) {
            // A[$key]++ where key has $ -> expand $key to get the actual key
            const expandedKey = await getVariable(ctx, expr.operand.index.name);
            elementKey = expandedKey;
          } else if (expr.operand.index) {
            const index = await evaluate(expr.operand.index);
            elementKey = String(index);
          } else {
            return operand;
          }

          const current =
            Number.parseInt(
              getArrayElement(ctx, arrayName, elementKey) || "0",
              10,
            ) || 0;
          const newValue = expr.operator === "++" ? current + 1 : current - 1;
          setArrayElement(
            ctx,
            arrayName,
            elementKey,
            String(newValue),
            isAssoc ? "associative" : "indexed",
          );
          return expr.prefix ? newValue : current;
        }
        if (expr.operand.type === "ArithConcat") {
          // Handle dynamic variable name increment/decrement: x$foo++
          let varName = "";
          for (const part of expr.operand.parts) {
            varName += await evalConcatPartToStringAsync(
              ctx,
              part,
              isExpansionContext,
              resolution,
            );
          }
          if (varName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
            const current =
              Number.parseInt(ctx.state.env.get(varName) || "0", 10) || 0;
            const newValue = expr.operator === "++" ? current + 1 : current - 1;
            ctx.state.env.set(varName, String(newValue));
            return expr.prefix ? newValue : current;
          }
        }
        if (expr.operand.type === "ArithDynamicElement") {
          // Handle dynamic array element increment/decrement: x$foo[5]++
          let varName = "";
          if (expr.operand.nameExpr.type === "ArithConcat") {
            for (const part of expr.operand.nameExpr.parts) {
              varName += await evalConcatPartToStringAsync(
                ctx,
                part,
                isExpansionContext,
                resolution,
              );
            }
          } else if (expr.operand.nameExpr.type === "ArithVariable") {
            varName = expr.operand.nameExpr.hasDollarPrefix
              ? await getVariable(ctx, expr.operand.nameExpr.name)
              : expr.operand.nameExpr.name;
          }
          if (varName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
            const index = await evaluate(expr.operand.subscript);
            const current =
              Number.parseInt(
                getArrayElement(ctx, varName, index) || "0",
                10,
              ) || 0;
            const newValue = expr.operator === "++" ? current + 1 : current - 1;
            setArrayElement(ctx, varName, index, String(newValue));
            return expr.prefix ? newValue : current;
          }
        }
        return operand;
      }
      return applyUnaryOp(operand, expr.operator);
    }

    case "ArithTernary": {
      const condition = await evaluate(expr.condition);
      return condition
        ? await evaluate(expr.consequent)
        : await evaluate(expr.alternate);
    }

    case "ArithAssignment": {
      const name = expr.variable;
      const envKey = name;
      let arrayKey: string | undefined;

      // Handle array element assignment
      if (expr.stringKey !== undefined) {
        // Literal string key: A['key'] = V
        arrayKey = expr.stringKey;
      } else if (expr.subscript) {
        const isAssoc = ctx.state.associativeArrays?.has(name);
        if (
          isAssoc &&
          expr.subscript.type === "ArithVariable" &&
          !expr.subscript.hasDollarPrefix
        ) {
          // For associative arrays, variable names without $ prefix are used as literal keys
          // A[K] = V where K is a variable name without $ -> use "K" as the key
          arrayKey = expr.subscript.name;
        } else if (
          isAssoc &&
          expr.subscript.type === "ArithVariable" &&
          expr.subscript.hasDollarPrefix
        ) {
          // For associative arrays with $ prefix: A[$key] -> expand $key to get the actual key
          // OSH quirk: when the variable is unset/empty in quoted context (A["$key"]),
          // use backslash as key. This matches spec test "bash bug: (( A["$key"] = 1 ))"
          const expandedKey = await getVariable(ctx, expr.subscript.name);
          // When variable expands to empty, use backslash as the key (OSH behavior)
          arrayKey = expandedKey || "\\";
        } else if (isAssoc) {
          // For non-variable subscripts on associative arrays, evaluate and convert to string
          const index = await evaluate(expr.subscript);
          arrayKey = String(index);
        } else {
          // For indexed arrays, evaluate the subscript as arithmetic
          let index = await evaluate(expr.subscript);
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
          arrayKey = String(index);
        }
      }

      const currentValue =
        arrayKey === undefined
          ? ctx.state.env.get(envKey)
          : getArrayElement(ctx, name, arrayKey);
      const current = Number.parseInt(currentValue || "0", 10) || 0;
      const value = await evaluate(expr.value);
      const newValue = applyAssignmentOp(current, value, expr.operator);
      if (arrayKey === undefined) ctx.state.env.set(envKey, String(newValue));
      else {
        setArrayElement(
          ctx,
          name,
          arrayKey,
          String(newValue),
          ctx.state.associativeArrays?.has(name) ? "associative" : "indexed",
        );
      }
      return newValue;
    }

    case "ArithGroup":
      return await evaluate(expr.expression);

    case "ArithConcat": {
      // Concatenate all parts to form a dynamic variable name or number
      // For ArithVariable without $, use the literal name; with $, use the value
      let concatenated = "";
      for (const part of expr.parts) {
        concatenated += await evalConcatPartToStringAsync(
          ctx,
          part,
          isExpansionContext,
          resolution,
        );
      }
      // If the result is a valid identifier, look it up as a variable
      if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(concatenated)) {
        return await resolveArithVariable(ctx, concatenated, resolution);
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
          varName += await evalConcatPartToStringAsync(
            ctx,
            part,
            isExpansionContext,
            resolution,
          );
        }
      } else if (expr.target.type === "ArithVariable") {
        varName = expr.target.hasDollarPrefix
          ? await getVariable(ctx, expr.target.name)
          : expr.target.name;
      }
      if (!varName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
        return 0; // Invalid variable name
      }
      // Build the env key - include subscript for array assignment
      let envKey = varName;
      if (expr.subscript) {
        const index = await evaluate(expr.subscript);
        envKey = `${varName}_${index}`;
      }
      const current =
        Number.parseInt(ctx.state.env.get(envKey) || "0", 10) || 0;
      const value = await evaluate(expr.value);
      const newValue = applyAssignmentOp(current, value, expr.operator);
      ctx.state.env.set(envKey, String(newValue));
      return newValue;
    }

    case "ArithDynamicElement": {
      // Dynamic array element: x$foo[5] - build array name from concat, then access element
      let varName = "";
      if (expr.nameExpr.type === "ArithConcat") {
        for (const part of expr.nameExpr.parts) {
          varName += await evalConcatPartToStringAsync(
            ctx,
            part,
            isExpansionContext,
            resolution,
          );
        }
      } else if (expr.nameExpr.type === "ArithVariable") {
        varName = expr.nameExpr.hasDollarPrefix
          ? await getVariable(ctx, expr.nameExpr.name)
          : expr.nameExpr.name;
      }
      if (!varName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(varName)) {
        return 0; // Invalid variable name
      }
      const index = await evaluate(expr.subscript);
      const envKey = `${varName}_${index}`;
      const value = ctx.state.env.get(envKey);
      if (value !== undefined) {
        return evaluateResolvedArithValue(ctx, envKey, value, resolution);
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
  isExpansionContext = false,
  resolution = createArithmeticResolutionContext(),
): Promise<string> {
  switch (expr.type) {
    case "ArithNumber":
      return String(expr.value);
    case "ArithSingleQuote":
      // For single quotes in concatenation context, evaluate through main evaluator
      // which will handle the expansion vs command context distinction
      return String(
        await evaluateArithmeticInternal(
          ctx,
          expr,
          isExpansionContext,
          resolution,
        ),
      );
    case "ArithVariable":
      // If no $ prefix, use the literal name for building dynamic var names
      // If has $ prefix, expand to the variable's value
      if (expr.hasDollarPrefix) {
        return await getVariable(ctx, expr.name);
      }
      return expr.name;
    case "ArithSpecialVar":
      return await getVariable(ctx, expr.name);
    case "ArithBracedExpansion":
      return await expandBracedContent(ctx, expr.content);
    case "ArithCommandSubst": {
      if (ctx.execFn) {
        const result = await ctx.execFn(expr.command, {
          signal: ctx.state.signal,
        });
        return result.stdout.trim();
      }
      return "0";
    }
    case "ArithConcat": {
      let result = "";
      for (const part of expr.parts) {
        result += await evalConcatPartToStringAsync(
          ctx,
          part,
          isExpansionContext,
          resolution,
        );
      }
      return result;
    }
    default:
      return String(
        await evaluateArithmeticInternal(
          ctx,
          expr,
          isExpansionContext,
          resolution,
        ),
      );
  }
}
