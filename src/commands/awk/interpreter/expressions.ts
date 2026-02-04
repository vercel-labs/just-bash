/**
 * AWK Expression Evaluation
 *
 * Async expression evaluator supporting file I/O operations.
 */

import { ExecutionLimitError } from "../../../interpreter/errors.js";
import { createUserRegex } from "../../../regex/index.js";
import { applyNumericBinaryOp } from "../../../shared/operators.js";
import type {
  AwkArrayAccess,
  AwkExpr,
  AwkFieldRef,
  AwkFunctionDef,
  AwkVariable,
} from "../ast.js";
import { awkBuiltins } from "../builtins.js";
import type { AwkRuntimeContext } from "./context.js";
import { getField, setCurrentLine, setField } from "./fields.js";
import {
  isTruthy,
  looksLikeNumber,
  matchRegex,
  toAwkString,
  toNumber,
} from "./type-coercion.js";
import type { AwkValue } from "./types.js";
import {
  getArrayElement,
  getVariable,
  hasArrayElement,
  setArrayElement,
  setVariable,
} from "./variables.js";

// Forward declaration for statement executor (needed for user functions)
export type BlockExecutor = (
  ctx: AwkRuntimeContext,
  statements: import("../ast.js").AwkStmt[],
) => Promise<void>;

let executeBlockFn: BlockExecutor | null = null;

/**
 * Set the block executor function (called from statements.ts to avoid circular deps)
 */
export function setBlockExecutor(fn: BlockExecutor): void {
  executeBlockFn = fn;
}

/**
 * Evaluate an AWK expression asynchronously.
 */
export async function evalExpr(
  ctx: AwkRuntimeContext,
  expr: AwkExpr,
): Promise<AwkValue> {
  switch (expr.type) {
    case "number":
      return expr.value;

    case "string":
      return expr.value;

    case "regex":
      // Regex used as expression matches against $0
      return matchRegex(expr.pattern, ctx.line) ? 1 : 0;

    case "field":
      return evalFieldRef(ctx, expr);

    case "variable":
      return getVariable(ctx, expr.name);

    case "array_access":
      return evalArrayAccess(ctx, expr);

    case "binary":
      return evalBinaryOp(ctx, expr);

    case "unary":
      return evalUnaryOp(ctx, expr);

    case "ternary":
      return isTruthy(await evalExpr(ctx, expr.condition))
        ? await evalExpr(ctx, expr.consequent)
        : await evalExpr(ctx, expr.alternate);

    case "call":
      return evalFunctionCall(ctx, expr.name, expr.args);

    case "assignment":
      return evalAssignment(ctx, expr);

    case "pre_increment":
      return evalPreIncrement(ctx, expr.operand);

    case "pre_decrement":
      return evalPreDecrement(ctx, expr.operand);

    case "post_increment":
      return evalPostIncrement(ctx, expr.operand);

    case "post_decrement":
      return evalPostDecrement(ctx, expr.operand);

    case "in":
      return evalInExpr(ctx, expr.key, expr.array);

    case "getline":
      return evalGetline(ctx, expr.variable, expr.file, expr.command);

    case "tuple":
      return evalTuple(ctx, expr.elements);

    default:
      return "";
  }
}

async function evalFieldRef(
  ctx: AwkRuntimeContext,
  expr: AwkFieldRef,
): Promise<AwkValue> {
  const index = Math.floor(toNumber(await evalExpr(ctx, expr.index)));
  return getField(ctx, index);
}

async function evalArrayAccess(
  ctx: AwkRuntimeContext,
  expr: AwkArrayAccess,
): Promise<AwkValue> {
  const key = toAwkString(await evalExpr(ctx, expr.key));
  return getArrayElement(ctx, expr.array, key);
}

