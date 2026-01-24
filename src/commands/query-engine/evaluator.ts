/**
 * Query expression evaluator
 *
 * Evaluates a parsed query AST against any value.
 * Used by jq, yq, and other query-based commands.
 */

import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { AstNode, DestructurePattern } from "./parser.js";

export type QueryValue = unknown;

class BreakError extends Error {
  constructor(
    public readonly label: string,
    public readonly partialResults: QueryValue[] = [],
  ) {
    super(`break ${label}`);
    this.name = "BreakError";
  }

  withPrependedResults(results: QueryValue[]): BreakError {
    return new BreakError(this.label, [...results, ...this.partialResults]);
  }
}

// Custom error that preserves the original jq value
class JqError extends Error {
  constructor(public readonly value: QueryValue) {
    super(typeof value === "string" ? value : JSON.stringify(value));
    this.name = "JqError";
  }
}

const DEFAULT_MAX_JQ_ITERATIONS = 10000;
// Depth limit for nested structures - must be low enough to avoid V8 stack overflow
// during JSON.stringify/parse which have their own recursion limits (~2000-10000 depending on V8 version)
const DEFAULT_MAX_JQ_DEPTH = 2000;

export interface QueryExecutionLimits {
  maxIterations?: number;
  maxDepth?: number;
}

/** Calculate the nesting depth of a value (array or object) */
function getValueDepth(value: QueryValue, maxCheck = 3000): number {
  let depth = 0;
  let current: QueryValue = value;
  while (depth < maxCheck) {
    if (Array.isArray(current)) {
      if (current.length === 0) return depth + 1;
      current = current[0];
      depth++;
    } else if (current !== null && typeof current === "object") {
      const keys = Object.keys(current);
      if (keys.length === 0) return depth + 1;
      current = (current as Record<string, unknown>)[keys[0]];
      depth++;
    } else {
      return depth;
    }
  }
  return depth;
}

export interface EvalContext {
  vars: Map<string, QueryValue>;
  limits: Required<Pick<QueryExecutionLimits, "maxIterations">> &
    QueryExecutionLimits;
  env?: Record<string, string | undefined>;
  /** Original document root for parent/root navigation */
  root?: QueryValue;
  /** Current path from root for parent navigation */
  currentPath?: (string | number)[];
  funcs?: Map<
    string,
    { params: string[]; body: AstNode; closure?: Map<string, unknown> }
  >;
  labels?: Set<string>;
}

function createContext(options?: EvaluateOptions): EvalContext {
  return {
    vars: new Map(),
    limits: {
      maxIterations:
        options?.limits?.maxIterations ?? DEFAULT_MAX_JQ_ITERATIONS,
      maxDepth: options?.limits?.maxDepth ?? DEFAULT_MAX_JQ_DEPTH,
    },
    env: options?.env,
  };
}

function withVar(
  ctx: EvalContext,
  name: string,
  value: QueryValue,
): EvalContext {
  const newVars = new Map(ctx.vars);
  newVars.set(name, value);
  return {
    vars: newVars,
    limits: ctx.limits,
    env: ctx.env,
    root: ctx.root,
    currentPath: ctx.currentPath,
    funcs: ctx.funcs,
    labels: ctx.labels,
  };
}

/**
 * Bind variables according to a destructuring pattern
 * Returns null if the pattern doesn't match the value
 */
function bindPattern(
  ctx: EvalContext,
  pattern: DestructurePattern,
  value: QueryValue,
): EvalContext | null {
  switch (pattern.type) {
    case "var":
      return withVar(ctx, pattern.name, value);

    case "array": {
      if (!Array.isArray(value)) return null;
      let newCtx = ctx;
      for (let i = 0; i < pattern.elements.length; i++) {
        const elem = pattern.elements[i];
        const elemValue = i < value.length ? value[i] : null;
        const result = bindPattern(newCtx, elem, elemValue);
        if (result === null) return null;
        newCtx = result;
      }
      return newCtx;
    }

    case "object": {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return null;
      }
      const obj = value as Record<string, unknown>;
      let newCtx = ctx;
      for (const field of pattern.fields) {
        // Get the key - could be a string or a computed expression
        let key: string;
        if (typeof field.key === "string") {
          key = field.key;
        } else {
          // Computed key - evaluate it
          const keyVals = evaluate(value, field.key, ctx);
          if (keyVals.length === 0) return null;
          key = String(keyVals[0]);
        }
        const fieldValue = key in obj ? obj[key] : null;
        // If keyVar is set (e.g., $b:[$c,$d]), also bind the key variable to the whole value
        if (field.keyVar) {
          newCtx = withVar(newCtx, field.keyVar, fieldValue);
        }
        const result = bindPattern(newCtx, field.pattern, fieldValue);
        if (result === null) return null;
        newCtx = result;
      }
      return newCtx;
    }
  }
}

function getValueAtPath(
  root: QueryValue,
  path: (string | number)[],
): QueryValue {
  let v = root;
  for (const key of path) {
    if (v && typeof v === "object") {
      v = (v as Record<string, unknown>)[key as string];
    } else {
      return undefined;
    }
  }
  return v;
}

/**
 * Extract a simple path from an AST node (e.g., .a.b.c -> ["a", "b", "c"])
 * Returns null if the AST is not a simple path expression.
 * Handles Pipe nodes with parent/root to track path adjustments.
 */
function extractPathFromAst(ast: AstNode): (string | number)[] | null {
  if (ast.type === "Identity") return [];
  if (ast.type === "Field") {
    const basePath = ast.base ? extractPathFromAst(ast.base) : [];
    if (basePath === null) return null;
    return [...basePath, ast.name];
  }
  if (ast.type === "Index" && ast.index.type === "Literal") {
    const basePath = ast.base ? extractPathFromAst(ast.base) : [];
    if (basePath === null) return null;
    const idx = ast.index.value;
    if (typeof idx === "number" || typeof idx === "string") {
      return [...basePath, idx];
    }
    return null;
  }
  // Handle Pipe nodes to track path through parent/root calls
  if (ast.type === "Pipe") {
    const leftPath = extractPathFromAst(ast.left);
    if (leftPath === null) return null;
    // Apply right side transformation to the path
    return applyPathTransform(leftPath, ast.right);
  }
  // Handle parent/root builtins for path adjustment
  if (ast.type === "Call") {
    if (ast.name === "parent") {
      // parent without context returns null (needs base path from pipe)
      return null;
    }
    if (ast.name === "root") {
      // root resets to document root
      return null;
    }
    // first without args is .[0], last without args is .[-1]
    if (ast.name === "first" && ast.args.length === 0) {
      return [0];
    }
    if (ast.name === "last" && ast.args.length === 0) {
      return [-1];
    }
  }
  // For other node types, we can't extract a simple path
  return null;
}

/**
 * Apply a path transformation (like parent or root) to a base path.
 */
function applyPathTransform(
  basePath: (string | number)[],
  ast: AstNode,
): (string | number)[] | null {
  if (ast.type === "Call") {
    if (ast.name === "parent") {
      // Get levels - default is 1, or extract from literal arg
      let levels = 1;
      if (ast.args.length > 0 && ast.args[0].type === "Literal") {
        const arg = ast.args[0].value;
        if (typeof arg === "number") levels = arg;
      }
      if (levels >= 0) {
        // Positive: go up n levels
        return basePath.slice(0, Math.max(0, basePath.length - levels));
      } else {
        // Negative: index from root (-1 = root, -2 = one below root)
        const targetLen = -levels - 1;
        return basePath.slice(0, Math.min(targetLen, basePath.length));
      }
    }
    if (ast.name === "root") {
      return [];
    }
  }
  // For Field/Index on right side, extend the path
  if (ast.type === "Field") {
    const rightPath = extractPathFromAst(ast);
    if (rightPath !== null) {
      return [...basePath, ...rightPath];
    }
  }
  if (ast.type === "Index" && ast.index.type === "Literal") {
    const rightPath = extractPathFromAst(ast);
    if (rightPath !== null) {
      return [...basePath, ...rightPath];
    }
  }
  // For nested pipes, recurse
  if (ast.type === "Pipe") {
    const afterLeft = applyPathTransform(basePath, ast.left);
    if (afterLeft === null) return null;
    return applyPathTransform(afterLeft, ast.right);
  }
  // Identity doesn't change path
  if (ast.type === "Identity") {
    return basePath;
  }
  // For other transformations, we lose path tracking
  return null;
}

export interface EvaluateOptions {
  limits?: QueryExecutionLimits;
  env?: Record<string, string | undefined>;
}

/**
 * Evaluate an expression and return partial results even if an error occurs.
 * Used for functions like isempty() that need to know if ANY value was produced.
 */
function evaluateWithPartialResults(
  value: QueryValue,
  ast: AstNode,
  ctx: EvalContext,
): QueryValue[] {
  // For comma expressions, try to get partial results
  if (ast.type === "Comma") {
    const results: QueryValue[] = [];
    try {
      results.push(...evaluate(value, ast.left, ctx));
    } catch (e) {
      // Always re-throw execution limit errors - they must not be suppressed
      if (e instanceof ExecutionLimitError) throw e;
      // Left side errored, check if we have any results
      if (results.length > 0) return results;
      throw new Error("evaluation failed");
    }
    try {
      results.push(...evaluate(value, ast.right, ctx));
    } catch (e) {
      // Always re-throw execution limit errors
      if (e instanceof ExecutionLimitError) throw e;
      // Right side errored, return what we have from left
      return results;
    }
    return results;
  }
  // For other expressions, use normal evaluation
  return evaluate(value, ast, ctx);
}

