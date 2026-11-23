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
import {
  getField,
  isStrnumField,
  markStrnumField,
  setCurrentLine,
  setField,
} from "./fields.js";
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
  deleteArray,
  forgetArrayTyped,
  getArrayElement,
  getVariable,
  hasArrayElement,
  isScalarVariable,
  isStrnumArrayKey,
  isStrnumVar,
  LOCAL_SCALAR_PREFIX,
  markStrnumArrayKey,
  markStrnumVar,
  nextLocalArrayName,
  nextLocalScalarName,
  popArrayFrame,
  pushArrayFrame,
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

    case "ternary": {
      const takeConsequent = isTruthy(
        await withDefenseContext(ctx, "ternary condition evaluation", () =>
          evalExpr(ctx, expr.condition),
        ),
      );
      const branch = takeConsequent ? expr.consequent : expr.alternate;
      const value = await withDefenseContext(
        ctx,
        takeConsequent
          ? "ternary consequent evaluation"
          : "ternary alternate evaluation",
        () => evalExpr(ctx, branch),
      );
      // The selected branch's provenance is the ternary's own: gawk
      // preserves a numeric string through the branch it takes
      // (review 6010326757). Record it before returning, so an
      // assignment or return reading this value sees the branch's
      // flag, not a stale one left by the condition.
      ctx.lastTernaryIsStrnum = exprIsStrnum(ctx, branch);
      return value;
    }

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
  // Record whether this field is a numeric string: the assignment and
  // return paths read it right after evaluating a right-hand side.
  // The index expression runs first, so a field read inside it is
  // overwritten by this (outermost) read.
  ctx.lastFieldIsStrnum = isStrnumField(ctx, index);
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
  // Same provenance record as for fields: a computed key is fine here,
  // because the key was just evaluated to read this element.
  ctx.lastArrayAccessIsStrnum = isStrnumArrayKey(
    ctx,
    resolveArrayName(ctx, expr.array),
    key,
  );
  return getArrayElement(ctx, expr.array, key);
}

/**
 * Whether the value just evaluated from `expr` is a numeric string
 * (strnum). Only assignment ("=") and return statements read this,
 * right after evaluating the value, so the last-read flags always
 * describe it: a field reports its tracked flag, an array element
 * reports the flag its own read recorded (computed keys included), a
 * variable consults its flag, and a function call reports what the
 * callee's return recorded. A ternary reports the flag its selected
 * branch recorded, and an assignment expression reports its
 * right-hand side's flag — gawk preserves a strnum through both
 * shapes (review 6010326757). Every other shape (literal,
 * arithmetic, concatenation, ...) is a plain string.
 */