async function evalBinaryOp(
  ctx: AwkRuntimeContext,
  expr: { operator: string; left: AwkExpr; right: AwkExpr },
): Promise<AwkValue> {
  const op = expr.operator;

  // Short-circuit evaluation for logical operators
  if (op === "||") {
    return isTruthy(await evalExpr(ctx, expr.left)) ||
      isTruthy(await evalExpr(ctx, expr.right))
      ? 1
      : 0;
  }
  if (op === "&&") {
    return isTruthy(await evalExpr(ctx, expr.left)) &&
      isTruthy(await evalExpr(ctx, expr.right))
      ? 1
      : 0;
  }

  // Regex match operators - handle regex literal specially
  if (op === "~") {
    const left = await evalExpr(ctx, expr.left);
    const pattern =
      expr.right.type === "regex"
        ? expr.right.pattern
        : toAwkString(await evalExpr(ctx, expr.right));
    try {
      return createUserRegex(pattern).test(toAwkString(left)) ? 1 : 0;
    } catch {
      return 0;
    }
  }
  if (op === "!~") {
    const left = await evalExpr(ctx, expr.left);
    const pattern =
      expr.right.type === "regex"
        ? expr.right.pattern
        : toAwkString(await evalExpr(ctx, expr.right));
    try {
      return createUserRegex(pattern).test(toAwkString(left)) ? 0 : 1;
    } catch {
      return 1;
    }
  }

  const left = await evalExpr(ctx, expr.left);
  const right = await evalExpr(ctx, expr.right);

  // String concatenation
  if (op === " ") {
    return toAwkString(left) + toAwkString(right);
  }

  // Comparison operators
  if (isComparisonOp(op)) {
    return evalComparison(left, right, op);
  }

  // Arithmetic operators
  const leftNum = toNumber(left);
  const rightNum = toNumber(right);
  return applyNumericBinaryOp(leftNum, rightNum, op);
}

function isComparisonOp(op: string): boolean {
  return ["<", "<=", ">", ">=", "==", "!="].includes(op);
}

function evalComparison(left: AwkValue, right: AwkValue, op: string): number {
  const leftIsNum = looksLikeNumber(left);
  const rightIsNum = looksLikeNumber(right);

  if (leftIsNum && rightIsNum) {
    const l = toNumber(left);
    const r = toNumber(right);
    switch (op) {
      case "<":
        return l < r ? 1 : 0;
      case "<=":
        return l <= r ? 1 : 0;
      case ">":
        return l > r ? 1 : 0;
      case ">=":
        return l >= r ? 1 : 0;
      case "==":
        return l === r ? 1 : 0;
      case "!=":
        return l !== r ? 1 : 0;
    }
  }

  const l = toAwkString(left);
  const r = toAwkString(right);
  switch (op) {
    case "<":
      return l < r ? 1 : 0;
    case "<=":
      return l <= r ? 1 : 0;
    case ">":
      return l > r ? 1 : 0;
    case ">=":
      return l >= r ? 1 : 0;
    case "==":
      return l === r ? 1 : 0;
    case "!=":
      return l !== r ? 1 : 0;
  }
  return 0;
}

async function evalUnaryOp(
  ctx: AwkRuntimeContext,
  expr: { operator: string; operand: AwkExpr },
): Promise<AwkValue> {
  const val = await evalExpr(ctx, expr.operand);
  switch (expr.operator) {
    case "!":
      return isTruthy(val) ? 0 : 1;
    case "-":
      return -toNumber(val);
    case "+":
      return +toNumber(val);
    default:
      return val;
  }
}

async function evalFunctionCall(
  ctx: AwkRuntimeContext,
  name: string,
  args: AwkExpr[],
): Promise<AwkValue> {
  // Check for built-in functions first
  const builtin = awkBuiltins.get(name);
  if (builtin) {
    // Built-ins use a wrapper that handles async
    return builtin(args, ctx, { evalExpr: (e: AwkExpr) => evalExpr(ctx, e) });
  }

  // Check for user-defined function
  const userFunc = ctx.functions.get(name);
  if (userFunc) {
    return callUserFunction(ctx, userFunc, args);
  }

  return "";
}