export function evaluate(
  value: QueryValue,
  ast: AstNode,
  ctxOrOptions?: EvalContext | EvaluateOptions,
): QueryValue[] {
  let ctx: EvalContext =
    ctxOrOptions && "vars" in ctxOrOptions
      ? ctxOrOptions
      : createContext(ctxOrOptions as EvaluateOptions | undefined);

  // Initialize root if not set (first evaluation)
  if (ctx.root === undefined) {
    ctx = { ...ctx, root: value, currentPath: [] };
  }

  switch (ast.type) {
    case "Identity":
      return [value];

    case "Field": {
      const bases = ast.base ? evaluate(value, ast.base, ctx) : [value];
      return bases.flatMap((v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          const result = (v as Record<string, unknown>)[ast.name];
          return [result === undefined ? null : result];
        }
        // jq: indexing null always returns null
        if (v === null) {
          return [null];
        }
        // jq throws an error when accessing a field on non-objects (arrays, numbers, strings, booleans)
        // This allows Try (.foo?) to catch it and return empty
        const typeName = Array.isArray(v) ? "array" : typeof v;
        throw new Error(`Cannot index ${typeName} with string "${ast.name}"`);
      });
    }

    case "Index": {
      const bases = ast.base ? evaluate(value, ast.base, ctx) : [value];
      return bases.flatMap((v) => {
        const indices = evaluate(v, ast.index, ctx);
        return indices.flatMap((idx) => {
          if (typeof idx === "number" && Array.isArray(v)) {
            // Handle NaN - return null for NaN index
            if (Number.isNaN(idx)) {
              return [null];
            }
            // Truncate float index to integer (jq behavior)
            const truncated = Math.trunc(idx);
            const i = truncated < 0 ? v.length + truncated : truncated;
            return i >= 0 && i < v.length ? [v[i]] : [null];
          }
          if (
            typeof idx === "string" &&
            v &&
            typeof v === "object" &&
            !Array.isArray(v)
          ) {
            return [(v as Record<string, unknown>)[idx]];
          }
          return [null];
        });
      });
    }

    case "Slice": {
      const bases = ast.base ? evaluate(value, ast.base, ctx) : [value];
      return bases.flatMap((v) => {
        // null can be sliced and returns null
        if (v === null) return [null];
        if (!Array.isArray(v) && typeof v !== "string") {
          throw new Error(`Cannot slice ${typeof v} (${JSON.stringify(v)})`);
        }
        const len = v.length;
        const starts = ast.start ? evaluate(value, ast.start, ctx) : [0];
        const ends = ast.end ? evaluate(value, ast.end, ctx) : [len];
        return starts.flatMap((s) =>
          ends.map((e) => {
            // jq uses floor for start and ceil for end (for fractional indices)
            // NaN in start position → 0, NaN in end position → length
            const sNum = s as number;
            const eNum = e as number;
            const startRaw = Number.isNaN(sNum)
              ? 0
              : Number.isInteger(sNum)
                ? sNum
                : Math.floor(sNum);
            const endRaw = Number.isNaN(eNum)
              ? len
              : Number.isInteger(eNum)
                ? eNum
                : Math.ceil(eNum);
            const start = normalizeIndex(startRaw, len);
            const end = normalizeIndex(endRaw, len);
            return Array.isArray(v) ? v.slice(start, end) : v.slice(start, end);
          }),
        );
      });
    }

    case "Iterate": {
      const bases = ast.base ? evaluate(value, ast.base, ctx) : [value];
      return bases.flatMap((v) => {
        if (Array.isArray(v)) return v;
        if (v && typeof v === "object") return Object.values(v);
        return [];
      });
    }

    case "Pipe": {
      const leftResults = evaluate(value, ast.left, ctx);
      const leftPath = extractPathFromAst(ast.left);
      const pipeResults: QueryValue[] = [];
      for (const v of leftResults) {
        try {
          if (leftPath !== null) {
            const newCtx = {
              ...ctx,
              currentPath: [...(ctx.currentPath ?? []), ...leftPath],
            };
            pipeResults.push(...evaluate(v, ast.right, newCtx));
          } else {
            pipeResults.push(...evaluate(v, ast.right, ctx));
          }
        } catch (e) {
          if (e instanceof BreakError) {
            throw e.withPrependedResults(pipeResults);
          }
          throw e;
        }
      }
      return pipeResults;
    }
    case "Comma": {
      const leftResults = evaluate(value, ast.left, ctx);
      const rightResults = evaluate(value, ast.right, ctx);
      return [...leftResults, ...rightResults];
    }

    case "Literal":
      return [ast.value];

    case "Array": {
      if (!ast.elements) return [[]];
      const elements = evaluate(value, ast.elements, ctx);
      return [elements];
    }

    case "Object": {
      const results: Record<string, unknown>[] = [{}];

      for (const entry of ast.entries) {
        const keys =
          typeof entry.key === "string"
            ? [entry.key]
            : evaluate(value, entry.key, ctx);
        const values = evaluate(value, entry.value, ctx);

        const newResults: Record<string, unknown>[] = [];
        for (const obj of results) {
          for (const k of keys) {
            // jq requires object keys to be strings
            if (typeof k !== "string") {
              const typeName =
                k === null ? "null" : Array.isArray(k) ? "array" : typeof k;
              throw new Error(
                `Cannot use ${typeName} (${JSON.stringify(k)}) as object key`,
              );
            }
            for (const v of values) {
              newResults.push({ ...obj, [k]: v });
            }
          }
        }
        results.length = 0;
        results.push(...newResults);
      }

      return results;
    }

    case "Paren":
      return evaluate(value, ast.expr, ctx);

    case "BinaryOp":
      return evalBinaryOp(value, ast.op, ast.left, ast.right, ctx);

    case "UnaryOp": {
      const operands = evaluate(value, ast.operand, ctx);
      return operands.map((v) => {
        if (ast.op === "-") {
          if (typeof v === "number") return -v;
          if (typeof v === "string") {
            // jq: strings cannot be negated - format truncates long strings
            // jq format: "string (\"truncated...) - no closing quote when truncated
            const formatStr = (s: string) =>
              s.length > 5 ? `"${s.slice(0, 3)}...` : JSON.stringify(s);
            throw new Error(`string (${formatStr(v)}) cannot be negated`);
          }
          return null;
        }
        if (ast.op === "not") return !isTruthy(v);
        return null;
      });
    }

    case "Cond": {
      const conds = evaluate(value, ast.cond, ctx);
      return conds.flatMap((c) => {
        if (isTruthy(c)) {
          return evaluate(value, ast.then, ctx);
        }
        for (const elif of ast.elifs) {
          const elifConds = evaluate(value, elif.cond, ctx);
          if (elifConds.some(isTruthy)) {
            return evaluate(value, elif.then, ctx);
          }
        }
        if (ast.else) {
          return evaluate(value, ast.else, ctx);
        }
        // jq: if no else clause and condition is false, return input unchanged
        return [value];
      });
    }

    case "Try": {
      try {
        return evaluate(value, ast.body, ctx);
      } catch (e) {
        if (ast.catch) {
          // jq: In catch handler, input is the error value (preserved if JqError)
          const errorVal =
            e instanceof JqError
              ? e.value
              : e instanceof Error
                ? e.message
                : String(e);
          return evaluate(errorVal, ast.catch, ctx);
        }
        return [];
      }
    }

    case "Call":
      return evalBuiltin(value, ast.name, ast.args, ctx);

    case "VarBind": {
      const values = evaluate(value, ast.value, ctx);
      return values.flatMap((v) => {
        let newCtx: EvalContext | null = null;

        // Build list of patterns to try: primary pattern + alternatives
        const patternsToTry: DestructurePattern[] = [];
        if (ast.pattern) {
          patternsToTry.push(ast.pattern);
        } else if (ast.name) {
          patternsToTry.push({ type: "var", name: ast.name });
        }
        if (ast.alternatives) {
          patternsToTry.push(...ast.alternatives);
        }

        // Try each pattern until one matches
        for (const pattern of patternsToTry) {
          newCtx = bindPattern(ctx, pattern, v);
          if (newCtx !== null) {
            break; // Pattern matched
          }
        }

        if (newCtx === null) {
          // No pattern matched - skip this value
          return [];
        }

        return evaluate(value, ast.body, newCtx);
      });
    }

    case "VarRef": {
      // Special case: $ENV returns environment variables
      // Note: ast.name includes the $ prefix (e.g., "$ENV")
      if (ast.name === "$ENV") {
        return [ctx.env ?? {}];
      }
      const v = ctx.vars.get(ast.name);
      return v !== undefined ? [v] : [null];
    }

    case "Recurse": {
      const results: QueryValue[] = [];
      const seen = new WeakSet<object>();
      const walk = (val: QueryValue) => {
        if (val && typeof val === "object") {
          if (seen.has(val as object)) return;
          seen.add(val as object);
        }
        results.push(val);
        if (Array.isArray(val)) {
          for (const item of val) walk(item);
        } else if (val && typeof val === "object") {
          for (const key of Object.keys(val)) {
            walk((val as Record<string, unknown>)[key]);
          }
        }
      };
      walk(value);
      return results;
    }

    case "Optional": {
      try {
        return evaluate(value, ast.expr, ctx);
      } catch {
        return [];
      }
    }

    case "StringInterp": {
      const parts = ast.parts.map((part) => {
        if (typeof part === "string") return part;
        const vals = evaluate(value, part, ctx);
        return vals
          .map((v) => (typeof v === "string" ? v : JSON.stringify(v)))
          .join("");
      });
      return [parts.join("")];
    }

    case "UpdateOp": {
      return [applyUpdate(value, ast.path, ast.op, ast.value, ctx)];
    }

    case "Reduce": {
      const items = evaluate(value, ast.expr, ctx);
      let accumulator = evaluate(value, ast.init, ctx)[0];
      const maxDepth = ctx.limits.maxDepth ?? DEFAULT_MAX_JQ_DEPTH;
      for (const item of items) {
        let newCtx: EvalContext | null;
        if (ast.pattern) {
          newCtx = bindPattern(ctx, ast.pattern, item);
          if (newCtx === null) continue; // Pattern doesn't match, skip
        } else {
          newCtx = withVar(ctx, ast.varName, item);
        }
        accumulator = evaluate(accumulator, ast.update, newCtx)[0];
        // Check depth limit to prevent stack overflow with deeply nested structures
        if (getValueDepth(accumulator, maxDepth + 1) > maxDepth) {
          return [null];
        }
      }
      return [accumulator];
    }

    case "Foreach": {
      const items = evaluate(value, ast.expr, ctx);
      let state = evaluate(value, ast.init, ctx)[0];
      const foreachResults: QueryValue[] = [];
      for (const item of items) {
        try {
          let newCtx: EvalContext | null;
          if (ast.pattern) {
            newCtx = bindPattern(ctx, ast.pattern, item);
            if (newCtx === null) continue; // Pattern doesn't match, skip
          } else {
            newCtx = withVar(ctx, ast.varName, item);
          }
          state = evaluate(state, ast.update, newCtx)[0];
          if (ast.extract) {
            const extracted = evaluate(state, ast.extract, newCtx);
            foreachResults.push(...extracted);
          } else {
            foreachResults.push(state);
          }
        } catch (e) {
          if (e instanceof BreakError) {
            throw e.withPrependedResults(foreachResults);
          }
          throw e;
        }
      }
      return foreachResults;
    }

    case "Label": {
      try {
        return evaluate(value, ast.body, {
          ...ctx,
          labels: new Set([...(ctx.labels ?? []), ast.name]),
        });
      } catch (e) {
        if (e instanceof BreakError && e.label === ast.name) {
          return e.partialResults;
        }
        throw e;
      }
    }

    case "Break": {
      throw new BreakError(ast.name);
    }

    case "Def": {
      // Register the function in context and evaluate the body
      // Functions are keyed by name/arity to allow overloading (e.g., def f: ...; def f(a): ...)
      // Store closure (current funcs map) for lexical scoping
      const newFuncs = new Map(ctx.funcs ?? []);
      const funcKey = `${ast.name}/${ast.params.length}`;
      // Capture the current funcs map as the closure for this function
      newFuncs.set(funcKey, {
        params: ast.params,
        body: ast.funcBody,
        closure: new Map(ctx.funcs ?? []),
      });
      const newCtx: EvalContext = { ...ctx, funcs: newFuncs };
      return evaluate(value, ast.body, newCtx);
    }

    default: {
      const _exhaustive: never = ast;
      throw new Error(
        `Unknown AST node type: ${(_exhaustive as AstNode).type}`,
      );
    }
  }
}

function normalizeIndex(idx: number, len: number): number {
  if (idx < 0) return Math.max(0, len + idx);
  return Math.min(idx, len);
}

function applyUpdate(
  root: QueryValue,
  pathExpr: AstNode,
  op: string,
  valueExpr: AstNode,
  ctx: EvalContext,
): QueryValue {
  function computeNewValue(
    current: QueryValue,
    newVal: QueryValue,
  ): QueryValue {
    switch (op) {
      case "=":
        return newVal;
      case "|=": {
        const results = evaluate(current, valueExpr, ctx);
        return results[0] ?? null;
      }
      case "+=":
        if (typeof current === "number" && typeof newVal === "number")
          return current + newVal;
        if (typeof current === "string" && typeof newVal === "string")
          return current + newVal;
        if (Array.isArray(current) && Array.isArray(newVal))
          return [...current, ...newVal];
        if (
          current &&
          newVal &&
          typeof current === "object" &&
          typeof newVal === "object"
        ) {
          return { ...current, ...newVal };
        }
        return newVal;
      case "-=":
        if (typeof current === "number" && typeof newVal === "number")
          return current - newVal;
        return current;
      case "*=":
        if (typeof current === "number" && typeof newVal === "number")
          return current * newVal;
        return current;
      case "/=":
        if (typeof current === "number" && typeof newVal === "number")
          return current / newVal;
        return current;
      case "%=":
        if (typeof current === "number" && typeof newVal === "number")
          return current % newVal;
        return current;
      case "//=":
        return current === null || current === false ? newVal : current;
      default:
        return newVal;
    }
  }

  function updateRecursive(
    val: QueryValue,
    path: AstNode,
    transform: (current: QueryValue) => QueryValue,
  ): QueryValue {
    switch (path.type) {
      case "Identity":
        return transform(val);

      case "Field": {
        if (path.base) {
          return updateRecursive(val, path.base, (baseVal) => {
            if (
              baseVal &&
              typeof baseVal === "object" &&
              !Array.isArray(baseVal)
            ) {
              const obj = { ...baseVal } as Record<string, unknown>;
              obj[path.name] = transform(obj[path.name]);
              return obj;
            }
            return baseVal;
          });
        }
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const obj = { ...val } as Record<string, unknown>;
          obj[path.name] = transform(obj[path.name]);
          return obj;
        }
        return val;
      }

      case "Index": {
        const indices = evaluate(root, path.index, ctx);
        let idx = indices[0];

        // Handle NaN index - throw error for assignment
        if (typeof idx === "number" && Number.isNaN(idx)) {
          throw new Error("Cannot set array element at NaN index");
        }

        // Truncate float index to integer for assignment
        if (typeof idx === "number" && !Number.isInteger(idx)) {
          idx = Math.trunc(idx);
        }

        if (path.base) {
          return updateRecursive(val, path.base, (baseVal) => {
            if (typeof idx === "number" && Array.isArray(baseVal)) {
              const arr = [...baseVal];
              const i = idx < 0 ? arr.length + idx : idx;
              if (i >= 0) {
                // Extend array if needed
                while (arr.length <= i) arr.push(null);
                arr[i] = transform(arr[i]);
              }
              return arr;
            }
            if (
              typeof idx === "string" &&
              baseVal &&
              typeof baseVal === "object" &&
              !Array.isArray(baseVal)
            ) {
              const obj = { ...baseVal } as Record<string, unknown>;
              obj[idx] = transform(obj[idx]);
              return obj;
            }
            return baseVal;
          });
        }

        if (typeof idx === "number") {
          // jq: Array index too large
          const MAX_ARRAY_INDEX = 536870911;
          if (idx > MAX_ARRAY_INDEX) {
            throw new Error("Array index too large");
          }
          // jq: Out of bounds negative array index when base is null/non-array
          if (idx < 0 && (!val || !Array.isArray(val))) {
            throw new Error("Out of bounds negative array index");
          }
          if (Array.isArray(val)) {
            const arr = [...val];
            const i = idx < 0 ? arr.length + idx : idx;
            if (i >= 0) {
              // Extend array if needed
              while (arr.length <= i) arr.push(null);
              arr[i] = transform(arr[i]);
            }
            return arr;
          }
          // Create array if val is null
          if (val === null || val === undefined) {
            const arr: QueryValue[] = [];
            while (arr.length <= idx) arr.push(null);
            arr[idx] = transform(null);
            return arr;
          }
          return val;
        }
        if (
          typeof idx === "string" &&
          val &&
          typeof val === "object" &&
          !Array.isArray(val)
        ) {
          const obj = { ...val } as Record<string, unknown>;
          obj[idx] = transform(obj[idx]);
          return obj;
        }
        return val;
      }

      case "Iterate": {
        const applyToContainer = (container: QueryValue): QueryValue => {
          if (Array.isArray(container)) {
            return container.map((item) => transform(item));
          }
          if (container && typeof container === "object") {
            const obj: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(container)) {
              obj[k] = transform(v);
            }
            return obj;
          }
          return container;
        };

        if (path.base) {
          return updateRecursive(val, path.base, applyToContainer);
        }
        return applyToContainer(val);
      }

      case "Pipe": {
        const leftResult = updateRecursive(val, path.left, (x) => x);
        return updateRecursive(leftResult, path.right, transform);
      }

      default:
        return transform(val);
    }
  }

  const transformer = (current: QueryValue): QueryValue => {
    if (op === "|=") {
      return computeNewValue(current, current);
    }
    const newVals = evaluate(root, valueExpr, ctx);
    return computeNewValue(current, newVals[0] ?? null);
  };

  return updateRecursive(root, pathExpr, transformer);
}