export function exprIsStrnum(ctx: AwkRuntimeContext, expr: AwkExpr): boolean {
  switch (expr.type) {
    case "field":
      return ctx.lastFieldIsStrnum;
    case "variable":
      return isStrnumVar(ctx, expr.name);
    case "array_access":
      return ctx.lastArrayAccessIsStrnum;
    case "call":
      return ctx.lastCallReturnIsStrnum;
    case "ternary":
      return ctx.lastTernaryIsStrnum;
    case "assignment":
      return ctx.lastAssignmentIsStrnum;
    default:
      return false;
  }
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
  // A call's return provenance starts false: built-ins never return a
  // numeric string, and an unknown function returns "". A user function
  // records its own return when one executes; a function that falls
  // through without returning keeps whatever the last nested call or
  // return left in the flag, as in gawk (verified against gawk 5.2.1:
  // a fall-through after `return $1` inside still sorts as a strnum —
  // review 6011335623).
  ctx.lastCallReturnIsStrnum = false;
  // Check for built-in functions first
  const builtin = awkBuiltins.get(name);
  if (builtin) {
    // Built-ins use a wrapper that handles async
    const result = await withDefenseContext(
      ctx,
      "built-in call evaluation",
      async () =>
        builtin(args, ctx, {
          evalExpr: (e: AwkExpr) => evalExpr(ctx, e),
        }),
    );
    // A built-in never returns a numeric string, so the flag is false
    // after it returns even when a nested user call set it while the
    // built-in's arguments were evaluated (review 6010326757):
    // without this, `x = substr(g(), 1, 1)` would wrongly mark x a
    // strnum whenever g() returned one.
    ctx.lastCallReturnIsStrnum = false;
    return result;
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

  // Resolve array arguments through the caller's frame BEFORE
  // installing this call's bindings: a nested call reusing the same
  // parameter name (e.g. g(a) inside f(a)) must keep pointing at the
  // caller's array instead of installing a self-binding (a -> a) that
  // shadows it for the duration of the call. Resolving up front also
  // keeps swapped arguments (f(y, x) for f(x, y)) pointing at the
  // right arrays.
  const resolvedArgNames = new Map<number, string>();
  // Whether each variable argument already holds a scalar in the
  // caller's frame: such an argument is passed by value, not by
  // reference, so its parameter is a scalar — array operations on it
  // are rejected instead of silently converting the caller's scalar
  // into an array (review 6010326757). An uninitialized variable is
  // untyped (array binding, as before), as is an array.
  const argIsScalarVariable = new Map<number, boolean>();
  for (let i = 0; i < func.params.length && i < args.length; i++) {
    const arg = args[i];
    if (arg.type === "variable") {
      resolvedArgNames.set(i, resolveArrayName(ctx, arg.name));
      argIsScalarVariable.set(i, isScalarVariable(ctx, arg.name));
    }
  }

  // Each argument's numeric-string provenance is captured in the loop
  // below, right after its own evaluation — not in a prepass before
  // any argument runs. A prepass reads stale flags: an earlier
  // argument's side effect can change a variable an argument was read
  // from (h(s="5", s) must see s as a plain string, not the strnum it
  // held before the call), and ternary and assignment arguments never
  // had their provenance captured at all (review 6011335623). The
  // loop runs before any binding is installed, so a later parameter
  // still cannot shadow the variable an argument was read from. Only
  // the shapes that carry provenance count — a variable holding a
  // strnum, an array element, a field, a call's return, a ternary's
  // selected branch, or an assignment's right-hand side. A literal or
  // any other expression is a plain string even when it looks numeric:
  // f("10") must not sort "10" numerically.
  const argIsStrnum = new Map<number, boolean>();

  // Evaluate every argument expression in the caller's frame BEFORE
  // pushing this call's frame: gawk evaluates arguments before the
  // call, so an argument that reads an array must not see a callee
  // parameter of the same name shadow it (h(a[1]) where h has a
  // parameter a used to resolve to h's empty local array instead of
  // the caller's array). Each argument's strnum flag is captured
  // per argument here, right after its own evaluation, because a
  // later argument's reads would overwrite the shared flag.
  const argValues: AwkValue[] = [];
  const argFieldIsStrnum = new Map<number, boolean>();
  for (let i = 0; i < func.params.length && i < args.length; i++) {
    const arg = args[i];
    argValues.push(
      await withDefenseContext(ctx, "user function argument evaluation", () =>
        evalExpr(ctx, arg),
      ),
    );
    if (arg.type === "field") {
      argFieldIsStrnum.set(i, ctx.lastFieldIsStrnum);
    } else if (arg.type === "array_access") {
      // A computed key is fine here: the read just recorded its flag,
      // like the field case above (review 6010326757).
      argIsStrnum.set(i, ctx.lastArrayAccessIsStrnum);
    } else if (arg.type === "call") {
      // A function-call argument's provenance is what the callee
      // returned (review 6010326757).
      argIsStrnum.set(i, ctx.lastCallReturnIsStrnum);
    } else if (arg.type === "variable") {
      // Read after this argument's own evaluation: an earlier
      // argument may have reassigned the variable (review 6011335623).
      argIsStrnum.set(i, isStrnumVar(ctx, arg.name));
    } else if (arg.type === "ternary") {
      // The selected branch's provenance, recorded by the ternary
      // itself (review 6011335623).
      argIsStrnum.set(i, ctx.lastTernaryIsStrnum);
    } else if (arg.type === "assignment") {
      // The right-hand side's provenance, recorded by the assignment
      // itself (review 6011335623).
      argIsStrnum.set(i, ctx.lastAssignmentIsStrnum);
    }
  }

  // Save the parameter slots only AFTER the arguments were evaluated:
  // an argument is evaluated in the caller's frame, so an assignment
  // in it to a same-named caller variable (f(y=9) where f's parameter
  // is y) is a caller-side side effect that must survive the call —
  // saving before evaluation would restore the old value on return
  // and discard it (review 6010326757).
  for (const param of func.params) {
    savedParams[param] = ctx.vars[param];
    savedStrnumParams.set(param, isStrnumVar(ctx, param));
  }

  // Track array aliases we create (to clean up later)
  // This call gets its own array-binding frame (one binding per
  // parameter), installed after the arguments were resolved and
  // evaluated in the caller's frame above: a binding always names the
  // final store, never another parameter, so two parameters can never
  // alias each other through a cycle, and a callee never sees a
  // caller's bindings. Omitted parameters get a fresh empty local array;
  // parameters that received a scalar get a scalar-only binding, so
  // array built-ins reject them instead of reaching an outer array
  // of the same name. The frame is popped (and the local stores it
  // created are dropped) in the finally block below, so a throw in
  // the body cannot leak bindings into the caller either.
  const frame = pushArrayFrame(ctx);
  // Synthetic local stores this call creates, to drop on return.
  // A store passed on to a nested call is shared by name, not
  // recreated, so it is deleted only by the frame that created it.
  const createdLocalStores: string[] = [];

  // Set up parameters
  for (let i = 0; i < func.params.length; i++) {
    const param = func.params[i];
    if (i < args.length) {
      const arg = args[i];
      // If argument is a simple variable, bind the parameter to the
      // array it resolved to in the caller's frame. This allows
      // arrays to be passed by reference; a nested call reusing the
      // same parameter name resolves the argument the same way, so
      // it keeps pointing at the caller's array.
      if (arg.type === "variable") {
        if (argIsScalarVariable.get(i) ?? false) {
          // The argument already holds a scalar in the caller, so
          // the parameter is a scalar local (see the snapshot above):
          // bind it to a scalar-only name so array operations on it
          // are rejected instead of reaching the caller's scalar.
          frame.set(param, nextLocalScalarName(ctx));
        } else {
          frame.set(param, resolvedArgNames.get(i) ?? arg.name);
        }
      } else {
        // A scalar argument: the parameter is a local scalar, not an
        // array. Bind it to a synthetic scalar-only name so array
        // operations on it are rejected instead of resolving to an
        // outer array of the same name.
        frame.set(param, nextLocalScalarName(ctx));
      }
      const value = argValues[i];
      // Only a scalar-bound parameter holds a value in its slot. An
      // array-bound parameter used to be stored as "" (the array's
      // scalar value), which isScalarVariable and assertArrayTarget
      // then read as an initialized scalar: a deleted or
      // uninitialized array passed through same-named parameters was
      // rejected, and T.gawk's arrayref case failed. Delete the slot
      // instead, as the omitted-parameter branch below does, so an
      // outer scalar of the same name cannot leak into the call
      // either — and so a real scalar assigned to the aliased global
      // mid-call is still seen as a scalar (review 6011013916).
      // Reads still yield "" through getVariable's fallback.
      if (frame.get(param)?.startsWith(LOCAL_SCALAR_PREFIX)) {
        ctx.vars[param] = value;
      } else {
        delete ctx.vars[param];
      }
      // The parameter shadows any outer variable of the same name, so
      // its numeric-string provenance comes only from the argument
      // just passed (snapshot above), never from the value's spelling.
      let paramIsStrnum = argIsStrnum.get(i) ?? false;
      if (arg.type === "field") {
        paramIsStrnum = argFieldIsStrnum.get(i) ?? false;
      }
      markStrnumVar(ctx, param, paramIsStrnum);
    } else {
      // An omitted parameter is untyped: it is neither a scalar nor an
      // array yet, so it must not be stored as "" (which the asort
      // validation would read as an initialized scalar). It gets a
      // fresh empty local array under a synthetic name, so array
      // operations on it cannot touch an outer array of the same
      // name. Reads still yield "" through getVariable's fallback,
      // and a later assignment gives the parameter a type. The
      // scalar slot is deleted rather than left alone so an outer
      // variable of the same name does not leak into the call.
      const localName = nextLocalArrayName(ctx);
      frame.set(param, localName);
      ctx.arrays[localName] = Object.create(null);
      createdLocalStores.push(localName);
      delete ctx.vars[param];
      markStrnumVar(ctx, param, false);
    }
  }

  // Execute function body
  ctx.hasReturn = false;
  ctx.returnValue = undefined;

  let result: AwkValue;
  try {
    const blockExecutor = executeBlockFn;
    if (blockExecutor) {
      await withDefenseContext(ctx, "user function body execution", () =>
        blockExecutor(ctx, func.body.statements),
      );
    }

    result = ctx.returnValue ?? "";
  } finally {
    // Restore only parameter variables
    for (const param of func.params) {
      if (savedParams[param] !== undefined) {
        ctx.vars[param] = savedParams[param];
      } else {
        delete ctx.vars[param];
      }
      markStrnumVar(ctx, param, savedStrnumParams.get(param) ?? false);
    }

    // Drop this call's frame and the local stores it created, with
    // their type metadata: a synthetic store's name can never be
    // referenced again once its frame is gone, so its arrayTypedNames
    // entry would otherwise leak one entry per call forever (review
    // 6011013916). Only stores this frame created are dropped — a
    // nested call that aliases an outer frame's local store shares
    // the name, and the outer frame drops it when it returns.
    popArrayFrame(ctx);
    for (const store of createdLocalStores) {
      deleteArray(ctx, store);
      forgetArrayTyped(ctx, store);
    }

    ctx.hasReturn = false;
    ctx.returnValue = undefined;
    ctx.currentRecursionDepth--;
  }

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
  // a field ($n), from a variable that itself holds a strnum, from an
  // array element (any key — the read just recorded its flag), or from
  // a function call that returned one stays a strnum; a ternary or an
  // assignment expression carries its selected branch's / right-hand
  // side's flag; any other right-hand side (literal, arithmetic,
  // concatenation) is a plain string. Only a plain "=" assignment
  // carries provenance; compound assignments produce numbers.
  const rhsIsStrnum = op === "=" && exprIsStrnum(ctx, expr.value);
  // An assignment used as a value carries its right-hand side's
  // provenance (review 6010326757); a compound assignment produces a
  // number and never is one. This is set again before returning:
  // evaluating the target below can overwrite the shared flag with a
  // nested assignment's provenance (review 6011335623).
  ctx.lastAssignmentIsStrnum = rhsIsStrnum;

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
    // Fields store strings, so a string value assigned to one is
    // only visible as numeric through the strnum flag; a number value
    // is recorded as a number by setField instead, and is not a
    // strnum (a compound assignment always produces a number).
    markStrnumField(ctx, index, rhsIsStrnum);
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

  // Re-assert this assignment's own provenance before returning:
  // evaluating the target (a field index or array key) can itself
  // contain a nested assignment, which overwrote the shared flag
  // with ITS right-hand side's provenance. An enclosing assignment
  // or function-argument read must see this assignment's flag, not
  // the target's (review 6011335623).
  ctx.lastAssignmentIsStrnum = rhsIsStrnum;

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
    // The field now holds a number, so a later copy of it sorts
    // numerically.
    markStrnumField(ctx, index, true);
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
    // A line read from input is a numeric string when it looks numeric.
    if (isAwkNumericString(nextLine)) markStrnumVar(ctx, variable, true);
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
    if (isAwkNumericString(line)) markStrnumVar(ctx, variable, true);
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
    if (isAwkNumericString(line)) markStrnumVar(ctx, variable, true);
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
