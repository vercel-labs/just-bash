import { ExecutionLimitError } from "../../interpreter/errors.js";
import {
  assertQueryResultCapacity,
  chargeQueryWork,
  type EvalContext,
} from "./evaluator.js";
import { asQueryRecord } from "./safe-object.js";
import type { QueryValue } from "./value-operations.js";

/** Compare containers iteratively, ignoring object key order but preserving array order. */
function equalContainers(
  left: QueryValue,
  right: QueryValue,
  ctx: EvalContext,
): boolean {
  const pending = [{ left, right, depth: 0 }];
  while (pending.length > 0) {
    chargeQueryWork(ctx);
    const pair = pending.pop();
    if (!pair) break;
    if (pair.depth > ctx.limits.maxDepth) {
      throw new ExecutionLimitError(
        `query depth limit exceeded (${ctx.limits.maxDepth})`,
        "recursion",
      );
    }
    const { left: a, right: b } = pair;
    if (a === b && (a === null || typeof a !== "object")) continue;
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      chargeQueryWork(ctx, a.length);
      for (let i = 0; i < a.length; i++) {
        pending.push({ left: a[i], right: b[i], depth: pair.depth + 1 });
      }
      continue;
    }
    const aObj = asQueryRecord(a);
    const bObj = asQueryRecord(b);
    if (!aObj || !bObj) return false;
    const keys = Object.keys(aObj);
    chargeQueryWork(ctx, keys.length);
    const rightKeys = Object.keys(bObj);
    chargeQueryWork(ctx, rightKeys.length);
    if (keys.length !== rightKeys.length) return false;
    for (const key of keys) {
      if (!Object.hasOwn(bObj, key)) return false;
      pending.push({
        left: aObj[key],
        right: bObj[key],
        depth: pair.depth + 1,
      });
    }
  }
  return true;
}

export function subtractArrays(
  left: QueryValue[],
  right: QueryValue[],
  ctx: EvalContext,
): QueryValue[] {
  const primitives = new Set<QueryValue>();
  const containers: QueryValue[] = [];
  chargeQueryWork(ctx, right.length);
  for (const value of right) {
    if (value !== null && typeof value === "object") containers.push(value);
    else if (!Number.isNaN(value)) primitives.add(value);
  }
  const result: QueryValue[] = [];
  for (const value of left) {
    chargeQueryWork(ctx);
    const removed =
      value !== null && typeof value === "object"
        ? containers.some((candidate) => equalContainers(value, candidate, ctx))
        : primitives.has(value);
    if (!removed) {
      assertQueryResultCapacity(ctx, result.length);
      result.push(value);
    }
  }
  return result;
}