function applyDel(
  root: QueryValue,
  pathExpr: AstNode,
  ctx: EvalContext,
): QueryValue {
  // Helper to set a value at an AST path
  function setAtPath(
    obj: QueryValue,
    pathNode: AstNode,
    newVal: QueryValue,
  ): QueryValue {
    switch (pathNode.type) {
      case "Identity":
        return newVal;
      case "Field": {
        if (pathNode.base) {
          // Nested field: recurse into base
          const nested = evaluate(obj, pathNode.base, ctx)[0];
          const modified = setAtPath(
            nested,
            { type: "Field", name: pathNode.name },
            newVal,
          );
          return setAtPath(obj, pathNode.base, modified);
        }
        // Direct field
        if (obj && typeof obj === "object" && !Array.isArray(obj)) {
          return { ...obj, [pathNode.name]: newVal };
        }
        return obj;
      }
      case "Index": {
        if (pathNode.base) {
          // Nested index: recurse into base
          const nested = evaluate(obj, pathNode.base, ctx)[0];
          const modified = setAtPath(
            nested,
            { type: "Index", index: pathNode.index },
            newVal,
          );
          return setAtPath(obj, pathNode.base, modified);
        }
        // Direct index
        const indices = evaluate(root, pathNode.index, ctx);
        const idx = indices[0];
        if (typeof idx === "number" && Array.isArray(obj)) {
          const arr = [...obj];
          const i = idx < 0 ? arr.length + idx : idx;
          if (i >= 0 && i < arr.length) {
            arr[i] = newVal;
          }
          return arr;
        }
        if (
          typeof idx === "string" &&
          obj &&
          typeof obj === "object" &&
          !Array.isArray(obj)
        ) {
          return { ...obj, [idx]: newVal };
        }
        return obj;
      }
      default:
        return obj;
    }
  }

  function deleteAt(val: QueryValue, path: AstNode): QueryValue {
    switch (path.type) {
      case "Identity":
        return null;

      case "Field": {
        // If there's a base (nested field like .a.b), recurse
        if (path.base) {
          // Evaluate base to get the nested object
          const nested = evaluate(val, path.base, ctx)[0];
          if (nested === null || nested === undefined) {
            return val;
          }
          // Delete field from nested object
          const modified = deleteAt(nested, { type: "Field", name: path.name });
          // Set the modified value back at the base path
          return setAtPath(val, path.base, modified);
        }
        // Direct field deletion (no base)
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const obj = { ...val } as Record<string, unknown>;
          delete obj[path.name];
          return obj;
        }
        return val;
      }

      case "Index": {
        // If there's a base (nested index like .[0].a), recurse
        if (path.base) {
          // Evaluate base to get the nested object/array
          const nested = evaluate(val, path.base, ctx)[0];
          if (nested === null || nested === undefined) {
            return val;
          }
          // Delete at index from nested value
          const modified = deleteAt(nested, {
            type: "Index",
            index: path.index,
          });
          // Set the modified value back at the base path
          return setAtPath(val, path.base, modified);
        }

        const indices = evaluate(root, path.index, ctx);
        const idx = indices[0];

        if (typeof idx === "number" && Array.isArray(val)) {
          const arr = [...val];
          const i = idx < 0 ? arr.length + idx : idx;
          if (i >= 0 && i < arr.length) {
            arr.splice(i, 1);
          }
          return arr;
        }
        if (
          typeof idx === "string" &&
          val &&
          typeof val === "object" &&
          !Array.isArray(val)
        ) {
          const obj = { ...val } as Record<string, unknown>;
          delete obj[idx];
          return obj;
        }
        return val;
      }

      case "Iterate": {
        if (Array.isArray(val)) {
          return [];
        }
        if (val && typeof val === "object") {
          return {};
        }
        return val;
      }

      case "Pipe": {
        // For nested paths like .a.b, navigate to .a and delete .b within it
        const leftPath = path.left;
        const rightPath = path.right;

        // Helper to set a value at an AST path
        function setAt(
          obj: QueryValue,
          pathNode: AstNode,
          newVal: QueryValue,
        ): QueryValue {
          switch (pathNode.type) {
            case "Identity":
              return newVal;
            case "Field": {
              if (obj && typeof obj === "object" && !Array.isArray(obj)) {
                return { ...obj, [pathNode.name]: newVal };
              }
              return obj;
            }
            case "Index": {
              const indices = evaluate(root, pathNode.index, ctx);
              const idx = indices[0];
              if (typeof idx === "number" && Array.isArray(obj)) {
                const arr = [...obj];
                const i = idx < 0 ? arr.length + idx : idx;
                if (i >= 0 && i < arr.length) {
                  arr[i] = newVal;
                }
                return arr;
              }
              if (
                typeof idx === "string" &&
                obj &&
                typeof obj === "object" &&
                !Array.isArray(obj)
              ) {
                return { ...obj, [idx]: newVal };
              }
              return obj;
            }
            case "Pipe": {
              // Recurse: set at leftPath with the result of setting at rightPath
              const innerVal = evaluate(obj, pathNode.left, ctx)[0];
              const modified = setAt(innerVal, pathNode.right, newVal);
              return setAt(obj, pathNode.left, modified);
            }
            default:
              return obj;
          }
        }

        // Get the current value at the left path
        const nested = evaluate(val, leftPath, ctx)[0];
        if (nested === null || nested === undefined) {
          return val; // Nothing to delete
        }

        // Apply deletion on the nested value
        const modified = deleteAt(nested, rightPath);

        // Reconstruct the object with the modified nested value
        return setAt(val, leftPath, modified);
      }

      default:
        return val;
    }
  }

  return deleteAt(root, pathExpr);
}

function isTruthy(v: QueryValue): boolean {
  return v !== null && v !== false;
}

function evalBinaryOp(
  value: QueryValue,
  op: string,
  left: AstNode,
  right: AstNode,
  ctx: EvalContext,
): QueryValue[] {
  // Short-circuit for 'and' and 'or'
  if (op === "and") {
    const leftVals = evaluate(value, left, ctx);
    return leftVals.flatMap((l) => {
      if (!isTruthy(l)) return [false];
      const rightVals = evaluate(value, right, ctx);
      return rightVals.map((r) => isTruthy(r));
    });
  }

  if (op === "or") {
    const leftVals = evaluate(value, left, ctx);
    return leftVals.flatMap((l) => {
      if (isTruthy(l)) return [true];
      const rightVals = evaluate(value, right, ctx);
      return rightVals.map((r) => isTruthy(r));
    });
  }

  if (op === "//") {
    const leftVals = evaluate(value, left, ctx);
    const nonNull = leftVals.filter(
      (v) => v !== null && v !== undefined && v !== false,
    );
    if (nonNull.length > 0) return nonNull;
    return evaluate(value, right, ctx);
  }

  const leftVals = evaluate(value, left, ctx);
  const rightVals = evaluate(value, right, ctx);

  return leftVals.flatMap((l) =>
    rightVals.map((r) => {
      switch (op) {
        case "+":
          // jq: null + x = x, x + null = x
          if (l === null) return r;
          if (r === null) return l;
          if (typeof l === "number" && typeof r === "number") return l + r;
          if (typeof l === "string" && typeof r === "string") return l + r;
          if (Array.isArray(l) && Array.isArray(r)) return [...l, ...r];
          if (
            l &&
            r &&
            typeof l === "object" &&
            typeof r === "object" &&
            !Array.isArray(l) &&
            !Array.isArray(r)
          ) {
            return { ...l, ...r };
          }
          return null;
        case "-":
          if (typeof l === "number" && typeof r === "number") return l - r;
          if (Array.isArray(l) && Array.isArray(r)) {
            const rSet = new Set(r.map((x) => JSON.stringify(x)));
            return l.filter((x) => !rSet.has(JSON.stringify(x)));
          }
          if (typeof l === "string" && typeof r === "string") {
            // jq: strings cannot be subtracted - format truncates long strings
            // jq format: "string (\"truncated...) - no closing quote when truncated
            const formatStr = (s: string) =>
              s.length > 10 ? `"${s.slice(0, 10)}...` : JSON.stringify(s);
            throw new Error(
              `string (${formatStr(l)}) and string (${formatStr(r)}) cannot be subtracted`,
            );
          }
          return null;
        case "*":
          if (typeof l === "number" && typeof r === "number") return l * r;
          if (typeof l === "string" && typeof r === "number")
            return l.repeat(r);
          if (
            l &&
            r &&
            typeof l === "object" &&
            typeof r === "object" &&
            !Array.isArray(l) &&
            !Array.isArray(r)
          ) {
            return deepMerge(
              l as Record<string, unknown>,
              r as Record<string, unknown>,
            );
          }
          return null;
        case "/":
          if (typeof l === "number" && typeof r === "number") {
            if (r === 0) {
              throw new Error(
                `number (${l}) and number (${r}) cannot be divided because the divisor is zero`,
              );
            }
            return l / r;
          }
          if (typeof l === "string" && typeof r === "string") return l.split(r);
          return null;
        case "%":
          if (typeof l === "number" && typeof r === "number") {
            if (r === 0) {
              throw new Error(
                `number (${l}) and number (${r}) cannot be divided (remainder) because the divisor is zero`,
              );
            }
            // jq: special handling for infinity modulo (but not NaN)
            if (!Number.isFinite(l) && !Number.isNaN(l)) {
              if (!Number.isFinite(r) && !Number.isNaN(r)) {
                // -infinity % infinity = -1, others = 0
                return l < 0 && r > 0 ? -1 : 0;
              }
              // infinity % finite = 0
              return 0;
            }
            return l % r;
          }
          return null;
        case "==":
          return deepEqual(l, r);
        case "!=":
          return !deepEqual(l, r);
        case "<":
          return compare(l, r) < 0;
        case "<=":
          return compare(l, r) <= 0;
        case ">":
          return compare(l, r) > 0;
        case ">=":
          return compare(l, r) >= 0;
        default:
          return null;
      }
    }),
  );
}

function deepEqual(a: QueryValue, b: QueryValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compare(a: QueryValue, b: QueryValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return 0;
}

function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...a };
  for (const key of Object.keys(b)) {
    if (
      key in result &&
      result[key] &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key]) &&
      b[key] &&
      typeof b[key] === "object" &&
      !Array.isArray(b[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        b[key] as Record<string, unknown>,
      );
    } else {
      result[key] = b[key];
    }
  }
  return result;
}

// ============================================================================
// Builtins
// ============================================================================