async function callUserFunction(
  ctx: AwkRuntimeContext,
  func: AwkFunctionDef,
  args: AwkExpr[],
): Promise<AwkValue> {
  // Check recursion depth limit
  ctx.currentRecursionDepth++;
  if (ctx.currentRecursionDepth > ctx.maxRecursionDepth) {
    ctx.currentRecursionDepth--;
    throw new ExecutionLimitError(
      `awk: recursion depth exceeded maximum (${ctx.maxRecursionDepth})`,
      "recursion",
      ctx.output,
    );
  }

  // Save only parameter variables (they are local in AWK)
  // Use null-prototype to prevent prototype pollution via user-controlled param names
  const savedParams: Record<string, AwkValue | undefined> = Object.create(null);
  for (const param of func.params) {
    savedParams[param] = ctx.vars[param];
  }

  // Track array aliases we create (to clean up later)
  const createdAliases: string[] = [];

  // Set up parameters
  for (let i = 0; i < func.params.length; i++) {
    const param = func.params[i];
    if (i < args.length) {
      const arg = args[i];
      // If argument is a simple variable, set up an array alias
      // This allows arrays to be passed by reference
      if (arg.type === "variable") {
        ctx.arrayAliases.set(param, arg.name);
        createdAliases.push(param);
      }
      const value = await evalExpr(ctx, arg);
      ctx.vars[param] = value;
    } else {
      ctx.vars[param] = "";
    }
  }

  // Execute function body
  ctx.hasReturn = false;
  ctx.returnValue = undefined;

  if (executeBlockFn) {
    await executeBlockFn(ctx, func.body.statements);
  }

  const result = ctx.returnValue ?? "";

  // Restore only parameter variables
  for (const param of func.params) {
    if (savedParams[param] !== undefined) {
      ctx.vars[param] = savedParams[param];
    } else {
      delete ctx.vars[param];
    }
  }

  // Clean up array aliases we created
  for (const alias of createdAliases) {
    ctx.arrayAliases.delete(alias);
  }

  ctx.hasReturn = false;
  ctx.returnValue = undefined;
  ctx.currentRecursionDepth--;

  return result;
}

async function evalAssignment(
  ctx: AwkRuntimeContext,
  expr: {
    operator: string;
    target: AwkFieldRef | AwkVariable | AwkArrayAccess;
    value: AwkExpr;
  },
): Promise<AwkValue> {
  const value = await evalExpr(ctx, expr.value);
  const target = expr.target;
  const op = expr.operator;

  let finalValue: AwkValue;

  if (op === "=") {
    finalValue = value;
  } else {
    // Compound assignment - get current value
    let current: AwkValue;
    if (target.type === "field") {
      const index = Math.floor(toNumber(await evalExpr(ctx, target.index)));
      current = getField(ctx, index);
    } else if (target.type === "variable") {
      current = getVariable(ctx, target.name);
    } else {
      const key = toAwkString(await evalExpr(ctx, target.key));
      current = getArrayElement(ctx, target.array, key);
    }

    const currentNum = toNumber(current);
    const valueNum = toNumber(value);

    switch (op) {
      case "+=":
        finalValue = currentNum + valueNum;
        break;
      case "-=":
        finalValue = currentNum - valueNum;
        break;
      case "*=":
        finalValue = currentNum * valueNum;
        break;
      case "/=":
        finalValue = valueNum !== 0 ? currentNum / valueNum : 0;
        break;
      case "%=":
        finalValue = valueNum !== 0 ? currentNum % valueNum : 0;
        break;
      case "^=":
        finalValue = currentNum ** valueNum;
        break;
      default:
        finalValue = value;
    }
  }

  // Assign to target
  if (target.type === "field") {
    const index = Math.floor(toNumber(await evalExpr(ctx, target.index)));
    setField(ctx, index, finalValue);
  } else if (target.type === "variable") {
    setVariable(ctx, target.name, finalValue);
  } else {
    const key = toAwkString(await evalExpr(ctx, target.key));
    setArrayElement(ctx, target.array, key, finalValue);
  }

  return finalValue;
}

