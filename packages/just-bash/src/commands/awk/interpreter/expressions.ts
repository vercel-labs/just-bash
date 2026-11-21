/**
 * AWK Expression Evaluation
 *
 * Async expression evaluator supporting file I/O operations.
 */

import { decodeBytesToUtf8, unsafeBytesFromLatin1 } from "../../../encoding.js";
import { ExecutionLimitError } from "../../../interpreter/errors.js";
import { createUserRegex } from "../../../regex/index.js";
import {
  assertDefenseContext,
  awaitWithDefenseContext,
} from "../../../security/defense-context.js";
import { SecurityViolationError } from "../../../security/defense-in-depth-box.js";
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
  isAwkNumericString,
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
  isStrnumArrayKey,
  isStrnumVar,
  markStrnumArrayKey,
  markStrnumVar,
  resolveArrayName,
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

function assertAwkDefenseContext(ctx: AwkRuntimeContext, phase: string): void {
  assertDefenseContext(ctx.requireDefenseContext, "awk", phase);
}

function withDefenseContext<T>(
  ctx: AwkRuntimeContext,
  phase: string,
  op: () => Promise<T>,
): Promise<T> {
  return awaitWithDefenseContext(ctx.requireDefenseContext, "awk", phase, op);
}

/**
 * Evaluate an AWK expression asynchronously.
 */
export async function evalExpr(
  ctx: AwkRuntimeContext,
  expr: AwkExpr,
): Promise<AwkValue> {
  assertAwkDefenseContext(ctx, "expression evaluation");
  ctx.coverage?.hit(`awk:expr:${expr.type}`);
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
      return isTruthy(
        await withDefenseContext(ctx, "ternary condition evaluation", () =>
          evalExpr(ctx, expr.condition),
        ),
      )
        ? await withDefenseContext(ctx, "ternary consequent evaluation", () =>
            evalExpr(ctx, expr.consequent),
          )
        : await withDefenseContext(ctx, "ternary alternate evaluation", () =>
            evalExpr(ctx, expr.alternate),
          );

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
  assertAwkDefenseContext(ctx, "field reference evaluation");
  const index = Math.floor(
    toNumber(
      await withDefenseContext(ctx, "field index evaluation", () =>
        evalExpr(ctx, expr.index),
      ),
    ),
  );
  return getField(ctx, index);
}

async function evalArrayAccess(
  ctx: AwkRuntimeContext,
  expr: AwkArrayAccess,
): Promise<AwkValue> {
  assertAwkDefenseContext(ctx, "array access evaluation");
  const key = toAwkString(
    await withDefenseContext(ctx, "array key evaluation", () =>
      evalExpr(ctx, expr.key),
    ),
  );
  return getArrayElement(ctx, expr.array, key);
}