function evalBuiltin(
  value: QueryValue,
  name: string,
  args: AstNode[],
  ctx: EvalContext,
): QueryValue[] {
  switch (name) {
    case "keys":
      if (Array.isArray(value)) return [value.map((_, i) => i)];
      if (value && typeof value === "object")
        return [Object.keys(value).sort()];
      return [null];

    case "keys_unsorted":
      if (Array.isArray(value)) return [value.map((_, i) => i)];
      if (value && typeof value === "object") return [Object.keys(value)];
      return [null];

    case "values":
      // jq: values outputs input if not null, nothing otherwise
      if (value === null) return [];
      return [value];

    case "length":
      if (typeof value === "string") return [value.length];
      if (Array.isArray(value)) return [value.length];
      if (value && typeof value === "object")
        return [Object.keys(value).length];
      if (value === null) return [0];
      // jq: length of a number is its absolute value
      if (typeof value === "number") return [Math.abs(value)];
      return [null];

    case "utf8bytelength": {
      if (typeof value === "string")
        return [new TextEncoder().encode(value).length];
      // jq: throws error for non-strings with type info
      const typeName =
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      const valueStr =
        typeName === "array" || typeName === "object"
          ? JSON.stringify(value)
          : String(value);
      throw new Error(
        `${typeName} (${valueStr}) only strings have UTF-8 byte length`,
      );
    }

    case "type":
      if (value === null) return ["null"];
      if (Array.isArray(value)) return ["array"];
      if (typeof value === "boolean") return ["boolean"];
      if (typeof value === "number") return ["number"];
      if (typeof value === "string") return ["string"];
      if (typeof value === "object") return ["object"];
      return ["null"];

    case "builtins":
      // Return list of all builtin functions with arity
      return [
        [
          "add/0",
          "all/0",
          "all/1",
          "all/2",
          "any/0",
          "any/1",
          "any/2",
          "arrays/0",
          "ascii/0",
          "ascii_downcase/0",
          "ascii_upcase/0",
          "booleans/0",
          "bsearch/1",
          "builtins/0",
          "combinations/0",
          "combinations/1",
          "contains/1",
          "debug/0",
          "del/1",
          "delpaths/1",
          "empty/0",
          "env/0",
          "error/0",
          "error/1",
          "explode/0",
          "first/0",
          "first/1",
          "flatten/0",
          "flatten/1",
          "floor/0",
          "from_entries/0",
          "fromdate/0",
          "fromjson/0",
          "getpath/1",
          "gmtime/0",
          "group_by/1",
          "gsub/2",
          "gsub/3",
          "has/1",
          "implode/0",
          "IN/1",
          "IN/2",
          "INDEX/1",
          "INDEX/2",
          "index/1",
          "indices/1",
          "infinite/0",
          "inside/1",
          "isempty/1",
          "isnan/0",
          "isnormal/0",
          "isvalid/1",
          "iterables/0",
          "join/1",
          "keys/0",
          "keys_unsorted/0",
          "last/0",
          "last/1",
          "length/0",
          "limit/2",
          "ltrimstr/1",
          "map/1",
          "map_values/1",
          "match/1",
          "match/2",
          "max/0",
          "max_by/1",
          "min/0",
          "min_by/1",
          "mktime/0",
          "modulemeta/1",
          "nan/0",
          "not/0",
          "nth/1",
          "nth/2",
          "null/0",
          "nulls/0",
          "numbers/0",
          "objects/0",
          "path/1",
          "paths/0",
          "paths/1",
          "pick/1",
          "range/1",
          "range/2",
          "range/3",
          "recurse/0",
          "recurse/1",
          "recurse_down/0",
          "repeat/1",
          "reverse/0",
          "rindex/1",
          "rtrimstr/1",
          "scalars/0",
          "scan/1",
          "scan/2",
          "select/1",
          "setpath/2",
          "skip/2",
          "sort/0",
          "sort_by/1",
          "split/1",
          "splits/1",
          "splits/2",
          "sqrt/0",
          "startswith/1",
          "strftime/1",
          "strings/0",
          "strptime/1",
          "sub/2",
          "sub/3",
          "test/1",
          "test/2",
          "to_entries/0",
          "toboolean/0",
          "todate/0",
          "tojson/0",
          "tostream/0",
          "fromstream/1",
          "truncate_stream/1",
          "tonumber/0",
          "tostring/0",
          "transpose/0",
          "trim/0",
          "ltrim/0",
          "rtrim/0",
          "type/0",
          "unique/0",
          "unique_by/1",
          "until/2",
          "utf8bytelength/0",
          "values/0",
          "walk/1",
          "while/2",
          "with_entries/1",
        ],
      ];

    case "empty":
      return [];

    case "error": {
      const msg = args.length > 0 ? evaluate(value, args[0], ctx)[0] : value;
      throw new JqError(msg);
    }

    case "not": {
      const result = !isTruthy(value);
      return [result];
    }

    case "null":
      return [null];

    case "true":
      return [true];

    case "false":
      return [false];

    case "first":
      if (args.length > 0) {
        // Use lazy evaluation - get first value without evaluating rest
        try {
          const results = evaluateWithPartialResults(value, args[0], ctx);
          return results.length > 0 ? [results[0]] : [];
        } catch (e) {
          // Always re-throw execution limit errors
          if (e instanceof ExecutionLimitError) throw e;
          return [];
        }
      }
      if (Array.isArray(value) && value.length > 0) return [value[0]];
      return [null];

    case "last":
      if (args.length > 0) {
        const results = evaluate(value, args[0], ctx);
        return results.length > 0 ? [results[results.length - 1]] : [];
      }
      if (Array.isArray(value) && value.length > 0)
        return [value[value.length - 1]];
      return [null];

    case "nth": {
      if (args.length < 1) return [null];
      const ns = evaluate(value, args[0], ctx);
      // Handle generator args - each n produces its own output
      if (args.length > 1) {
        // Check for negative indices first
        for (const nv of ns) {
          const n = nv as number;
          if (n < 0) {
            throw new Error("nth doesn't support negative indices");
          }
        }
        // Use lazy evaluation to get partial results before errors
        let results: QueryValue[];
        try {
          results = evaluateWithPartialResults(value, args[1], ctx);
        } catch (e) {
          // Always re-throw execution limit errors
          if (e instanceof ExecutionLimitError) throw e;
          results = [];
        }
        return ns.flatMap((nv) => {
          const n = nv as number;
          return n < results.length ? [results[n]] : [];
        });
      }
      if (Array.isArray(value)) {
        return ns.flatMap((nv) => {
          const n = nv as number;
          if (n < 0) {
            throw new Error("nth doesn't support negative indices");
          }
          return n < value.length ? [value[n]] : [null];
        });
      }
      return [null];
    }

    case "range": {
      if (args.length === 0) return [];
      const startsVals = evaluate(value, args[0], ctx);
      if (args.length === 1) {
        // range(n) - single arg, range from 0 to n
        // Handle generator args - each value produces its own range
        const result: number[] = [];
        for (const n of startsVals) {
          const num = n as number;
          for (let i = 0; i < num; i++) result.push(i);
        }
        return result;
      }
      const endsVals = evaluate(value, args[1], ctx);
      if (args.length === 2) {
        // range(start;end) - two args, range from start to end, step=1
        // But jq allows generators, so we need to handle multiple values
        const result: number[] = [];
        for (const s of startsVals) {
          for (const e of endsVals) {
            const start = s as number;
            const end = e as number;
            for (let i = start; i < end; i++) result.push(i);
          }
        }
        return result;
      }
      // range(start;end;step) - three args with step
      const stepsVals = evaluate(value, args[2], ctx);
      const result: number[] = [];
      for (const s of startsVals) {
        for (const e of endsVals) {
          for (const st of stepsVals) {
            const start = s as number;
            const end = e as number;
            const step = st as number;
            if (step === 0) continue; // Avoid infinite loop
            if (step > 0) {
              for (let i = start; i < end; i += step) result.push(i);
            } else {
              for (let i = start; i > end; i += step) result.push(i);
            }
          }
        }
      }
      return result;
    }

    case "reverse":
      if (Array.isArray(value)) return [[...value].reverse()];
      if (typeof value === "string")
        return [value.split("").reverse().join("")];
      return [null];

    case "sort":
      if (Array.isArray(value)) return [[...value].sort(compareJq)];
      return [null];

    case "sort_by": {
      if (!Array.isArray(value) || args.length === 0) return [null];
      const sorted = [...value].sort((a, b) => {
        const aKey = evaluate(a, args[0], ctx)[0];
        const bKey = evaluate(b, args[0], ctx)[0];
        return compareJq(aKey, bKey);
      });
      return [sorted];
    }

    case "bsearch": {
      if (!Array.isArray(value)) {
        const typeName =
          value === null
            ? "null"
            : typeof value === "object"
              ? "object"
              : typeof value;
        throw new Error(
          `${typeName} (${JSON.stringify(value)}) cannot be searched from`,
        );
      }
      if (args.length === 0) return [null];
      const targets = evaluate(value, args[0], ctx);
      // Handle generator args - each target produces its own search result
      return targets.map((target) => {
        // Binary search: return index if found, or -insertionPoint-1 if not
        let lo = 0;
        let hi = value.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          const cmp = compareJq(value[mid], target);
          if (cmp < 0) {
            lo = mid + 1;
          } else {
            hi = mid;
          }
        }
        // Check if we found an exact match
        if (lo < value.length && compareJq(value[lo], target) === 0) {
          return lo;
        }
        // Not found: return negative insertion point
        return -lo - 1;
      });
    }

    case "unique":
      if (Array.isArray(value)) {
        const seen = new Set<string>();
        const result: QueryValue[] = [];
        for (const item of value) {
          const key = JSON.stringify(item);
          if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
          }
        }
        return [result];
      }
      return [null];

    case "unique_by": {
      if (!Array.isArray(value) || args.length === 0) return [null];
      const seen = new Map<string, { item: QueryValue; key: QueryValue }>();
      for (const item of value) {
        const keyVal = evaluate(item, args[0], ctx)[0];
        const keyStr = JSON.stringify(keyVal);
        if (!seen.has(keyStr)) {
          seen.set(keyStr, { item, key: keyVal });
        }
      }
      // Sort by key value and return items
      const entries = [...seen.values()];
      entries.sort((a, b) => compareJq(a.key, b.key));
      return [entries.map((e) => e.item)];
    }

    case "group_by": {
      if (!Array.isArray(value) || args.length === 0) return [null];
      const groups = new Map<string, QueryValue[]>();
      for (const item of value) {
        const key = JSON.stringify(evaluate(item, args[0], ctx)[0]);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key)?.push(item);
      }
      return [[...groups.values()]];
    }

    case "max":
      if (Array.isArray(value) && value.length > 0) {
        return [value.reduce((a, b) => (compareJq(a, b) > 0 ? a : b))];
      }
      return [null];

    case "max_by": {
      if (!Array.isArray(value) || value.length === 0 || args.length === 0)
        return [null];
      return [
        value.reduce((a, b) => {
          const aKey = evaluate(a, args[0], ctx)[0];
          const bKey = evaluate(b, args[0], ctx)[0];
          return compareJq(aKey, bKey) > 0 ? a : b;
        }),
      ];
    }

    case "min":
      if (Array.isArray(value) && value.length > 0) {
        return [value.reduce((a, b) => (compareJq(a, b) < 0 ? a : b))];
      }
      return [null];

    case "min_by": {
      if (!Array.isArray(value) || value.length === 0 || args.length === 0)
        return [null];
      return [
        value.reduce((a, b) => {
          const aKey = evaluate(a, args[0], ctx)[0];
          const bKey = evaluate(b, args[0], ctx)[0];
          return compareJq(aKey, bKey) < 0 ? a : b;
        }),
      ];
    }

    case "flatten": {
      if (!Array.isArray(value)) return [null];
      const depths =
        args.length > 0
          ? evaluate(value, args[0], ctx)
          : [Number.POSITIVE_INFINITY];
      // Handle generator args - each depth produces its own output
      return depths.map((d) => {
        const depth = d as number;
        if (depth < 0) {
          throw new Error("flatten depth must not be negative");
        }
        return value.flat(depth);
      });
    }

    case "add": {
      // Helper to add an array of values
      const addValues = (arr: QueryValue[]): QueryValue => {
        // jq filters out null values for add
        const filtered = arr.filter((x) => x !== null);
        if (filtered.length === 0) return null;
        if (filtered.every((x) => typeof x === "number")) {
          return filtered.reduce((a, b) => (a as number) + (b as number), 0);
        }
        if (filtered.every((x) => typeof x === "string")) {
          return filtered.join("");
        }
        if (filtered.every((x) => Array.isArray(x))) {
          return filtered.flat();
        }
        if (
          filtered.every((x) => x && typeof x === "object" && !Array.isArray(x))
        ) {
          return Object.assign({}, ...filtered);
        }
        return null;
      };

      // Handle add(expr) - collect values from generator and add them
      if (args.length >= 1) {
        const collected = evaluate(value, args[0], ctx);
        return [addValues(collected)];
      }
      // Existing behavior for add (no args) - add array elements
      if (Array.isArray(value)) {
        return [addValues(value)];
      }
      return [null];
    }

    case "any": {
      if (args.length >= 2) {
        // any(generator; condition) - lazy evaluation with short-circuit
        // Evaluate generator lazily, return true if any passes condition
        try {
          const genValues = evaluateWithPartialResults(value, args[0], ctx);
          for (const v of genValues) {
            const cond = evaluate(v, args[1], ctx);
            if (cond.some(isTruthy)) return [true];
          }
        } catch (e) {
          // Always re-throw execution limit errors
          if (e instanceof ExecutionLimitError) throw e;
          // Error occurred but we might have found a truthy value already
        }
        return [false];
      }
      if (args.length === 1) {
        if (Array.isArray(value)) {
          return [
            value.some((item) => isTruthy(evaluate(item, args[0], ctx)[0])),
          ];
        }
        return [false];
      }
      if (Array.isArray(value)) return [value.some(isTruthy)];
      return [false];
    }

    case "all": {
      if (args.length >= 2) {
        // all(generator; condition) - lazy evaluation with short-circuit
        // Evaluate generator lazily, return false if any fails condition
        try {
          const genValues = evaluateWithPartialResults(value, args[0], ctx);
          for (const v of genValues) {
            const cond = evaluate(v, args[1], ctx);
            if (!cond.some(isTruthy)) return [false];
          }
        } catch (e) {
          // Always re-throw execution limit errors
          if (e instanceof ExecutionLimitError) throw e;
          // Error occurred but we might have found a falsy value already
        }
        return [true];
      }
      if (args.length === 1) {
        if (Array.isArray(value)) {
          return [
            value.every((item) => isTruthy(evaluate(item, args[0], ctx)[0])),
          ];
        }
        return [true];
      }
      if (Array.isArray(value)) return [value.every(isTruthy)];
      return [true];
    }

    case "select": {
      if (args.length === 0) return [value];
      const conds = evaluate(value, args[0], ctx);
      return conds.some(isTruthy) ? [value] : [];
    }

    case "map": {
      if (args.length === 0 || !Array.isArray(value)) return [null];
      const results = value.flatMap((item) => evaluate(item, args[0], ctx));
      return [results];
    }

    case "map_values": {
      if (args.length === 0) return [null];
      if (Array.isArray(value)) {
        return [value.flatMap((item) => evaluate(item, args[0], ctx))];
      }
      if (value && typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
          const mapped = evaluate(v, args[0], ctx);
          if (mapped.length > 0) result[k] = mapped[0];
        }
        return [result];
      }
      return [null];
    }

    case "has": {
      if (args.length === 0) return [false];
      const keys = evaluate(value, args[0], ctx);
      const key = keys[0];
      if (Array.isArray(value) && typeof key === "number") {
        return [key >= 0 && key < value.length];
      }
      if (value && typeof value === "object" && typeof key === "string") {
        return [key in value];
      }
      return [false];
    }

    case "in": {
      if (args.length === 0) return [false];
      const objs = evaluate(value, args[0], ctx);
      const obj = objs[0];
      if (Array.isArray(obj) && typeof value === "number") {
        return [value >= 0 && value < obj.length];
      }
      if (obj && typeof obj === "object" && typeof value === "string") {
        return [value in obj];
      }
      return [false];
    }

    case "contains": {
      if (args.length === 0) return [false];
      const others = evaluate(value, args[0], ctx);
      return [containsDeep(value, others[0])];
    }

    case "inside": {
      if (args.length === 0) return [false];
      const others = evaluate(value, args[0], ctx);
      return [containsDeep(others[0], value)];
    }

    case "getpath": {
      if (args.length === 0) return [null];
      const paths = evaluate(value, args[0], ctx);
      // Handle multiple paths (generator argument)
      const results: QueryValue[] = [];
      for (const pathVal of paths) {
        const path = pathVal as (string | number)[];
        let current: QueryValue = value;
        for (const key of path) {
          if (current === null || current === undefined) {
            current = null;
            break;
          }
          if (Array.isArray(current) && typeof key === "number") {
            current = current[key];
          } else if (typeof current === "object" && typeof key === "string") {
            current = (current as Record<string, unknown>)[key];
          } else {
            current = null;
            break;
          }
        }
        results.push(current);
      }
      return results;
    }

    case "setpath": {
      if (args.length < 2) return [null];
      const paths = evaluate(value, args[0], ctx);
      const path = paths[0] as (string | number)[];
      const vals = evaluate(value, args[1], ctx);
      const newVal = vals[0];
      return [setPath(value, path, newVal)];
    }

    case "delpaths": {
      if (args.length === 0) return [value];
      const pathLists = evaluate(value, args[0], ctx);
      const paths = pathLists[0] as (string | number)[][];
      let result = value;
      for (const path of paths.sort((a, b) => b.length - a.length)) {
        result = deletePath(result, path);
      }
      return [result];
    }

    case "path": {
      if (args.length === 0) return [[]];
      const paths: (string | number)[][] = [];
      collectPaths(value, args[0], ctx, [], paths);
      return paths;
    }

    case "del": {
      if (args.length === 0) return [value];
      return [applyDel(value, args[0], ctx)];
    }

    case "pick": {
      if (args.length === 0) return [null];
      // pick uses path() to get paths, then builds an object with just those paths
      // Collect paths from each argument
      const allPaths: (string | number)[][] = [];
      for (const arg of args) {
        collectPaths(value, arg, ctx, [], allPaths);
      }
      // Build result object with only the picked paths
      let result: QueryValue = null;
      for (const path of allPaths) {
        // Check for negative indices which are not allowed
        for (const key of path) {
          if (typeof key === "number" && key < 0) {
            throw new Error("Out of bounds negative array index");
          }
        }
        // Get the value at this path from the input
        let current: QueryValue = value;
        for (const key of path) {
          if (current === null || current === undefined) break;
          if (Array.isArray(current) && typeof key === "number") {
            current = current[key];
          } else if (typeof current === "object" && typeof key === "string") {
            current = (current as Record<string, unknown>)[key];
          } else {
            current = null;
            break;
          }
        }
        // Set the value in the result
        result = setPath(result, path, current);
      }
      return [result];
    }

    case "paths": {
      const paths: (string | number)[][] = [];
      const walk = (v: QueryValue, path: (string | number)[]) => {
        if (v && typeof v === "object") {
          if (Array.isArray(v)) {
            for (let i = 0; i < v.length; i++) {
              paths.push([...path, i]);
              walk(v[i], [...path, i]);
            }
          } else {
            for (const key of Object.keys(v)) {
              paths.push([...path, key]);
              walk((v as Record<string, unknown>)[key], [...path, key]);
            }
          }
        }
      };
      walk(value, []);
      if (args.length > 0) {
        return paths.filter((p) => {
          let v: QueryValue = value;
          for (const k of p) {
            if (Array.isArray(v) && typeof k === "number") {
              v = v[k];
            } else if (v && typeof v === "object" && typeof k === "string") {
              v = (v as Record<string, unknown>)[k];
            } else {
              return false;
            }
          }
          const results = evaluate(v, args[0], ctx);
          return results.some(isTruthy);
        });
      }
      return paths;
    }

    case "leaf_paths": {
      const paths: (string | number)[][] = [];
      const walk = (v: QueryValue, path: (string | number)[]) => {
        if (v === null || typeof v !== "object") {
          paths.push(path);
        } else if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            walk(v[i], [...path, i]);
          }
        } else {
          for (const key of Object.keys(v)) {
            walk((v as Record<string, unknown>)[key], [...path, key]);
          }
        }
      };
      walk(value, []);
      // Return each path as a separate output (like paths does)
      return paths;
    }

    case "tostream": {
      // tostream outputs [path, leaf_value] pairs for each leaf, plus [[]] at end
      const results: QueryValue[] = [];
      const walk = (v: QueryValue, path: (string | number)[]) => {
        if (v === null || typeof v !== "object") {
          // Leaf value - output [path, value]
          results.push([path, v]);
        } else if (Array.isArray(v)) {
          if (v.length === 0) {
            // Empty array - output [path, []]
            results.push([path, []]);
          } else {
            for (let i = 0; i < v.length; i++) {
              walk(v[i], [...path, i]);
            }
          }
        } else {
          const keys = Object.keys(v);
          if (keys.length === 0) {
            // Empty object - output [path, {}]
            results.push([path, {}]);
          } else {
            for (const key of keys) {
              walk((v as Record<string, unknown>)[key], [...path, key]);
            }
          }
        }
      };
      walk(value, []);
      // End marker: [[]] (empty path array wrapped in array)
      results.push([[]]);
      return results;
    }

    case "fromstream": {
      // fromstream(stream_expr) reconstructs values from stream of [path, value] pairs
      if (args.length === 0) return [value];
      const streamItems = evaluate(value, args[0], ctx);
      let result: QueryValue = null;

      for (const item of streamItems) {
        if (!Array.isArray(item)) continue;
        if (
          item.length === 1 &&
          Array.isArray(item[0]) &&
          item[0].length === 0
        ) {
          // End marker [[]] - skip
          continue;
        }
        if (item.length !== 2) continue;
        const [path, val] = item;
        if (!Array.isArray(path)) continue;

        // Set value at path, creating structure as needed
        if (path.length === 0) {
          result = val;
          continue;
        }

        // Auto-create root structure based on first path element
        if (result === null) {
          result = typeof path[0] === "number" ? [] : {};
        }

        // Navigate to parent and set value
        let current: QueryValue = result;
        for (let i = 0; i < path.length - 1; i++) {
          const key = path[i];
          const nextKey = path[i + 1];
          if (Array.isArray(current) && typeof key === "number") {
            // Extend array if needed
            while (current.length <= key) {
              current.push(null);
            }
            if (current[key] === null) {
              current[key] = typeof nextKey === "number" ? [] : {};
            }
            current = current[key];
          } else if (
            current &&
            typeof current === "object" &&
            !Array.isArray(current)
          ) {
            const obj = current as Record<string, unknown>;
            if (obj[String(key)] === null || obj[String(key)] === undefined) {
              obj[String(key)] = typeof nextKey === "number" ? [] : {};
            }
            current = obj[String(key)] as QueryValue;
          }
        }

        // Set the final value
        const lastKey = path[path.length - 1];
        if (Array.isArray(current) && typeof lastKey === "number") {
          while (current.length <= lastKey) {
            current.push(null);
          }
          current[lastKey] = val;
        } else if (
          current &&
          typeof current === "object" &&
          !Array.isArray(current)
        ) {
          (current as Record<string, unknown>)[String(lastKey)] = val;
        }
      }

      return [result];
    }

    case "truncate_stream": {
      // truncate_stream(stream_items) truncates paths by removing first n elements
      // where n is the input value (depth)
      const depth = typeof value === "number" ? Math.floor(value) : 0;
      if (args.length === 0) return [];

      const results: QueryValue[] = [];
      const streamItems = evaluate(value, args[0], ctx);

      for (const item of streamItems) {
        if (!Array.isArray(item)) continue;

        // Handle end markers [[path]] (length 1, first element is array)
        if (item.length === 1 && Array.isArray(item[0])) {
          const path = item[0] as (string | number)[];
          if (path.length > depth) {
            // Truncate the path
            results.push([path.slice(depth)]);
          }
          // If path.length <= depth, skip (becomes root end marker)
          continue;
        }

        // Handle value items [[path], value] (length 2)
        if (item.length === 2 && Array.isArray(item[0])) {
          const path = item[0] as (string | number)[];
          const val = item[1];
          if (path.length > depth) {
            // Truncate the path
            results.push([path.slice(depth), val]);
          }
          // If path.length <= depth, skip
        }
      }

      return results;
    }

    case "to_entries":
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return [
          Object.entries(value as Record<string, unknown>).map(
            ([key, val]) => ({ key, value: val }),
          ),
        ];
      }
      return [null];

    case "from_entries":
      if (Array.isArray(value)) {
        const result: Record<string, unknown> = {};
        for (const item of value) {
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            // jq supports: key, Key, name, Name, k for the key
            const key = obj.key ?? obj.Key ?? obj.name ?? obj.Name ?? obj.k;
            // jq supports: value, Value, v for the value
            const val = obj.value ?? obj.Value ?? obj.v;
            if (key !== undefined) result[String(key)] = val;
          }
        }
        return [result];
      }
      return [null];

    case "with_entries": {
      if (args.length === 0) return [value];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>).map(
          ([key, val]) => ({
            key,
            value: val,
          }),
        );
        const mapped = entries.flatMap((e) => evaluate(e, args[0], ctx));
        const result: Record<string, unknown> = {};
        for (const item of mapped) {
          if (item && typeof item === "object") {
            const obj = item as Record<string, unknown>;
            const key = obj.key ?? obj.name ?? obj.k;
            const val = obj.value ?? obj.v;
            if (key !== undefined) result[String(key)] = val;
          }
        }
        return [result];
      }
      return [null];
    }

    case "join": {
      if (!Array.isArray(value)) return [null];
      const seps = args.length > 0 ? evaluate(value, args[0], ctx) : [""];
      // jq: null values become empty strings, others get stringified
      // Also check for arrays/objects which should error
      for (const x of value) {
        if (Array.isArray(x) || (x !== null && typeof x === "object")) {
          throw new Error("cannot join: contains arrays or objects");
        }
      }
      // Handle generator args - each separator produces its own output
      return seps.map((sep) =>
        value
          .map((x) => (x === null ? "" : typeof x === "string" ? x : String(x)))
          .join(String(sep)),
      );
    }

    case "split": {
      if (typeof value !== "string" || args.length === 0) return [null];
      const seps = evaluate(value, args[0], ctx);
      const sep = String(seps[0]);
      return [value.split(sep)];
    }

    case "splits": {
      // Split string by regex, return each part as separate output
      if (typeof value !== "string" || args.length === 0) return [];
      const patterns = evaluate(value, args[0], ctx);
      const pattern = String(patterns[0]);
      try {
        const flags =
          args.length > 1 ? String(evaluate(value, args[1], ctx)[0]) : "g";
        // Ensure global flag is set for split
        const regex = new RegExp(
          pattern,
          flags.includes("g") ? flags : `${flags}g`,
        );
        return value.split(regex);
      } catch {
        return [];
      }
    }

    case "scan": {
      // Find all regex matches in string
      if (typeof value !== "string" || args.length === 0) return [];
      const patterns = evaluate(value, args[0], ctx);
      const pattern = String(patterns[0]);
      try {
        const flags =
          args.length > 1 ? String(evaluate(value, args[1], ctx)[0]) : "";
        // Ensure global flag is set for matchAll
        const regex = new RegExp(
          pattern,
          flags.includes("g") ? flags : `${flags}g`,
        );
        const matches = [...value.matchAll(regex)];
        // Return each match - if groups exist, return array of groups, else return match string
        return matches.map((m) => {
          if (m.length > 1) {
            // Has capture groups - return array of captured groups (excluding full match)
            return m.slice(1);
          }
          // No capture groups - return full match string
          return m[0];
        });
      } catch {
        return [];
      }
    }

    case "test": {
      if (typeof value !== "string" || args.length === 0) return [false];
      const patterns = evaluate(value, args[0], ctx);
      const pattern = String(patterns[0]);
      try {
        const flags =
          args.length > 1 ? String(evaluate(value, args[1], ctx)[0]) : "";
        return [new RegExp(pattern, flags).test(value)];
      } catch {
        return [false];
      }
    }

    case "match": {
      if (typeof value !== "string" || args.length === 0) return [null];
      const patterns = evaluate(value, args[0], ctx);
      const pattern = String(patterns[0]);
      try {
        const flags =
          args.length > 1 ? String(evaluate(value, args[1], ctx)[0]) : "";
        const re = new RegExp(pattern, `${flags}d`);
        const m = re.exec(value);
        if (!m) return [];
        const indices = (
          m as RegExpExecArray & { indices?: [number, number][] }
        ).indices;
        return [
          {
            offset: m.index,
            length: m[0].length,
            string: m[0],
            captures: m.slice(1).map((c, i) => {
              const captureIndices = indices?.[i + 1];
              return {
                offset: captureIndices?.[0] ?? null,
                length: c?.length ?? 0,
                string: c ?? "",
                name: null,
              };
            }),
          },
        ];
      } catch {
        return [null];
      }
    }

    case "capture": {
      if (typeof value !== "string" || args.length === 0) return [null];
      const patterns = evaluate(value, args[0], ctx);
      const pattern = String(patterns[0]);
      try {
        const flags =
          args.length > 1 ? String(evaluate(value, args[1], ctx)[0]) : "";
        const re = new RegExp(pattern, flags);
        const m = value.match(re);
        if (!m || !m.groups) return [{}];
        return [m.groups];
      } catch {
        return [null];
      }
    }

    case "sub": {
      if (typeof value !== "string" || args.length < 2) return [null];
      const patterns = evaluate(value, args[0], ctx);
      const replacements = evaluate(value, args[1], ctx);
      const pattern = String(patterns[0]);
      const replacement = String(replacements[0]);
      try {
        const flags =
          args.length > 2 ? String(evaluate(value, args[2], ctx)[0]) : "";
        return [value.replace(new RegExp(pattern, flags), replacement)];
      } catch {
        return [value];
      }
    }

    case "gsub": {
      if (typeof value !== "string" || args.length < 2) return [null];
      const patterns = evaluate(value, args[0], ctx);
      const replacements = evaluate(value, args[1], ctx);
      const pattern = String(patterns[0]);
      const replacement = String(replacements[0]);
      try {
        const flags =
          args.length > 2 ? String(evaluate(value, args[2], ctx)[0]) : "g";
        const effectiveFlags = flags.includes("g") ? flags : `${flags}g`;
        return [
          value.replace(new RegExp(pattern, effectiveFlags), replacement),
        ];
      } catch {
        return [value];
      }
    }

    case "ascii_downcase":
      if (typeof value === "string") {
        return [
          value.replace(/[A-Z]/g, (c) =>
            String.fromCharCode(c.charCodeAt(0) + 32),
          ),
        ];
      }
      return [null];

    case "ascii_upcase":
      if (typeof value === "string") {
        return [
          value.replace(/[a-z]/g, (c) =>
            String.fromCharCode(c.charCodeAt(0) - 32),
          ),
        ];
      }
      return [null];

    case "ltrimstr": {
      if (typeof value !== "string" || args.length === 0) return [value];
      const prefixes = evaluate(value, args[0], ctx);
      const prefix = String(prefixes[0]);
      return [value.startsWith(prefix) ? value.slice(prefix.length) : value];
    }

    case "rtrimstr": {
      if (typeof value !== "string" || args.length === 0) return [value];
      const suffixes = evaluate(value, args[0], ctx);
      const suffix = String(suffixes[0]);
      // Handle empty suffix case (slice(0, -0) = slice(0, 0) = "")
      if (suffix === "") return [value];
      return [value.endsWith(suffix) ? value.slice(0, -suffix.length) : value];
    }

    case "trimstr": {
      if (typeof value !== "string" || args.length === 0) return [value];
      const strs = evaluate(value, args[0], ctx);
      const str = String(strs[0]);
      if (str === "") return [value];
      let result = value;
      if (result.startsWith(str)) result = result.slice(str.length);
      if (result.endsWith(str)) result = result.slice(0, -str.length);
      return [result];
    }

    case "trim":
      if (typeof value === "string") return [value.trim()];
      throw new Error("trim input must be a string");

    case "ltrim":
      if (typeof value === "string") return [value.trimStart()];
      throw new Error("trim input must be a string");

    case "rtrim":
      if (typeof value === "string") return [value.trimEnd()];
      throw new Error("trim input must be a string");

    case "startswith": {
      if (typeof value !== "string" || args.length === 0) return [false];
      const prefixes = evaluate(value, args[0], ctx);
      return [value.startsWith(String(prefixes[0]))];
    }

    case "endswith": {
      if (typeof value !== "string" || args.length === 0) return [false];
      const suffixes = evaluate(value, args[0], ctx);
      return [value.endsWith(String(suffixes[0]))];
    }

    case "index": {
      if (args.length === 0) return [null];
      const needles = evaluate(value, args[0], ctx);
      // Handle generator args - each needle produces its own output
      return needles.map((needle) => {
        if (typeof value === "string" && typeof needle === "string") {
          // jq: index("") on "" returns null, not 0
          if (needle === "" && value === "") return null;
          const idx = value.indexOf(needle);
          return idx >= 0 ? idx : null;
        }
        if (Array.isArray(value)) {
          // If needle is an array, search for it as a subsequence
          if (Array.isArray(needle)) {
            for (let i = 0; i <= value.length - needle.length; i++) {
              let match = true;
              for (let j = 0; j < needle.length; j++) {
                if (!deepEqual(value[i + j], needle[j])) {
                  match = false;
                  break;
                }
              }
              if (match) return i;
            }
            return null;
          }
          // Otherwise search for the element
          const idx = value.findIndex((x) => deepEqual(x, needle));
          return idx >= 0 ? idx : null;
        }
        return null;
      });
    }

    case "rindex": {
      if (args.length === 0) return [null];
      const needles = evaluate(value, args[0], ctx);
      // Handle generator args - each needle produces its own output
      return needles.map((needle) => {
        if (typeof value === "string" && typeof needle === "string") {
          const idx = value.lastIndexOf(needle);
          return idx >= 0 ? idx : null;
        }
        if (Array.isArray(value)) {
          // If needle is an array, search for it as a subsequence from the end
          if (Array.isArray(needle)) {
            for (let i = value.length - needle.length; i >= 0; i--) {
              let match = true;
              for (let j = 0; j < needle.length; j++) {
                if (!deepEqual(value[i + j], needle[j])) {
                  match = false;
                  break;
                }
              }
              if (match) return i;
            }
            return null;
          }
          // Otherwise search for the element
          for (let i = value.length - 1; i >= 0; i--) {
            if (deepEqual(value[i], needle)) return i;
          }
          return null;
        }
        return null;
      });
    }

    case "indices": {
      if (args.length === 0) return [[]];
      const needles = evaluate(value, args[0], ctx);
      // Handle generator args - each needle produces its own result array
      return needles.map((needle) => {
        const result: number[] = [];
        if (typeof value === "string" && typeof needle === "string") {
          let idx = value.indexOf(needle);
          while (idx !== -1) {
            result.push(idx);
            idx = value.indexOf(needle, idx + 1);
          }
        } else if (Array.isArray(value)) {
          if (Array.isArray(needle)) {
            // Search for consecutive subarray matches
            const needleLen = needle.length;
            if (needleLen === 0) {
              // Empty array matches at every position
              for (let i = 0; i <= value.length; i++) result.push(i);
            } else {
              for (let i = 0; i <= value.length - needleLen; i++) {
                let match = true;
                for (let j = 0; j < needleLen; j++) {
                  if (!deepEqual(value[i + j], needle[j])) {
                    match = false;
                    break;
                  }
                }
                if (match) result.push(i);
              }
            }
          } else {
            // Search for individual element
            for (let i = 0; i < value.length; i++) {
              if (deepEqual(value[i], needle)) result.push(i);
            }
          }
        }
        return result;
      });
    }

    case "floor":
      if (typeof value === "number") return [Math.floor(value)];
      return [null];

    case "ceil":
      if (typeof value === "number") return [Math.ceil(value)];
      return [null];

    case "round":
      if (typeof value === "number") return [Math.round(value)];
      return [null];

    case "sqrt":
      if (typeof value === "number") return [Math.sqrt(value)];
      return [null];

    case "fabs":
    case "abs":
      if (typeof value === "number") return [Math.abs(value)];
      // jq returns strings unchanged for abs
      if (typeof value === "string") return [value];
      return [null];

    case "log":
      if (typeof value === "number") return [Math.log(value)];
      return [null];

    case "log10":
      if (typeof value === "number") return [Math.log10(value)];
      return [null];

    case "log2":
      if (typeof value === "number") return [Math.log2(value)];
      return [null];

    case "exp":
      if (typeof value === "number") return [Math.exp(value)];
      return [null];

    case "exp10":
      if (typeof value === "number") return [10 ** value];
      return [null];

    case "exp2":
      if (typeof value === "number") return [2 ** value];
      return [null];

    case "pow": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const exps = evaluate(value, args[0], ctx);
      const exp = exps[0] as number;
      return [value ** exp];
    }

    case "sin":
      if (typeof value === "number") return [Math.sin(value)];
      return [null];

    case "cos":
      if (typeof value === "number") return [Math.cos(value)];
      return [null];

    case "tan":
      if (typeof value === "number") return [Math.tan(value)];
      return [null];

    case "asin":
      if (typeof value === "number") return [Math.asin(value)];
      return [null];

    case "acos":
      if (typeof value === "number") return [Math.acos(value)];
      return [null];

    case "atan":
      if (typeof value === "number") return [Math.atan(value)];
      return [null];

    case "atan2": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const x = evaluate(value, args[0], ctx)[0] as number;
      return [Math.atan2(value, x)];
    }

    case "sinh":
      if (typeof value === "number") return [Math.sinh(value)];
      return [null];

    case "cosh":
      if (typeof value === "number") return [Math.cosh(value)];
      return [null];

    case "tanh":
      if (typeof value === "number") return [Math.tanh(value)];
      return [null];

    case "asinh":
      if (typeof value === "number") return [Math.asinh(value)];
      return [null];

    case "acosh":
      if (typeof value === "number") return [Math.acosh(value)];
      return [null];

    case "atanh":
      if (typeof value === "number") return [Math.atanh(value)];
      return [null];

    case "cbrt":
      if (typeof value === "number") return [Math.cbrt(value)];
      return [null];

    case "expm1":
      if (typeof value === "number") return [Math.expm1(value)];
      return [null];

    case "log1p":
      if (typeof value === "number") return [Math.log1p(value)];
      return [null];

    case "trunc":
      if (typeof value === "number") return [Math.trunc(value)];
      return [null];

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

    case "ldexp": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const exp = evaluate(value, args[0], ctx)[0] as number;
      return [value * 2 ** exp];
    }

    case "scalbn":
    case "scalbln": {
      if (typeof value !== "number" || args.length === 0) return [null];
      const exp = evaluate(value, args[0], ctx)[0] as number;
      return [value * 2 ** exp];
    }

    case "nearbyint":
      if (typeof value === "number") return [Math.round(value)];
      return [null];

    case "logb":
      if (typeof value === "number")
        return [Math.floor(Math.log2(Math.abs(value)))];
      return [null];

    case "significand":
      if (typeof value === "number") {
        const exp = Math.floor(Math.log2(Math.abs(value)));
        return [value / 2 ** exp];
      }
      return [null];

    case "frexp":
      if (typeof value === "number") {
        if (value === 0) return [[0, 0]];
        const exp = Math.floor(Math.log2(Math.abs(value))) + 1;
        const mantissa = value / 2 ** exp;
        return [[mantissa, exp]];
      }
      return [null];

    case "modf":
      if (typeof value === "number") {
        const intPart = Math.trunc(value);
        const fracPart = value - intPart;
        return [[fracPart, intPart]];
      }
      return [null];

    case "tostring":
      if (typeof value === "string") return [value];
      return [JSON.stringify(value)];

    case "tonumber":
      if (typeof value === "number") return [value];
      if (typeof value === "string") {
        const n = Number(value);
        if (Number.isNaN(n)) {
          throw new JqError(
            `${JSON.stringify(value)} cannot be parsed as a number`,
          );
        }
        return [n];
      }
      throw new JqError(`${typeof value} cannot be parsed as a number`);

    case "toboolean": {
      // jq: toboolean converts "true"/"false" strings and booleans to booleans
      if (typeof value === "boolean") return [value];
      if (typeof value === "string") {
        if (value === "true") return [true];
        if (value === "false") return [false];
        throw new Error(
          `string (${JSON.stringify(value)}) cannot be parsed as a boolean`,
        );
      }
      const typeName =
        value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
      const valueStr =
        typeName === "array" || typeName === "object"
          ? JSON.stringify(value)
          : String(value);
      throw new Error(
        `${typeName} (${valueStr}) cannot be parsed as a boolean`,
      );
    }

    case "infinite":
      // jq: `infinite` produces positive infinity
      return [Number.POSITIVE_INFINITY];

    case "nan":
      // jq: `nan` produces NaN value
      return [Number.NaN];

    case "isinfinite":
      return [typeof value === "number" && !Number.isFinite(value)];

    case "isnan":
      return [typeof value === "number" && Number.isNaN(value)];

    case "isnormal":
      return [
        typeof value === "number" && Number.isFinite(value) && value !== 0,
      ];

    case "isfinite":
      return [typeof value === "number" && Number.isFinite(value)];

    case "numbers":
      return typeof value === "number" ? [value] : [];

    case "strings":
      return typeof value === "string" ? [value] : [];

    case "booleans":
      return typeof value === "boolean" ? [value] : [];

    case "nulls":
      return value === null ? [value] : [];

    case "arrays":
      return Array.isArray(value) ? [value] : [];

    case "objects":
      return value && typeof value === "object" && !Array.isArray(value)
        ? [value]
        : [];

    case "iterables":
      return Array.isArray(value) ||
        (value && typeof value === "object" && !Array.isArray(value))
        ? [value]
        : [];

    case "scalars":
      return !Array.isArray(value) && !(value && typeof value === "object")
        ? [value]
        : [];

    case "now":
      return [Date.now() / 1000];

    case "gmtime": {
      // Convert Unix timestamp to broken-down time array
      // jq format: [year, month(0-11), day(1-31), hour, minute, second, weekday(0-6), yearday(0-365)]
      if (typeof value !== "number") return [null];
      const date = new Date(value * 1000);
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth(); // 0-11
      const day = date.getUTCDate(); // 1-31
      const hour = date.getUTCHours();
      const minute = date.getUTCMinutes();
      const second = date.getUTCSeconds();
      const weekday = date.getUTCDay(); // 0=Sunday
      // Calculate day of year
      const startOfYear = Date.UTC(year, 0, 1);
      const yearday = Math.floor(
        (date.getTime() - startOfYear) / (24 * 60 * 60 * 1000),
      );
      return [[year, month, day, hour, minute, second, weekday, yearday]];
    }

    case "mktime": {
      // Convert broken-down time array to Unix timestamp
      if (!Array.isArray(value)) {
        throw new Error("mktime requires parsed datetime inputs");
      }
      const [year, month, day, hour = 0, minute = 0, second = 0] = value;
      if (typeof year !== "number" || typeof month !== "number") {
        throw new Error("mktime requires parsed datetime inputs");
      }
      const date = Date.UTC(
        year,
        month,
        day ?? 1,
        hour ?? 0,
        minute ?? 0,
        second ?? 0,
      );
      return [Math.floor(date / 1000)];
    }

    case "strftime": {
      // Format time as string
      if (args.length === 0) return [null];
      const fmtVals = evaluate(value, args[0], ctx);
      const fmt = fmtVals[0];
      if (typeof fmt !== "string") {
        throw new Error("strftime/1 requires a string format");
      }
      let date: Date;
      if (typeof value === "number") {
        // Unix timestamp
        date = new Date(value * 1000);
      } else if (Array.isArray(value)) {
        // Broken-down time array
        const [year, month, day, hour = 0, minute = 0, second = 0] = value;
        if (typeof year !== "number" || typeof month !== "number") {
          throw new Error("strftime/1 requires parsed datetime inputs");
        }
        date = new Date(
          Date.UTC(year, month, day ?? 1, hour ?? 0, minute ?? 0, second ?? 0),
        );
      } else {
        throw new Error("strftime/1 requires parsed datetime inputs");
      }
      // Simple strftime implementation
      const dayNames = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ];
      const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
      ];
      const pad = (n: number, w = 2) => String(n).padStart(w, "0");
      const result = fmt
        .replace(/%Y/g, String(date.getUTCFullYear()))
        .replace(/%m/g, pad(date.getUTCMonth() + 1))
        .replace(/%d/g, pad(date.getUTCDate()))
        .replace(/%H/g, pad(date.getUTCHours()))
        .replace(/%M/g, pad(date.getUTCMinutes()))
        .replace(/%S/g, pad(date.getUTCSeconds()))
        .replace(/%A/g, dayNames[date.getUTCDay()])
        .replace(/%B/g, monthNames[date.getUTCMonth()])
        .replace(/%Z/g, "UTC")
        .replace(/%%/g, "%");
      return [result];
    }

    case "strptime": {
      // Parse string to broken-down time array
      if (args.length === 0) return [null];
      if (typeof value !== "string") {
        throw new Error("strptime/1 requires a string input");
      }
      const fmtVals = evaluate(value, args[0], ctx);
      const fmt = fmtVals[0];
      if (typeof fmt !== "string") {
        throw new Error("strptime/1 requires a string format");
      }
      // Simple strptime for common ISO format
      if (fmt === "%Y-%m-%dT%H:%M:%SZ") {
        const match = value.match(
          /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})Z$/,
        );
        if (match) {
          const [, year, month, day, hour, minute, second] = match.map(Number);
          const date = new Date(
            Date.UTC(year, month - 1, day, hour, minute, second),
          );
          const weekday = date.getUTCDay();
          const startOfYear = Date.UTC(year, 0, 1);
          const yearday = Math.floor(
            (date.getTime() - startOfYear) / (24 * 60 * 60 * 1000),
          );
          return [
            [year, month - 1, day, hour, minute, second, weekday, yearday],
          ];
        }
      }
      // Fallback: try to parse as ISO date
      const date = new Date(value);
      if (!Number.isNaN(date.getTime())) {
        const year = date.getUTCFullYear();
        const month = date.getUTCMonth();
        const day = date.getUTCDate();
        const hour = date.getUTCHours();
        const minute = date.getUTCMinutes();
        const second = date.getUTCSeconds();
        const weekday = date.getUTCDay();
        const startOfYear = Date.UTC(year, 0, 1);
        const yearday = Math.floor(
          (date.getTime() - startOfYear) / (24 * 60 * 60 * 1000),
        );
        return [[year, month, day, hour, minute, second, weekday, yearday]];
      }
      throw new Error(`Cannot parse date: ${value}`);
    }

    case "fromdate": {
      // Parse ISO 8601 date string to Unix timestamp
      if (typeof value !== "string") {
        throw new Error("fromdate requires a string input");
      }
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) {
        throw new Error(
          `date "${value}" does not match format "%Y-%m-%dT%H:%M:%SZ"`,
        );
      }
      return [Math.floor(date.getTime() / 1000)];
    }

    case "todate": {
      // Convert Unix timestamp to ISO 8601 date string
      if (typeof value !== "number") {
        throw new Error("todate requires a number input");
      }
      const date = new Date(value * 1000);
      return [date.toISOString().replace(/\.\d{3}Z$/, "Z")];
    }

    case "env":
      return [ctx.env ?? {}];

    case "recurse": {
      if (args.length === 0) {
        const results: QueryValue[] = [];
        const walk = (v: QueryValue) => {
          results.push(v);
          if (Array.isArray(v)) {
            for (const item of v) walk(item);
          } else if (v && typeof v === "object") {
            for (const key of Object.keys(v)) {
              walk((v as Record<string, unknown>)[key]);
            }
          }
        };
        walk(value);
        return results;
      }
      const results: QueryValue[] = [];
      const condExpr = args.length >= 2 ? args[1] : null;
      const maxDepth = 10000; // Prevent infinite loops
      let depth = 0;
      const walk = (v: QueryValue) => {
        if (depth++ > maxDepth) return;
        // Check condition if provided (recurse(f; cond))
        if (condExpr) {
          const condResults = evaluate(v, condExpr, ctx);
          if (!condResults.some(isTruthy)) return;
        }
        results.push(v);
        const next = evaluate(v, args[0], ctx);
        for (const n of next) {
          if (n !== null && n !== undefined) walk(n);
        }
      };
      walk(value);
      return results;
    }

    case "recurse_down":
      return evalBuiltin(value, "recurse", args, ctx);

    case "walk": {
      if (args.length === 0) return [value];
      const seen = new WeakSet<object>();
      const walkFn = (v: QueryValue): QueryValue => {
        if (v && typeof v === "object") {
          if (seen.has(v as object)) return v;
          seen.add(v as object);
        }
        let transformed: QueryValue;
        if (Array.isArray(v)) {
          transformed = v.map(walkFn);
        } else if (v && typeof v === "object") {
          const obj: Record<string, unknown> = {};
          for (const [k, val] of Object.entries(v)) {
            obj[k] = walkFn(val);
          }
          transformed = obj;
        } else {
          transformed = v;
        }
        const results = evaluate(transformed, args[0], ctx);
        return results[0];
      };
      return [walkFn(value)];
    }

    case "transpose": {
      if (!Array.isArray(value)) return [null];
      if (value.length === 0) return [[]];
      const maxLen = Math.max(
        ...value.map((row) => (Array.isArray(row) ? row.length : 0)),
      );
      const result: QueryValue[][] = [];
      for (let i = 0; i < maxLen; i++) {
        result.push(value.map((row) => (Array.isArray(row) ? row[i] : null)));
      }
      return [result];
    }

    case "combinations": {
      // Generate Cartesian product of arrays
      // combinations with no args: input is array of arrays, generate all combinations
      // combinations(n): generate n-length combinations from input array
      if (args.length > 0) {
        // combinations(n) - n-tuples from input array
        const ns = evaluate(value, args[0], ctx);
        const n = ns[0] as number;
        if (!Array.isArray(value) || n < 0) return [];
        if (n === 0) return [[]];
        // Generate all n-length combinations with repetition
        const results: QueryValue[][] = [];
        const generate = (current: QueryValue[], depth: number) => {
          if (depth === n) {
            results.push([...current]);
            return;
          }
          for (const item of value) {
            current.push(item);
            generate(current, depth + 1);
            current.pop();
          }
        };
        generate([], 0);
        return results;
      }
      // combinations with no args - Cartesian product of array of arrays
      if (!Array.isArray(value)) return [];
      if (value.length === 0) return [[]];
      // Check all elements are arrays
      for (const arr of value) {
        if (!Array.isArray(arr)) return [];
      }
      // Generate Cartesian product
      const results: QueryValue[][] = [];
      const generate = (index: number, current: QueryValue[]) => {
        if (index === value.length) {
          results.push([...current]);
          return;
        }
        const arr = value[index] as QueryValue[];
        for (const item of arr) {
          current.push(item);
          generate(index + 1, current);
          current.pop();
        }
      };
      generate(0, []);
      return results;
    }

    case "ascii":
      if (typeof value === "string" && value.length > 0) {
        return [value.charCodeAt(0)];
      }
      return [null];

    case "explode":
      if (typeof value === "string") {
        return [Array.from(value).map((c) => c.codePointAt(0))];
      }
      return [null];

    case "implode":
      if (!Array.isArray(value)) {
        throw new Error("implode input must be an array");
      }
      {
        // jq: Invalid code points get replaced with Unicode replacement character (0xFFFD)
        const REPLACEMENT_CHAR = 0xfffd;
        const chars = (value as QueryValue[]).map((cp) => {
          // Check for non-numeric values
          if (typeof cp === "string") {
            throw new Error(
              `string (${JSON.stringify(cp)}) can't be imploded, unicode codepoint needs to be numeric`,
            );
          }
          if (typeof cp !== "number" || Number.isNaN(cp)) {
            throw new Error(
              `number (null) can't be imploded, unicode codepoint needs to be numeric`,
            );
          }
          // Truncate to integer
          const code = Math.trunc(cp);
          // Check for valid Unicode code point
          // Valid range: 0 to 0x10FFFF, excluding surrogate pairs (0xD800-0xDFFF)
          if (code < 0 || code > 0x10ffff) {
            return String.fromCodePoint(REPLACEMENT_CHAR);
          }
          if (code >= 0xd800 && code <= 0xdfff) {
            return String.fromCodePoint(REPLACEMENT_CHAR);
          }
          return String.fromCodePoint(code);
        });
        return [chars.join("")];
      }

    case "tojson":
    case "tojsonstream": {
      // Check depth to avoid V8 stack overflow during JSON.stringify
      const maxDepth = ctx.limits.maxDepth ?? DEFAULT_MAX_JQ_DEPTH;
      if (getValueDepth(value, maxDepth + 1) > maxDepth) {
        return [null];
      }
      return [JSON.stringify(value)];
    }

    case "fromjson": {
      if (typeof value === "string") {
        // jq extension: "nan" and "inf"/"infinity" are valid
        const trimmed = value.trim().toLowerCase();
        if (trimmed === "nan") {
          return [Number.NaN];
        }
        if (trimmed === "inf" || trimmed === "infinity") {
          return [Number.POSITIVE_INFINITY];
        }
        if (trimmed === "-inf" || trimmed === "-infinity") {
          return [Number.NEGATIVE_INFINITY];
        }
        try {
          return [JSON.parse(value)];
        } catch {
          throw new Error(`Invalid JSON: ${value}`);
        }
      }
      throw new Error(`fromjson requires a string, got ${typeof value}`);
    }

    case "limit": {
      if (args.length < 2) return [];
      const ns = evaluate(value, args[0], ctx);
      // Handle generator args - each n produces its own limited output
      return ns.flatMap((nv) => {
        const n = nv as number;
        // jq: negative limit throws error
        if (n < 0) {
          throw new Error("limit doesn't support negative count");
        }
        // jq: limit(0; expr) should return [] without evaluating expr
        if (n === 0) return [];
        // Use lazy evaluation to get partial results before errors
        let results: QueryValue[];
        try {
          results = evaluateWithPartialResults(value, args[1], ctx);
        } catch (e) {
          // Always re-throw execution limit errors
          if (e instanceof ExecutionLimitError) throw e;
          results = [];
        }
        return results.slice(0, n);
      });
    }

    case "isempty": {
      if (args.length < 1) return [true];
      // isempty returns true if the expression produces no values
      // It should short-circuit: if first value is produced, return false
      // For comma expressions like `1,error("foo")`, the left side produces a value
      // before the right side errors, so we should return false
      try {
        const results = evaluateWithPartialResults(value, args[0], ctx);
        return [results.length === 0];
      } catch (e) {
        // Always re-throw execution limit errors
        if (e instanceof ExecutionLimitError) throw e;
        // If an error occurs without any results, return true
        return [true];
      }
    }

    case "isvalid": {
      if (args.length < 1) return [true];
      // isvalid returns true if the expression produces at least one value without error
      try {
        const results = evaluate(value, args[0], ctx);
        return [results.length > 0];
      } catch (e) {
        // Always re-throw execution limit errors
        if (e instanceof ExecutionLimitError) throw e;
        // Any other error means invalid
        return [false];
      }
    }

    case "skip": {
      if (args.length < 2) return [];
      const ns = evaluate(value, args[0], ctx);
      // Handle generator args - each n produces its own skip result
      return ns.flatMap((nv) => {
        const n = nv as number;
        if (n < 0) {
          throw new Error("skip doesn't support negative count");
        }
        const results = evaluate(value, args[1], ctx);
        return results.slice(n);
      });
    }

    case "until": {
      if (args.length < 2) return [value];
      let current = value;
      const maxIterations = ctx.limits.maxIterations;
      for (let i = 0; i < maxIterations; i++) {
        const conds = evaluate(current, args[0], ctx);
        if (conds.some(isTruthy)) return [current];
        const next = evaluate(current, args[1], ctx);
        if (next.length === 0) return [current];
        current = next[0];
      }
      throw new ExecutionLimitError(
        `jq until: too many iterations (${maxIterations}), increase executionLimits.maxJqIterations`,
        "iterations",
      );
    }

    case "while": {
      if (args.length < 2) return [value];
      const results: QueryValue[] = [];
      let current = value;
      const maxIterations = ctx.limits.maxIterations;
      for (let i = 0; i < maxIterations; i++) {
        const conds = evaluate(current, args[0], ctx);
        if (!conds.some(isTruthy)) break;
        results.push(current);
        const next = evaluate(current, args[1], ctx);
        if (next.length === 0) break;
        current = next[0];
      }
      if (results.length >= maxIterations) {
        throw new ExecutionLimitError(
          `jq while: too many iterations (${maxIterations}), increase executionLimits.maxJqIterations`,
          "iterations",
        );
      }
      return results;
    }

    case "repeat": {
      if (args.length === 0) return [value];
      const results: QueryValue[] = [];
      let current = value;
      const maxIterations = ctx.limits.maxIterations;
      for (let i = 0; i < maxIterations; i++) {
        results.push(current);
        const next = evaluate(current, args[0], ctx);
        if (next.length === 0) break;
        current = next[0];
      }
      if (results.length >= maxIterations) {
        throw new ExecutionLimitError(
          `jq repeat: too many iterations (${maxIterations}), increase executionLimits.maxJqIterations`,
          "iterations",
        );
      }
      return results;
    }

    case "debug":
      return [value];

    case "input_line_number":
      return [1];

    // Format strings
    case "@base64":
      if (typeof value === "string") {
        // Use Buffer for Node.js, btoa for browser
        if (typeof Buffer !== "undefined") {
          return [Buffer.from(value, "utf-8").toString("base64")];
        }
        return [btoa(value)];
      }
      return [null];

    case "@base64d":
      if (typeof value === "string") {
        // Use Buffer for Node.js, atob for browser
        if (typeof Buffer !== "undefined") {
          return [Buffer.from(value, "base64").toString("utf-8")];
        }
        return [atob(value)];
      }
      return [null];

    case "@uri":
      if (typeof value === "string") {
        return [encodeURIComponent(value)];
      }
      return [null];

    case "@urid":
      if (typeof value === "string") {
        return [decodeURIComponent(value)];
      }
      return [null];

    case "@csv": {
      if (!Array.isArray(value)) return [null];
      const csvEscaped = value.map((v) => {
        if (v === null) return "";
        if (typeof v === "boolean") return v ? "true" : "false";
        if (typeof v === "number") return String(v);
        // Only quote strings that contain special characters (comma, quote, newline)
        const s = String(v);
        if (
          s.includes(",") ||
          s.includes('"') ||
          s.includes("\n") ||
          s.includes("\r")
        ) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      });
      return [csvEscaped.join(",")];
    }

    case "@tsv": {
      if (!Array.isArray(value)) return [null];
      return [
        value
          .map((v) =>
            String(v ?? "")
              .replace(/\t/g, "\\t")
              .replace(/\n/g, "\\n"),
          )
          .join("\t"),
      ];
    }

    case "@json": {
      // Check depth to avoid V8 stack overflow during JSON.stringify
      const maxDepth = ctx.limits.maxDepth ?? DEFAULT_MAX_JQ_DEPTH;
      if (getValueDepth(value, maxDepth + 1) > maxDepth) {
        return [null];
      }
      return [JSON.stringify(value)];
    }

    case "@html":
      if (typeof value === "string") {
        return [
          value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;"),
        ];
      }
      return [null];

    case "@sh":
      if (typeof value === "string") {
        // Shell escape: wrap in single quotes, escape any single quotes
        return [`'${value.replace(/'/g, "'\\''")}'`];
      }
      return [null];

    case "@text":
      if (typeof value === "string") return [value];
      if (value === null || value === undefined) return [""];
      return [String(value)];

    // Navigation operators
    case "parent": {
      if (ctx.root === undefined || ctx.currentPath === undefined) return [];
      const path = ctx.currentPath;
      if (path.length === 0) return []; // At root, no parent

      // Get levels argument (default: 1)
      const levels =
        args.length > 0 ? (evaluate(value, args[0], ctx)[0] as number) : 1;

      if (levels >= 0) {
        // Positive: go up n levels
        if (levels > path.length) return []; // Beyond root
        const parentPath = path.slice(0, path.length - levels);
        return [getValueAtPath(ctx.root, parentPath)];
      } else {
        // Negative: index from root (-1 = root, -2 = one below root, etc.)
        // -1 means path length 0 (root)
        // -2 means path length 1 (one level below root)
        const targetLen = -levels - 1;
        if (targetLen >= path.length) return [value]; // Beyond current
        const parentPath = path.slice(0, targetLen);
        return [getValueAtPath(ctx.root, parentPath)];
      }
    }

    case "parents": {
      if (ctx.root === undefined || ctx.currentPath === undefined) return [[]];
      const path = ctx.currentPath;
      const parents: QueryValue[] = [];
      // Build array of parents from immediate parent to root
      for (let i = path.length - 1; i >= 0; i--) {
        parents.push(getValueAtPath(ctx.root, path.slice(0, i)));
      }
      return [parents];
    }

    case "root":
      return ctx.root !== undefined ? [ctx.root] : [];

    // SQL-like functions
    case "IN": {
      // IN(stream) - check if input is in stream
      // IN(stream1; stream2) - check if any value from stream1 is in stream2
      if (args.length === 0) return [false];
      if (args.length === 1) {
        // x | IN(stream) - check if x is in any value from stream
        const streamVals = evaluate(value, args[0], ctx);
        for (const v of streamVals) {
          if (deepEqual(value, v)) return [true];
        }
        return [false];
      }
      // IN(stream1; stream2) - check if any value from stream1 is in stream2
      const stream1Vals = evaluate(value, args[0], ctx);
      const stream2Vals = evaluate(value, args[1], ctx);
      const stream2Set = new Set(stream2Vals.map((v) => JSON.stringify(v)));
      for (const v of stream1Vals) {
        if (stream2Set.has(JSON.stringify(v))) return [true];
      }
      return [false];
    }

    case "INDEX": {
      // INDEX(stream) - create object mapping values to themselves
      // INDEX(stream; idx_expr) - create object using idx_expr as key
      // INDEX(stream; idx_expr; val_expr) - create object with idx_expr keys and val_expr values
      if (args.length === 0) return [{}];
      if (args.length === 1) {
        // INDEX(stream) - index by the values themselves (like group_by)
        const streamVals = evaluate(value, args[0], ctx);
        const result: Record<string, unknown> = {};
        for (const v of streamVals) {
          const key = String(v);
          result[key] = v;
        }
        return [result];
      }
      if (args.length === 2) {
        // INDEX(stream; idx_expr) - index by idx_expr applied to each value
        const streamVals = evaluate(value, args[0], ctx);
        const result: Record<string, unknown> = {};
        for (const v of streamVals) {
          const keys = evaluate(v, args[1], ctx);
          if (keys.length > 0) {
            const key = String(keys[0]);
            result[key] = v;
          }
        }
        return [result];
      }
      // INDEX(stream; idx_expr; val_expr)
      const streamVals = evaluate(value, args[0], ctx);
      const result: Record<string, unknown> = {};
      for (const v of streamVals) {
        const keys = evaluate(v, args[1], ctx);
        const vals = evaluate(v, args[2], ctx);
        if (keys.length > 0 && vals.length > 0) {
          const key = String(keys[0]);
          result[key] = vals[0];
        }
      }
      return [result];
    }

    case "JOIN": {
      // JOIN(idx; key_expr) - SQL-like join
      // For each item in input array, lookup in idx using key_expr, return [item, lookup_value]
      // If not found, returns [item, null]
      if (args.length < 2) return [null];
      const idx = evaluate(value, args[0], ctx)[0];
      if (!idx || typeof idx !== "object" || Array.isArray(idx)) return [null];
      const idxObj = idx as Record<string, unknown>;
      if (!Array.isArray(value)) return [null];
      const results: QueryValue[] = [];
      for (const item of value) {
        const keys = evaluate(item, args[1], ctx);
        const key = keys.length > 0 ? String(keys[0]) : "";
        const lookup = key in idxObj ? idxObj[key] : null;
        results.push([item, lookup]);
      }
      return [results];
    }

    default: {
      // Check for user-defined function by name/arity
      const funcKey = `${name}/${args.length}`;
      const userFunc = ctx.funcs?.get(funcKey) as
        | { params: string[]; body: AstNode; closure?: Map<string, unknown> }
        | undefined;
      if (userFunc) {
        // User-defined function: bind parameters
        // In jq, parameters are "filters" that can produce multiple values.
        // We evaluate them in the calling context and store as literal values.
        //
        // Use the function's closure for lexical scoping, not the current context's funcs.
        // This ensures that functions capture the scope at definition time.
        const baseFuncs = (userFunc.closure ?? ctx.funcs ?? new Map()) as Map<
          string,
          { params: string[]; body: AstNode; closure?: Map<string, unknown> }
        >;
        const newFuncs = new Map(baseFuncs);
        // Also add the current function itself so recursion works
        newFuncs.set(funcKey, userFunc);
        for (let i = 0; i < userFunc.params.length; i++) {
          const paramName = userFunc.params[i];
          const argExpr = args[i];
          if (argExpr) {
            // Evaluate the argument in the calling context, then store as a literal
            // This implements call-by-value semantics
            const argVals = evaluate(value, argExpr, ctx);
            // Store as a function that returns all the values
            let bodyNode: AstNode;
            if (argVals.length === 0) {
              bodyNode = { type: "Call", name: "empty", args: [] };
            } else if (argVals.length === 1) {
              bodyNode = { type: "Literal", value: argVals[0] };
            } else {
              // Multiple values - build a right-associative Comma chain
              bodyNode = {
                type: "Literal",
                value: argVals[argVals.length - 1],
              };
              for (let j = argVals.length - 2; j >= 0; j--) {
                bodyNode = {
                  type: "Comma",
                  left: { type: "Literal", value: argVals[j] },
                  right: bodyNode,
                };
              }
            }
            newFuncs.set(`${paramName}/0`, { params: [], body: bodyNode });
          }
        }
        const newCtx: EvalContext = { ...ctx, funcs: newFuncs };
        return evaluate(value, userFunc.body, newCtx);
      }
      throw new Error(`Unknown function: ${name}`);
    }
  }
}