/**
 * Helper for increment/decrement operations.
 * Applies delta (+1 or -1) to the operand and returns either old or new value.
 */
async function applyIncDec(
  ctx: AwkRuntimeContext,
  operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
  delta: 1 | -1,
  returnNew: boolean,
): Promise<number> {
  let oldVal: number;

  if (operand.type === "field") {
    const index = Math.floor(toNumber(await evalExpr(ctx, operand.index)));
    oldVal = toNumber(getField(ctx, index));
    setField(ctx, index, oldVal + delta);
  } else if (operand.type === "variable") {
    oldVal = toNumber(getVariable(ctx, operand.name));
    setVariable(ctx, operand.name, oldVal + delta);
  } else {
    const key = toAwkString(await evalExpr(ctx, operand.key));
    oldVal = toNumber(getArrayElement(ctx, operand.array, key));
    setArrayElement(ctx, operand.array, key, oldVal + delta);
  }

  return returnNew ? oldVal + delta : oldVal;
}

async function evalPreIncrement(
  ctx: AwkRuntimeContext,
  operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
): Promise<AwkValue> {
  return applyIncDec(ctx, operand, 1, true);
}

async function evalPreDecrement(
  ctx: AwkRuntimeContext,
  operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
): Promise<AwkValue> {
  return applyIncDec(ctx, operand, -1, true);
}

async function evalPostIncrement(
  ctx: AwkRuntimeContext,
  operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
): Promise<AwkValue> {
  return applyIncDec(ctx, operand, 1, false);
}

async function evalPostDecrement(
  ctx: AwkRuntimeContext,
  operand: AwkVariable | AwkArrayAccess | AwkFieldRef,
): Promise<AwkValue> {
  return applyIncDec(ctx, operand, -1, false);
}

async function evalInExpr(
  ctx: AwkRuntimeContext,
  key: AwkExpr,
  array: string,
): Promise<AwkValue> {
  let keyStr: string;
  if (key.type === "tuple") {
    // Multi-dimensional key: join with SUBSEP
    const parts: string[] = [];
    for (const e of key.elements) {
      parts.push(toAwkString(await evalExpr(ctx, e)));
    }
    keyStr = parts.join(ctx.SUBSEP);
  } else {
    keyStr = toAwkString(await evalExpr(ctx, key));
  }
  return hasArrayElement(ctx, array, keyStr) ? 1 : 0;
}

/**
 * Evaluate getline - reads next line from current input, file, or command pipe.
 */
async function evalGetline(
  ctx: AwkRuntimeContext,
  variable?: string,
  file?: AwkExpr,
  command?: AwkExpr,
): Promise<AwkValue> {
  // "cmd" | getline - read from command pipe
  if (command) {
    return evalGetlineFromCommand(ctx, variable, command);
  }

  // getline < "file" - read from external file
  if (file) {
    return evalGetlineFromFile(ctx, variable, file);
  }

  // Plain getline - read from current input
  if (!ctx.lines || ctx.lineIndex === undefined) {
    return -1;
  }

  const nextLineIndex = ctx.lineIndex + 1;
  if (nextLineIndex >= ctx.lines.length) {
    return 0; // No more lines
  }

  const nextLine = ctx.lines[nextLineIndex];

  if (variable) {
    setVariable(ctx, variable, nextLine);
  } else {
    setCurrentLine(ctx, nextLine);
  }

  ctx.NR++;
  ctx.lineIndex = nextLineIndex;

  return 1;
}

/**
 * Read a line from a command pipe: "cmd" | getline [var]
 * The command is executed and its output is read line by line.
 */