async function evalBinaryOp(
  ctx: AwkRuntimeContext,
  expr: { operator: string; left: AwkExpr; right: AwkExpr },
): Promise<AwkValue> {
  assertAwkDefenseContext(ctx, "binary expression evaluation");
  const op = expr.operator;

  // Short-circuit evaluation for logical operators
  if (op === "||") {
    return isTruthy(
      await withDefenseContext(ctx, "logical-or left evaluation", () =>
        evalExpr(ctx, expr.left),
      ),
    ) ||
      isTruthy(
        await withDefenseContext(ctx, "logical-or right evaluation", () =>
          evalExpr(ctx, expr.right),
        ),
      )
      ? 1
      : 0;
  }
  if (op === "&&") {
    return isTruthy(
      await withDefenseContext(ctx, "logical-and left evaluation", () =>
        evalExpr(ctx, expr.left),
      ),
    ) &&
      isTruthy(
        await withDefenseContext(ctx, "logical-and right evaluation", () =>
          evalExpr(ctx, expr.right),
        ),
      )
      ? 1
      : 0;
  }

  // Regex match operators - handle regex literal specially
  if (op === "~") {
    const left = await withDefenseContext(ctx, "regex left evaluation", () =>
      evalExpr(ctx, expr.left),
    );
    if (expr.right.type === "regex") ctx.coverage?.hit("awk:expr:regex");
    const pattern =
      expr.right.type === "regex"
        ? expr.right.pattern
        : toAwkString(
            await withDefenseContext(ctx, "regex right evaluation", () =>
              evalExpr(ctx, expr.right),
            ),
          );
    try {
      return createUserRegex(pattern).test(toAwkString(left)) ? 1 : 0;
    } catch {
      return 0;
    }
  }
  if (op === "!~") {
    const left = await withDefenseContext(
      ctx,
      "negated-regex left evaluation",
      () => evalExpr(ctx, expr.left),
    );
    if (expr.right.type === "regex") ctx.coverage?.hit("awk:expr:regex");
    const pattern =
      expr.right.type === "regex"
        ? expr.right.pattern
        : toAwkString(
            await withDefenseContext(
              ctx,
              "negated-regex right evaluation",
              () => evalExpr(ctx, expr.right),
            ),
          );
    try {
      return createUserRegex(pattern).test(toAwkString(left)) ? 0 : 1;
    } catch {
      return 1;
    }
  }

  const left = await withDefenseContext(ctx, "binary left evaluation", () =>
    evalExpr(ctx, expr.left),
  );
  const right = await withDefenseContext(ctx, "binary right evaluation", () =>
    evalExpr(ctx, expr.right),
  );

  // String concatenation
  if (op === " ") {
    const result = toAwkString(left) + toAwkString(right);
    if (ctx.maxOutputSize > 0 && result.length > ctx.maxOutputSize) {
      throw new ExecutionLimitError(
        `awk: string concatenation size limit exceeded (${ctx.maxOutputSize} bytes)`,
        "string_length",
        ctx.output,
      );
    }
    return result;
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
  assertAwkDefenseContext(ctx, "unary expression evaluation");
  const val = await withDefenseContext(ctx, "unary operand evaluation", () =>
    evalExpr(ctx, expr.operand),
  );
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
  assertAwkDefenseContext(ctx, "function call evaluation");
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

/**
 * The key string of a literal array key ("1", 2), or null when the
 * key is not a literal. A literal key can be resolved without
 * evaluating anything, so provenance lookups through it never run
 * user code twice.
 */
function literalKeyString(key: AwkExpr): string | null {
  if (key.type === "string") return key.value;
  if (key.type === "number") return String(key.value);
  return null;
}

async function callUserFunction(
  ctx: AwkRuntimeContext,
  func: AwkFunctionDef,
  args: AwkExpr[],
): Promise<AwkValue> {
  assertAwkDefenseContext(ctx, "user function call");
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
  // A parameter shadows an outer variable of the same name, so its
  // numeric-string provenance is saved and restored alongside it.
  const savedStrnumParams = new Map<string, boolean>();
  for (const param of func.params) {
    savedParams[param] = ctx.vars[param];
    savedStrnumParams.set(param, isStrnumVar(ctx, param));
  }

  // Track array aliases we create (to clean up later)
  const createdAliases: string[] = [];
  // Aliases this call shadows: an outer call may already have an alias
  // under the same parameter name (e.g. a `how` function called from
  // asort with the same array parameter). Save it so returning restores
  // the outer binding instead of dropping it.
  const shadowedAliases = new Map<string, string>();

  // Resolve array arguments through the caller's aliases BEFORE
  // installing this call's bindings: a nested call reusing the same
  // parameter name (e.g. g(a) inside f(a)) must keep pointing at the
  // caller's array instead of installing a self-alias (a -> a) that
  // shadows it for the duration of the call. Resolving up front also
  // keeps swapped arguments (f(y, x) for f(x, y)) pointing at the
  // right arrays.
  const resolvedArgNames = new Map<number, string>();
  for (let i = 0; i < func.params.length && i < args.length; i++) {
    const arg = args[i];
    if (arg.type === "variable") {
      resolvedArgNames.set(i, resolveArrayName(ctx, arg.name));
    }
  }

  // Snapshot each argument's numeric-string provenance BEFORE any
  // binding is installed, for the same reason as the names above: a
  // later parameter can shadow the variable an argument was read
  // from, so the flag must be captured up front. Only the shapes
  // that carry provenance count — a variable holding a strnum, or an
  // array element with a literal key holding a strnum. A literal or
  // any other expression is a plain string even when it looks
  // numeric: f("10") must not sort "10" numerically. Field
  // arguments are decided in the loop below, from the value just
  // evaluated (a field is a strnum exactly when it looks numeric).
  const argIsStrnum = new Map<number, boolean>();
  for (let i = 0; i < func.params.length && i < args.length; i++) {
    const arg = args[i];
    if (arg.type === "variable") {
      argIsStrnum.set(i, isStrnumVar(ctx, arg.name));
    } else if (arg.type === "array_access") {
      const key = literalKeyString(arg.key);
      argIsStrnum.set(
        i,
        key !== null &&
          isStrnumArrayKey(ctx, resolveArrayName(ctx, arg.array), key),
      );
    }
  }

  // Every parameter shadows the caller's bindings under its name —
  // including omitted parameters and ones receiving a scalar — so a
  // same-named outer array alias must be saved and cleared before
  // this call's bindings are installed. Otherwise the supposedly
  // local parameter keeps sorting (or writing) the caller's array:
  // g() inside f(a) would sort the caller's array, and g(1) would
  // sort it instead of rejecting a scalar. Saved aliases are
  // restored after the call, below.
  for (const param of func.params) {
    const previous = ctx.arrayAliases.get(param);
    if (previous !== undefined) {
      shadowedAliases.set(param, previous);
      ctx.arrayAliases.delete(param);
    }
  }

  // Set up parameters
  for (let i = 0; i < func.params.length; i++) {
    const param = func.params[i];
    if (i < args.length) {
      const arg = args[i];
      // If argument is a simple variable, set up an array alias
      // This allows arrays to be passed by reference
      if (arg.type === "variable") {
        ctx.arrayAliases.set(param, resolvedArgNames.get(i) ?? arg.name);
        createdAliases.push(param);
      }
      const value = await withDefenseContext(
        ctx,
        "user function argument evaluation",
        () => evalExpr(ctx, arg),
      );
      ctx.vars[param] = value;
      // The parameter shadows any outer variable of the same name, so
      // its numeric-string provenance comes only from the argument
      // just passed (snapshot above), never from the value's spelling.
      let paramIsStrnum = argIsStrnum.get(i) ?? false;
      if (arg.type === "field") {
        paramIsStrnum = typeof value === "string" && isAwkNumericString(value);
      }
      markStrnumVar(ctx, param, paramIsStrnum);
    } else {
      // An omitted parameter is untyped: it is neither a scalar nor an
      // array yet, so it must not be stored as "" (which the asort
      // validation would read as an initialized scalar). Reads still
      // yield "" through getVariable's fallback, and a later
      // assignment gives the parameter a type. The slot is deleted
      // rather than left alone so an outer variable of the same name
      // does not leak into the call.
      delete ctx.vars[param];
      markStrnumVar(ctx, param, false);
    }
  }

  // Execute function body
  ctx.hasReturn = false;
  ctx.returnValue = undefined;

  const blockExecutor = executeBlockFn;
  if (blockExecutor) {
    await withDefenseContext(ctx, "user function body execution", () =>
      blockExecutor(ctx, func.body.statements),
    );
  }

  const result = ctx.returnValue ?? "";

  // Restore only parameter variables
  for (const param of func.params) {
    if (savedParams[param] !== undefined) {
      ctx.vars[param] = savedParams[param];
    } else {
      delete ctx.vars[param];
    }
    markStrnumVar(ctx, param, savedStrnumParams.get(param) ?? false);
  }

  // Clean up the call's bindings: restore every outer alias this
  // call shadowed under a parameter name (including parameters that
  // took no array argument), and drop the aliases the call created.
  for (const [param, shadowed] of shadowedAliases) {
    ctx.arrayAliases.set(param, shadowed);
  }
  for (const alias of createdAliases) {
    if (!shadowedAliases.has(alias)) {
      ctx.arrayAliases.delete(alias);
    }
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
  assertAwkDefenseContext(ctx, "assignment evaluation");
  const value = await withDefenseContext(
    ctx,
    "assignment value evaluation",
    () => evalExpr(ctx, expr.value),
  );
  const target = expr.target;
  const op = expr.operator;

  // Numeric-string (strnum) provenance: a value copied straight from
  // an input field ($n), from a variable that itself holds a strnum,
  // or from an array element with a literal key holding a strnum stays
  // a strnum; any other right-hand side (literal, arithmetic,
  // concatenation, function call, ternary, array element with a
  // computed key) is a plain string. Only a plain "=" assignment
  // carries provenance; compound assignments produce numbers.
  const rhsArrayAccess = expr.value.type === "array_access" ? expr.value : null;
  const rhsArrayKey = rhsArrayAccess
    ? literalKeyString(rhsArrayAccess.key)
    : null;
  const rhsIsStrnum =
    op === "=" &&
    ((expr.value.type === "field" &&
      typeof value === "string" &&
      isAwkNumericString(value)) ||
      (expr.value.type === "variable" && isStrnumVar(ctx, expr.value.name)) ||
      (rhsArrayAccess !== null &&
        rhsArrayKey !== null &&
        isStrnumArrayKey(
          ctx,
          resolveArrayName(ctx, rhsArrayAccess.array),
          rhsArrayKey,
        )));

  let finalValue: AwkValue;

  if (op === "=") {
    finalValue = value;
  } else {
    // Compound assignment - get current value
    let current: AwkValue;
    if (target.type === "field") {
      const index = Math.floor(
        toNumber(
          await withDefenseContext(ctx, "assignment field index", () =>
            evalExpr(ctx, target.index),
          ),
        ),
      );
      current = getField(ctx, index);
    } else if (target.type === "variable") {
      current = getVariable(ctx, target.name);
    } else {
      const key = toAwkString(
        await withDefenseContext(ctx, "assignment array key", () =>
          evalExpr(ctx, target.key),
        ),
      );
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
    const index = Math.floor(
      toNumber(
        await withDefenseContext(ctx, "assignment target field index", () =>
          evalExpr(ctx, target.index),
        ),
      ),
    );
    setField(ctx, index, finalValue);
  } else if (target.type === "variable") {
    // setVariable clears the variable's strnum flag; re-mark it when
    // the right-hand side carried numeric-string provenance.
    setVariable(ctx, target.name, finalValue);
    if (rhsIsStrnum) markStrnumVar(ctx, target.name, true);
  } else {
    const key = toAwkString(
      await withDefenseContext(ctx, "assignment target array key", () =>
        evalExpr(ctx, target.key),
      ),
    );
    setArrayElement(ctx, target.array, key, finalValue);
    markStrnumArrayKey(
      ctx,
      resolveArrayName(ctx, target.array),
      key,
      rhsIsStrnum,
    );
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
  assertAwkDefenseContext(ctx, "inc/dec evaluation");
  let oldVal: number;

  if (operand.type === "field") {
    const index = Math.floor(
      toNumber(
        await withDefenseContext(ctx, "inc/dec field index", () =>
          evalExpr(ctx, operand.index),
        ),
      ),
    );
    oldVal = toNumber(getField(ctx, index));
    setField(ctx, index, oldVal + delta);
  } else if (operand.type === "variable") {
    oldVal = toNumber(getVariable(ctx, operand.name));
    setVariable(ctx, operand.name, oldVal + delta);
  } else {
    const key = toAwkString(
      await withDefenseContext(ctx, "inc/dec array key", () =>
        evalExpr(ctx, operand.key),
      ),
    );
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
  assertAwkDefenseContext(ctx, "in-expression evaluation");
  let keyStr: string;
  if (key.type === "tuple") {
    ctx.coverage?.hit("awk:expr:tuple");
    // Multi-dimensional key: join with SUBSEP
    const parts: string[] = [];
    for (const e of key.elements) {
      parts.push(
        toAwkString(
          await withDefenseContext(ctx, "tuple key element evaluation", () =>
            evalExpr(ctx, e),
          ),
        ),
      );
    }
    keyStr = parts.join(ctx.SUBSEP);
  } else {
    keyStr = toAwkString(
      await withDefenseContext(ctx, "in-expression key evaluation", () =>
        evalExpr(ctx, key),
      ),
    );
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
  assertAwkDefenseContext(ctx, "getline evaluation");
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
  const execFn = ctx.exec;
  if (!execFn) {
    return -1; // No exec function available
  }

  assertAwkDefenseContext(ctx, "getline command source");

  const cmd = toAwkString(
    await withDefenseContext(ctx, "getline command expression", () =>
      evalExpr(ctx, cmdExpr),
    ),
  );

  let stream = ctx.getlineCommandStreams.get(cmd);
  if (!stream) {
    // First time running this command
    try {
      const result = await withDefenseContext(ctx, "getline command exec", () =>
        execFn(cmd),
      );
      // awk processes lines with regex / FS — decode bytes to UTF-8 so
      // `getline cmd |` from a piped command keeps multibyte fields whole.
      const output = decodeBytesToUtf8(unsafeBytesFromLatin1(result.stdout));
      const lines = output.split("\n");
      // Remove trailing empty line if output ends with newline
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      stream = { lines, index: -1 };
      ctx.getlineCommandStreams.set(cmd, stream);
    } catch (e) {
      if (e instanceof SecurityViolationError) {
        throw e;
      }
      return -1; // Error running command
    }
  }

  // Get next line
  const nextIndex = stream.index + 1;
  if (nextIndex >= stream.lines.length) {
    return 0; // EOF
  }

  const line = stream.lines[nextIndex];
  stream.index = nextIndex;

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
  const fs = ctx.fs;
  if (!fs || !ctx.cwd) {
    return -1; // No filesystem access
  }

  assertAwkDefenseContext(ctx, "getline file source");
  const filename = toAwkString(
    await withDefenseContext(ctx, "getline filename evaluation", () =>
      evalExpr(ctx, fileExpr),
    ),
  );

  // Special handling for /dev/null - always returns EOF immediately
  if (filename === "/dev/null") {
    return 0;
  }

  const filePath = fs.resolvePath(ctx.cwd, filename);

  let stream = ctx.getlineFileStreams.get(filePath);
  if (!stream) {
    // First time reading this file
    try {
      const content = await withDefenseContext(ctx, "getline file read", () =>
        fs.readFile(filePath),
      );
      const lines = content.split("\n");
      // Remove trailing empty line if file ends with newline
      if (lines.length > 0 && lines[lines.length - 1] === "") {
        lines.pop();
      }
      stream = { lines, index: -1 };
      ctx.getlineFileStreams.set(filePath, stream);
    } catch (e) {
      if (e instanceof SecurityViolationError) {
        throw e;
      }
      return -1; // Error reading file
    }
  }

  // Get next line
  const nextIndex = stream.index + 1;
  if (nextIndex >= stream.lines.length) {
    return 0; // EOF
  }

  const line = stream.lines[nextIndex];
  stream.index = nextIndex;

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
  assertAwkDefenseContext(ctx, "tuple evaluation");
  // Tuple used as expression (comma operator): evaluate all, return last
  if (elements.length === 0) return "";
  for (let i = 0; i < elements.length - 1; i++) {
    await withDefenseContext(ctx, "tuple intermediate element", () =>
      evalExpr(ctx, elements[i]),
    );
  }
  return withDefenseContext(ctx, "tuple final element", () =>
    evalExpr(ctx, elements[elements.length - 1]),
  );
}