function compareJq(a: QueryValue, b: QueryValue): number {
  const typeOrder = (v: QueryValue): number => {
    if (v === null) return 0;
    if (typeof v === "boolean") return 1;
    if (typeof v === "number") return 2;
    if (typeof v === "string") return 3;
    if (Array.isArray(v)) return 4;
    if (typeof v === "object") return 5;
    return 6;
  };

  const ta = typeOrder(a);
  const tb = typeOrder(b);
  if (ta !== tb) return ta - tb;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  if (typeof a === "boolean" && typeof b === "boolean")
    return (a ? 1 : 0) - (b ? 1 : 0);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const cmp = compareJq(a[i], b[i]);
      if (cmp !== 0) return cmp;
    }
    return a.length - b.length;
  }
  // Objects: compare by sorted keys, then values
  if (a && b && typeof a === "object" && typeof b === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj).sort();
    const bKeys = Object.keys(bObj).sort();
    // First compare keys
    for (let i = 0; i < Math.min(aKeys.length, bKeys.length); i++) {
      const keyCmp = aKeys[i].localeCompare(bKeys[i]);
      if (keyCmp !== 0) return keyCmp;
    }
    if (aKeys.length !== bKeys.length) return aKeys.length - bKeys.length;
    // Then compare values for each key
    for (const key of aKeys) {
      const cmp = compareJq(aObj[key], bObj[key]);
      if (cmp !== 0) return cmp;
    }
  }

  return 0;
}