async function evalGetlineFromCommand(
  ctx: AwkRuntimeContext,
  variable: string | undefined,
  cmdExpr: AwkExpr,
): Promise<AwkValue> {
  if (!ctx.exec) {
    return -1; // No exec function available
  }

  const cmd = toAwkString(await evalExpr(ctx, cmdExpr));

  // Use a cache for command output, similar to file caching
  const cacheKey = `__cmd_${cmd}`;
  const indexKey = `__cmdi_${cmd}`;

  let lines: string[];
  let lineIndex: number;

  if (ctx.vars[cacheKey] === undefined) {
    // First time running this command
    try {
      const result = await ctx.exec(cmd);
      const output = result.stdout;
      lines = output.split("\n");
      // Remove trailing empty line if output ends with newline
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      // Store in cache
      ctx.vars[cacheKey] = JSON.stringify(lines);
      ctx.vars[indexKey] = -1;
      lineIndex = -1;
    } catch {
      return -1; // Error running command
    }
  } else {
    // Command already cached
    lines = JSON.parse(ctx.vars[cacheKey] as string);
    lineIndex = ctx.vars[indexKey] as number;
  }

  // Get next line
  const nextIndex = lineIndex + 1;
  if (nextIndex >= lines.length) {
    return 0; // EOF
  }

  const line = lines[nextIndex];
  ctx.vars[indexKey] = nextIndex;

  if (variable) {
    setVariable(ctx, variable, line);
  } else {
    setCurrentLine(ctx, line);
  }

  // Note: command pipe getline does NOT update NR

  return 1;
}

/**
 * Read a line from an external file.
 */
async function evalGetlineFromFile(
  ctx: AwkRuntimeContext,
  variable: string | undefined,
  fileExpr: AwkExpr,
): Promise<AwkValue> {
  if (!ctx.fs || !ctx.cwd) {
    return -1; // No filesystem access
  }

  const filename = toAwkString(await evalExpr(ctx, fileExpr));

  // Special handling for /dev/null - always returns EOF immediately
  if (filename === "/dev/null") {
    return 0;
  }

  const filePath = ctx.fs.resolvePath(ctx.cwd, filename);

  // Use a special internal structure to track file state
  // Store as: __file_lines__[filename] = "line1\nline2\n..." (content)
  // Store as: __file_index__[filename] = current line index
  const cacheKey = `__fc_${filePath}`;
  const indexKey = `__fi_${filePath}`;

  let lines: string[];
  let lineIndex: number;

  if (ctx.vars[cacheKey] === undefined) {
    // First time reading this file
    try {
      const content = await ctx.fs.readFile(filePath);
      lines = content.split("\n");
      // Remove trailing empty line if file ends with newline
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      // Store in cache (as JSON for simplicity)
      ctx.vars[cacheKey] = JSON.stringify(lines);
      ctx.vars[indexKey] = -1;
      lineIndex = -1;
    } catch {
      return -1; // Error reading file
    }
  } else {
    // File already cached
    lines = JSON.parse(ctx.vars[cacheKey] as string);
    lineIndex = ctx.vars[indexKey] as number;
  }

  // Get next line
  const nextIndex = lineIndex + 1;
  if (nextIndex >= lines.length) {
    return 0; // EOF
  }

  const line = lines[nextIndex];
  ctx.vars[indexKey] = nextIndex;

  if (variable) {
    setVariable(ctx, variable, line);
  } else {
    setCurrentLine(ctx, line);
  }

  // Note: getline from file does NOT update NR

  return 1;
}

async function evalTuple(
  ctx: AwkRuntimeContext,
  elements: AwkExpr[],
): Promise<AwkValue> {
  // Tuple used as expression (comma operator): evaluate all, return last
  if (elements.length === 0) return "";
  for (let i = 0; i < elements.length - 1; i++) {
    await evalExpr(ctx, elements[i]);
  }
  return evalExpr(ctx, elements[elements.length - 1]);
}
