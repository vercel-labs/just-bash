/**
 * Query Value Utilities
 *
 * Utility functions for working with jq/query values.
 */

import { ExecutionLimitError } from "../../interpreter/errors.js";
import {
  asQueryRecord,
  isSafeKey,
  nullPrototypeCopy,
  safeHasOwn,
  safeSet,
} from "./safe-object.js";

export type QueryValue = unknown;

/**
 * Check if a value is truthy in jq semantics.
 * In jq: false and null are falsy, everything else is truthy.
 */
export function isTruthy(v: QueryValue): boolean {
  return v !== false && v !== null;
}

/**
 * Deep equality check for query values.
 */
export function deepEqual(a: QueryValue, b: QueryValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Compare two values for sorting.
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function compare(a: QueryValue, b: QueryValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return 0;
}

/**
 * Deep merge two objects.
 * Values from b override values from a, except nested objects are merged recursively.
 * Filters out dangerous keys (__proto__, constructor, prototype) to prevent prototype pollution.
 * Uses null-prototype objects to prevent prototype pollution via inherited properties.
 */
export function deepMerge(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  options: { maxDepth?: number; visit?: () => void } = {},
): Record<string, unknown> {
  const maxDepth = options.maxDepth ?? 2000;
  const root = nullPrototypeCopy(a);
  const stack: Array<{
    target: Record<string, unknown>;
    source: Record<string, unknown>;
    depth: number;
  }> = [{ target: root, source: b, depth: 0 }];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame) break;
    if (frame.depth > maxDepth) {
      throw new ExecutionLimitError(
        `query depth limit exceeded (${maxDepth})`,
        "recursion",
      );
    }
    for (const key of Object.keys(frame.source)) {
      options.visit?.();
      if (!isSafeKey(key)) continue;

      const targetRec = safeHasOwn(frame.target, key)
        ? asQueryRecord(frame.target[key])
        : null;
      const sourceRec = asQueryRecord(frame.source[key]);
      if (targetRec && sourceRec) {
        const child = nullPrototypeCopy(targetRec);
        safeSet(frame.target, key, child);
        stack.push({
          target: child,
          source: sourceRec,
          depth: frame.depth + 1,
        });
      } else {
        safeSet(frame.target, key, frame.source[key]);
      }
    }
  }
  return root;
}

/**
 * Calculate the nesting depth of a value (array or object).
 */
export function getValueDepth(value: QueryValue, maxCheck = 3000): number {
  if (value === null || typeof value !== "object") return 0;
  if (maxCheck <= 1) return maxCheck;

  interface DepthFrame {
    value: QueryValue[] | Record<string, QueryValue>;
    keys?: string[];
    nextChild: number;
    pathDepth: number;
    maxChildDepth: number;
  }

  const createFrame = (
    current: QueryValue[] | Record<string, QueryValue>,
    pathDepth: number,
  ): DepthFrame => ({
    value: current,
    keys: Array.isArray(current) ? undefined : Object.keys(current),
    nextChild: 0,
    pathDepth,
    maxChildDepth: 0,
  });
  const childCount = (frame: DepthFrame): number =>
    frame.keys !== undefined
      ? frame.keys.length
      : (frame.value as QueryValue[]).length;
  const nextChild = (frame: DepthFrame): QueryValue => {
    if (frame.keys) {
      const key = frame.keys[frame.nextChild++];
      // @banned-pattern-ignore: key came from Object.keys(frame.value), so it is an own property
      return (frame.value as Record<string, QueryValue>)[key];
    }
    return (frame.value as QueryValue[])[frame.nextChild++];
  };

  // A global "seen" set mistakes ordinary sharing (such as `[input, input]`)
  // for a cycle. Track the active DFS path and memoize completed subgraphs so
  // valid DAGs retain their real depth while actual cycles still fail closed.
  const state = new WeakMap<object, "visiting" | "done">();
  const depths = new WeakMap<object, number>();
  const root = value as QueryValue[] | Record<string, QueryValue>;
  const stack: DepthFrame[] = [createFrame(root, 1)];
  state.set(root, "visiting");

  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    if (frame.nextChild < childCount(frame)) {
      const child = nextChild(frame);
      if (child === null || typeof child !== "object") continue;

      const childState = state.get(child);
      if (childState === "visiting") return maxCheck;
      if (childState === "done") {
        const childDepth = depths.get(child) ?? 0;
        if (frame.pathDepth + childDepth >= maxCheck) return maxCheck;
        frame.maxChildDepth = Math.max(frame.maxChildDepth, childDepth);
        continue;
      }

      const childPathDepth = frame.pathDepth + 1;
      if (childPathDepth >= maxCheck) return maxCheck;
      const childContainer = child as QueryValue[] | Record<string, QueryValue>;
      state.set(child, "visiting");
      stack.push(createFrame(childContainer, childPathDepth));
      continue;
    }

    const depth = frame.maxChildDepth + 1;
    depths.set(frame.value, depth);
    state.set(frame.value, "done");
    stack.pop();
    const parent = stack.at(-1);
    if (parent) {
      parent.maxChildDepth = Math.max(parent.maxChildDepth, depth);
    } else {
      return depth;
    }
  }

  return 0;
}

/**
 * Compare two values using jq's comparison semantics.
 * jq sorts by type first (null < bool < number < string < array < object),
 * then by value within type.
 */
export function compareJq(a: QueryValue, b: QueryValue): number {
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
  const aObj = asQueryRecord(a);
  const bObj = asQueryRecord(b);
  if (aObj && bObj) {
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

/**
 * Check if value a contains value b using jq's containment semantics.
 */
export function containsDeep(a: QueryValue, b: QueryValue): boolean {
  if (deepEqual(a, b)) return true;
  // jq: string contains substring check
  if (typeof a === "string" && typeof b === "string") {
    return a.includes(b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return b.every((bItem) => a.some((aItem) => containsDeep(aItem, bItem)));
  }
  const aObj = asQueryRecord(a);
  const bObj = asQueryRecord(b);
  if (aObj && bObj) {
    return Object.keys(bObj).every(
      (k) => safeHasOwn(aObj, k) && containsDeep(aObj[k], bObj[k]),
    );
  }
  return false;
}

// Lint probe: exercises "Raw Record<string, unknown> cast in query engine" banned pattern.
// @banned-pattern-ignore: lint rule probe — use asQueryRecord() instead
const _rawRecordCastProbe = undefined as unknown as Record<string, unknown>;
void _rawRecordCastProbe;
