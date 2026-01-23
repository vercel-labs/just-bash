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

const DEFAULT_MAX_JQ_ITERATIONS = 10000;

export interface QueryExecutionLimits {
  maxIterations?: number;
}

export interface EvalContext {
  vars: Map<string, QueryValue>;
  limits: Required<QueryExecutionLimits>;
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
            const i = idx < 0 ? v.length + idx : idx;
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
        if (!Array.isArray(v) && typeof v !== "string") return [null];
        const len = v.length;
        const starts = ast.start ? evaluate(value, ast.start, ctx) : [0];
        const ends = ast.end ? evaluate(value, ast.end, ctx) : [len];
        return starts.flatMap((s) =>
          ends.map((e) => {
            // jq uses floor for start and ceil for end (for fractional indices)
            const sNum = s as number;
            const eNum = e as number;
            const startRaw = Number.isInteger(sNum) ? sNum : Math.floor(sNum);
            const endRaw = Number.isInteger(eNum) ? eNum : Math.ceil(eNum);
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
        if (ast.op === "-") return typeof v === "number" ? -v : null;
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
          // jq: In catch handler, input is the error message string
          const errorMsg = e instanceof Error ? e.message : String(e);
          return evaluate(errorMsg, ast.catch, ctx);
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
      for (const item of items) {
        let newCtx: EvalContext | null;
        if (ast.pattern) {
          newCtx = bindPattern(ctx, ast.pattern, item);
          if (newCtx === null) continue; // Pattern doesn't match, skip
        } else {
          newCtx = withVar(ctx, ast.varName, item);
        }
        accumulator = evaluate(accumulator, ast.update, newCtx)[0];
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
        const idx = indices[0];

        if (path.base) {
          return updateRecursive(val, path.base, (baseVal) => {
            if (typeof idx === "number" && Array.isArray(baseVal)) {
              const arr = [...baseVal];
              const i = idx < 0 ? arr.length + idx : idx;
              if (i >= 0 && i < arr.length) {
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
            if (i >= 0 && i < arr.length) {
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
  function deleteAt(val: QueryValue, path: AstNode): QueryValue {
    switch (path.type) {
      case "Identity":
        return null;

      case "Field": {
        if (val && typeof val === "object" && !Array.isArray(val)) {
          const obj = { ...val } as Record<string, unknown>;
          delete obj[path.name];
          return obj;
        }
        return val;
      }

      case "Index": {
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
                `number (${l}) and number (${r}) cannot be modulo-divided because the divisor is zero`,
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

    case "empty":
      return [];

    case "error": {
      const msg = args.length > 0 ? evaluate(value, args[0], ctx)[0] : value;
      throw new Error(String(msg));
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
        const results = evaluate(value, args[0], ctx);
        return results.length > 0 ? [results[0]] : [];
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
      const n = ns[0] as number;
      if (args.length > 1) {
        const results = evaluate(value, args[1], ctx);
        return n >= 0 && n < results.length ? [results[n]] : [];
      }
      if (Array.isArray(value)) {
        return n >= 0 && n < value.length ? [value[n]] : [null];
      }
      return [null];
    }

    case "range": {
      if (args.length === 0) return [];
      const startsVals = evaluate(value, args[0], ctx);
      if (args.length === 1) {
        // range(n) - single arg, range from 0 to n
        const n = startsVals[0] as number;
        return Array.from({ length: Math.max(0, n) }, (_, i) => i);
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
      const seen = new Set<string>();
      const result: QueryValue[] = [];
      for (const item of value) {
        const key = JSON.stringify(evaluate(item, args[0], ctx)[0]);
        if (!seen.has(key)) {
          seen.add(key);
          result.push(item);
        }
      }
      return [result];
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
      const depth =
        args.length > 0
          ? (evaluate(value, args[0], ctx)[0] as number)
          : Number.POSITIVE_INFINITY;
      if (depth < 0) {
        throw new Error("flatten depth must not be negative");
      }
      return [value.flat(depth)];
    }

    case "add":
      if (Array.isArray(value)) {
        if (value.length === 0) return [null];
        if (value.every((x) => typeof x === "number")) {
          return [value.reduce((a, b) => (a as number) + (b as number), 0)];
        }
        if (value.every((x) => typeof x === "string")) {
          return [value.join("")];
        }
        if (value.every((x) => Array.isArray(x))) {
          return [value.flat()];
        }
        if (
          value.every((x) => x && typeof x === "object" && !Array.isArray(x))
        ) {
          return [Object.assign({}, ...value)];
        }
      }
      return [null];

    case "any": {
      if (args.length > 0) {
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
      if (args.length > 0) {
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
      const path = paths[0] as (string | number)[];
      let current: QueryValue = value;
      for (const key of path) {
        if (current === null || current === undefined) return [null];
        if (Array.isArray(current) && typeof key === "number") {
          current = current[key];
        } else if (typeof current === "object" && typeof key === "string") {
          current = (current as Record<string, unknown>)[key];
        } else {
          return [null];
        }
      }
      return [current];
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
      return [paths];
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
            const key = obj.key ?? obj.name ?? obj.k;
            const val = obj.value ?? obj.v;
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
      const sep = String(seps[0]);
      // jq: null values become empty strings, others get stringified
      // Also check for arrays/objects which should error
      for (const x of value) {
        if (Array.isArray(x) || (x !== null && typeof x === "object")) {
          throw new Error("cannot join: contains arrays or objects");
        }
      }
      return [
        value
          .map((x) => (x === null ? "" : typeof x === "string" ? x : String(x)))
          .join(sep),
      ];
    }

    case "split": {
      if (typeof value !== "string" || args.length === 0) return [null];
      const seps = evaluate(value, args[0], ctx);
      const sep = String(seps[0]);
      return [value.split(sep)];
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
      throw new Error(
        `${Array.isArray(value) ? "array" : value === null ? "null" : typeof value} (${JSON.stringify(value)}) cannot be trimmed`,
      );

    case "ltrim":
      if (typeof value === "string") return [value.trimStart()];
      throw new Error(
        `${Array.isArray(value) ? "array" : value === null ? "null" : typeof value} (${JSON.stringify(value)}) cannot be trimmed`,
      );

    case "rtrim":
      if (typeof value === "string") return [value.trimEnd()];
      throw new Error(
        `${Array.isArray(value) ? "array" : value === null ? "null" : typeof value} (${JSON.stringify(value)}) cannot be trimmed`,
      );

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
      const needle = needles[0];
      if (typeof value === "string" && typeof needle === "string") {
        const idx = value.indexOf(needle);
        return [idx >= 0 ? idx : null];
      }
      if (Array.isArray(value)) {
        const idx = value.findIndex((x) => deepEqual(x, needle));
        return [idx >= 0 ? idx : null];
      }
      return [null];
    }

    case "rindex": {
      if (args.length === 0) return [null];
      const needles = evaluate(value, args[0], ctx);
      const needle = needles[0];
      if (typeof value === "string" && typeof needle === "string") {
        const idx = value.lastIndexOf(needle);
        return [idx >= 0 ? idx : null];
      }
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) {
          if (deepEqual(value[i], needle)) return [i];
        }
        return [null];
      }
      return [null];
    }

    case "indices": {
      if (args.length === 0) return [[]];
      const needles = evaluate(value, args[0], ctx);
      const needle = needles[0];
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
      return [result];
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
        return [Number.isNaN(n) ? null : n];
      }
      return [null];

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
      const seen = new Set<string>();
      const walk = (v: QueryValue) => {
        const key = JSON.stringify(v);
        if (seen.has(key)) return;
        seen.add(key);
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
      if (Array.isArray(value)) {
        // jq: Invalid code points get replaced with Unicode replacement character (0xFFFD)
        const REPLACEMENT_CHAR = 0xfffd;
        const chars = (value as number[]).map((cp) => {
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
      return [null];

    case "tojson":
    case "tojsonstream":
      return [JSON.stringify(value)];

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
      const n = ns[0] as number;
      // jq: limit(0; expr) should return [] without evaluating expr
      if (n <= 0) return [];
      const results = evaluate(value, args[1], ctx);
      return results.slice(0, n);
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

    case "@csv": {
      if (!Array.isArray(value)) return [null];
      const csvEscaped = value.map((v) => {
        const s = String(v ?? "");
        // CSV standard: escape quotes by doubling them, wrap in quotes if needed
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
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

    case "@json":
      return [JSON.stringify(value)];

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

  return 0;
}

function containsDeep(a: QueryValue, b: QueryValue): boolean {
  if (deepEqual(a, b)) return true;
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
  const results = evaluate(value, expr, ctx);
  if (results.length > 0) {
    paths.push(currentPath);
  }
}
