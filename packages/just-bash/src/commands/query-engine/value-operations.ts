/**
 * Query Value Utilities
 *
 * Utility functions for working with jq/query values.
 */

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
): Record<string, unknown> {
  const result = nullPrototypeCopy(a);
  for (const key of Object.keys(b)) {
    // Skip dangerous keys to prevent prototype pollution
    if (!isSafeKey(key)) continue;

    const resultRec = safeHasOwn(result, key)
      ? asQueryRecord(result[key])
      : null;
    const bRec = asQueryRecord(b[key]);
    if (resultRec && bRec) {
      safeSet(result, key, deepMerge(resultRec, bRec));
    } else {
      safeSet(result, key, b[key]);
    }
  }
  return result;
}

/**
 * Calculate the nesting depth of a value (array or object).
 */
export function getValueDepth(value: QueryValue, maxCheck = 3000): number {
  const stack: Array<{ value: QueryValue; depth: number }> = [
    { value, depth: 0 },
  ];
  const seenDepth = new WeakMap<object, number>();
  let maximum = 0;

  while (stack.length > 0) {
    const entry = stack.pop();
    if (!entry) break;
    const current = entry.value;
    if (current === null || typeof current !== "object") continue;

    const containerDepth = entry.depth + 1;
    if (containerDepth >= maxCheck) return maxCheck;
    maximum = Math.max(maximum, containerDepth);

    const previousDepth = seenDepth.get(current);
    if (previousDepth !== undefined) {
      // A repeated reference at the same or a deeper position is cyclic (or
      // an equivalent shared graph) and cannot be safely recursively walked.
      if (containerDepth >= previousDepth) return maxCheck;
      continue;
    }
    seenDepth.set(current, containerDepth);

    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i--) {
        stack.push({ value: current[i], depth: containerDepth });
      }
    } else {
      for (const key of Object.keys(current)) {
        // @banned-pattern-ignore: Object.keys returns own properties only
        stack.push({
          value: (current as Record<string, unknown>)[key],
          depth: containerDepth,
        });
      }
    }
  }

  return maximum;
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
