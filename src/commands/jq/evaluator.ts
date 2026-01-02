/**
 * jq AST evaluator
 *
 * Evaluates a parsed jq AST against a JSON value.
 */

import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { AstNode } from "./parser.js";

export type JqValue = unknown;

const DEFAULT_MAX_JQ_ITERATIONS = 10000;

export interface JqExecutionLimits {
  maxIterations?: number;
}

export interface EvalContext {
  vars: Map<string, JqValue>;
  limits: Required<JqExecutionLimits>;
}

function createContext(limits?: JqExecutionLimits): EvalContext {
  return {
    vars: new Map(),
    limits: {
      maxIterations: limits?.maxIterations ?? DEFAULT_MAX_JQ_ITERATIONS,
    },
  };
}

function withVar(ctx: EvalContext, name: string, value: JqValue): EvalContext {
  const newVars = new Map(ctx.vars);
  newVars.set(name, value);
  return { vars: newVars, limits: ctx.limits };
}

export interface EvaluateOptions {
  limits?: JqExecutionLimits;
}

export function evaluate(
  value: JqValue,
  ast: AstNode,
  ctxOrOptions?: EvalContext | EvaluateOptions,
): JqValue[] {
  const ctx: EvalContext =
    ctxOrOptions && "vars" in ctxOrOptions
      ? ctxOrOptions
      : createContext((ctxOrOptions as EvaluateOptions | undefined)?.limits);
  switch (ast.type) {
    case "Identity":
      return [value];

    case "Field": {
      const bases = ast.base ? evaluate(value, ast.base, ctx) : [value];
      return bases.flatMap((v) => {
        if (v && typeof v === "object" && !Array.isArray(v)) {
          return [(v as Record<string, unknown>)[ast.name]];
        }
        return [null];
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
            const start = normalizeIndex(s as number, len);
            const end = normalizeIndex(e as number, len);
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
      return leftResults.flatMap((v) => evaluate(v, ast.right, ctx));
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
            for (const v of values) {
              newResults.push({ ...obj, [String(k)]: v });
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
        return [null];
      });
    }

    case "Try": {
      try {
        return evaluate(value, ast.body, ctx);
      } catch {
        if (ast.catch) {
          return evaluate(value, ast.catch, ctx);
        }
        return [];
      }
    }

    case "Call":
      return evalBuiltin(value, ast.name, ast.args, ctx);

    case "VarBind": {
      const values = evaluate(value, ast.value, ctx);
      return values.flatMap((v) => {
        const newCtx = withVar(ctx, ast.name, v);
        return evaluate(value, ast.body, newCtx);
      });
    }

    case "VarRef": {
      const v = ctx.vars.get(ast.name);
      return v !== undefined ? [v] : [null];
    }

    case "Recurse": {
      const results: JqValue[] = [];
      const seen = new WeakSet<object>();
      const walk = (val: JqValue) => {
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
        const newCtx = withVar(ctx, ast.varName, item);
        accumulator = evaluate(accumulator, ast.update, newCtx)[0];
      }
      return [accumulator];
    }

    case "Foreach": {
      const items = evaluate(value, ast.expr, ctx);
      let state = evaluate(value, ast.init, ctx)[0];
      const results: JqValue[] = [];
      for (const item of items) {
        const newCtx = withVar(ctx, ast.varName, item);
        state = evaluate(state, ast.update, newCtx)[0];
        if (ast.extract) {
          const extracted = evaluate(state, ast.extract, newCtx);
          results.push(...extracted);
        } else {
          results.push(state);
        }
      }
      return results;
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
  root: JqValue,
  pathExpr: AstNode,
  op: string,
  valueExpr: AstNode,
  ctx: EvalContext,
): JqValue {
  function computeNewValue(current: JqValue, newVal: JqValue): JqValue {
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
    val: JqValue,
    path: AstNode,
    transform: (current: JqValue) => JqValue,
  ): JqValue {
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

        if (typeof idx === "number" && Array.isArray(val)) {
          const arr = [...val];
          const i = idx < 0 ? arr.length + idx : idx;
          if (i >= 0 && i < arr.length) {
            arr[i] = transform(arr[i]);
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
          obj[idx] = transform(obj[idx]);
          return obj;
        }
        return val;
      }

      case "Iterate": {
        const applyToContainer = (container: JqValue): JqValue => {
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

  const transformer = (current: JqValue): JqValue => {
    if (op === "|=") {
      return computeNewValue(current, current);
    }
    const newVals = evaluate(root, valueExpr, ctx);
    return computeNewValue(current, newVals[0] ?? null);
  };

  return updateRecursive(root, pathExpr, transformer);
}

function applyDel(root: JqValue, pathExpr: AstNode, ctx: EvalContext): JqValue {
  function deleteAt(val: JqValue, path: AstNode): JqValue {
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

function isTruthy(v: JqValue): boolean {
  return v !== null && v !== false;
}

function evalBinaryOp(
  value: JqValue,
  op: string,
  left: AstNode,
  right: AstNode,
  ctx: EvalContext,
): JqValue[] {
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
          if (typeof l === "number" && typeof r === "number") return l / r;
          if (typeof l === "string" && typeof r === "string") return l.split(r);
          return null;
        case "%":
          if (typeof l === "number" && typeof r === "number") return l % r;
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

function deepEqual(a: JqValue, b: JqValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function compare(a: JqValue, b: JqValue): number {
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
  value: JqValue,
  name: string,
  args: AstNode[],
  ctx: EvalContext,
): JqValue[] {
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
      if (Array.isArray(value)) return [value];
      if (value && typeof value === "object") return [Object.values(value)];
      return [null];

    case "length":
      if (typeof value === "string") return [value.length];
      if (Array.isArray(value)) return [value.length];
      if (value && typeof value === "object")
        return [Object.keys(value).length];
      if (value === null) return [0];
      return [null];

    case "utf8bytelength":
      if (typeof value === "string")
        return [new TextEncoder().encode(value).length];
      return [null];

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
      const starts = evaluate(value, args[0], ctx);
      if (args.length === 1) {
        const n = starts[0] as number;
        return Array.from({ length: n }, (_, i) => i);
      }
      const ends = evaluate(value, args[1], ctx);
      const start = starts[0] as number;
      const end = ends[0] as number;
      const result: number[] = [];
      for (let i = start; i < end; i++) result.push(i);
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
        const result: JqValue[] = [];
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
      const result: JqValue[] = [];
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
      const groups = new Map<string, JqValue[]>();
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
      let current: JqValue = value;
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
      const walk = (v: JqValue, path: (string | number)[]) => {
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
          let v: JqValue = value;
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
      const walk = (v: JqValue, path: (string | number)[]) => {
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
      return [
        value
          .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
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
      if (typeof value === "string") return [value.toLowerCase()];
      return [null];

    case "ascii_upcase":
      if (typeof value === "string") return [value.toUpperCase()];
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
      return [value.endsWith(suffix) ? value.slice(0, -suffix.length) : value];
    }

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
        for (let i = 0; i < value.length; i++) {
          if (deepEqual(value[i], needle)) result.push(i);
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
      return [!Number.isFinite(value as number)];

    case "nan":
      return [Number.isNaN(value as number)];

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
      return [{}];

    case "recurse": {
      if (args.length === 0) {
        const results: JqValue[] = [];
        const walk = (v: JqValue) => {
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
      const results: JqValue[] = [];
      const seen = new Set<string>();
      const walk = (v: JqValue) => {
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
      const walkFn = (v: JqValue): JqValue => {
        if (v && typeof v === "object") {
          if (seen.has(v as object)) return v;
          seen.add(v as object);
        }
        let transformed: JqValue;
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
      const result: JqValue[][] = [];
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
        return [String.fromCodePoint(...(value as number[]))];
      }
      return [null];

    case "tojson":
    case "tojsonstream":
      return [JSON.stringify(value)];

    case "fromjson": {
      if (typeof value === "string") {
        try {
          return [JSON.parse(value)];
        } catch {
          return [null];
        }
      }
      return [null];
    }

    case "limit": {
      if (args.length < 2) return [];
      const ns = evaluate(value, args[0], ctx);
      const n = ns[0] as number;
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
      const results: JqValue[] = [];
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
      const results: JqValue[] = [];
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

    default:
      throw new Error(`Unknown function: ${name}`);
  }
}

function compareJq(a: JqValue, b: JqValue): number {
  const typeOrder = (v: JqValue): number => {
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

function containsDeep(a: JqValue, b: JqValue): boolean {
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
  value: JqValue,
  path: (string | number)[],
  newVal: JqValue,
): JqValue {
  if (path.length === 0) return newVal;

  const [head, ...rest] = path;

  if (typeof head === "number") {
    const arr = Array.isArray(value) ? [...value] : [];
    while (arr.length <= head) arr.push(null);
    arr[head] = setPath(arr[head], rest, newVal);
    return arr;
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

function deletePath(value: JqValue, path: (string | number)[]): JqValue {
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
  value: JqValue,
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