function containsDeep(a: QueryValue, b: QueryValue): boolean {
  if (deepEqual(a, b)) return true;
  // jq: string contains substring check
  if (typeof a === "string" && typeof b === "string") {
    return a.includes(b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return b.every((bItem) => a.some((aItem) => containsDeep(aItem, bItem)));
  }
  if (
    a &&
    b &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    return Object.keys(bObj).every(
      (k) => k in aObj && containsDeep(aObj[k], bObj[k]),
    );
  }
  return false;
}

function setPath(
  value: QueryValue,
  path: (string | number)[],
  newVal: QueryValue,
): QueryValue {
  if (path.length === 0) return newVal;

  const [head, ...rest] = path;

  if (typeof head === "number") {
    // jq: Cannot index object with number
    if (value && typeof value === "object" && !Array.isArray(value)) {
      throw new Error("Cannot index object with number");
    }
    // jq: Array index too large (limit to prevent memory issues)
    const MAX_ARRAY_INDEX = 536870911; // jq's limit
    if (head > MAX_ARRAY_INDEX) {
      throw new Error("Array index too large");
    }
    // jq: Out of bounds negative array index
    if (head < 0) {
      throw new Error("Out of bounds negative array index");
    }
    const arr = Array.isArray(value) ? [...value] : [];
    while (arr.length <= head) arr.push(null);
    arr[head] = setPath(arr[head], rest, newVal);
    return arr;
  }

  // jq: Cannot index array with string (path key must be string for objects)
  if (Array.isArray(value)) {
    throw new Error("Cannot index array with string");
  }
  const obj =
    value && typeof value === "object" && !Array.isArray(value)
      ? { ...value }
      : {};
  (obj as Record<string, unknown>)[head] = setPath(
    (obj as Record<string, unknown>)[head],
    rest,
    newVal,
  );
  return obj;
}

function deletePath(value: QueryValue, path: (string | number)[]): QueryValue {
  if (path.length === 0) return null;
  if (path.length === 1) {
    const key = path[0];
    if (Array.isArray(value) && typeof key === "number") {
      const arr = [...value];
      arr.splice(key, 1);
      return arr;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const obj = { ...value } as Record<string, unknown>;
      delete obj[String(key)];
      return obj;
    }
    return value;
  }

  const [head, ...rest] = path;
  if (Array.isArray(value) && typeof head === "number") {
    const arr = [...value];
    arr[head] = deletePath(arr[head], rest);
    return arr;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = { ...value } as Record<string, unknown>;
    obj[String(head)] = deletePath(obj[String(head)], rest);
    return obj;
  }
  return value;
}

function collectPaths(
  value: QueryValue,
  expr: AstNode,
  ctx: EvalContext,
  currentPath: (string | number)[],
  paths: (string | number)[][],
): void {
  // Handle Comma - collect paths for both parts
  if (expr.type === "Comma") {
    const comma = expr as { type: "Comma"; left: AstNode; right: AstNode };
    collectPaths(value, comma.left, ctx, currentPath, paths);
    collectPaths(value, comma.right, ctx, currentPath, paths);
    return;
  }

  // Try to extract a static path from the AST
  const staticPath = extractPathFromAst(expr);
  if (staticPath !== null) {
    paths.push([...currentPath, ...staticPath]);
    return;
  }

  // For more complex expressions, evaluate and try to infer paths
  // This handles cases like .[] which produce multiple paths
  if (expr.type === "Iterate") {
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        paths.push([...currentPath, i]);
      }
    } else if (value && typeof value === "object") {
      for (const key of Object.keys(value)) {
        paths.push([...currentPath, key]);
      }
    }
    return;
  }

  // Handle Recurse (..) - recursive descent, returns paths to all values
  if (expr.type === "Recurse") {
    const walkPaths = (v: QueryValue, path: (string | number)[]) => {
      paths.push([...currentPath, ...path]);
      if (v && typeof v === "object") {
        if (Array.isArray(v)) {
          for (let i = 0; i < v.length; i++) {
            walkPaths(v[i], [...path, i]);
          }
        } else {
          for (const key of Object.keys(v)) {
            walkPaths((v as Record<string, unknown>)[key], [...path, key]);
          }
        }
      }
    };
    walkPaths(value, []);
    return;
  }

  // For Pipe expressions, collect paths through the pipe
  if (expr.type === "Pipe") {
    const leftPath = extractPathFromAst(expr.left);
    if (leftPath !== null) {
      const leftResults = evaluate(value, expr.left, ctx);
      for (const lv of leftResults) {
        collectPaths(lv, expr.right, ctx, [...currentPath, ...leftPath], paths);
      }
      return;
    }
  }

  // Fallback: if expression produces results, push current path
  const results = evaluate(value, expr, ctx);
  if (results.length > 0) {
    paths.push(currentPath);
  }
}
