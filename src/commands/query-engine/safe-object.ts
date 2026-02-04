/**
 * Safe Object Utilities
 *
 * Defense-in-depth against JavaScript prototype pollution attacks.
 * These utilities prevent malicious JSON from accessing or modifying
 * the JavaScript prototype chain via keys like "__proto__", "constructor", etc.
 */

/**
 * Keys that could be used to access or pollute the prototype chain.
 * These should never be used as direct object property names when
 * setting values from untrusted input.
 */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Extended list of potentially dangerous keys for extra paranoia.
 * These include Node.js-specific and DOM-specific properties.
 */
const EXTENDED_DANGEROUS_KEYS = new Set([
  ...DANGEROUS_KEYS,
  // Additional properties that could cause issues in specific contexts
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "toString",
  "valueOf",
]);

/**
 * Check if a key is safe to use for object property access/assignment.
 * Returns true if the key is safe, false if it could cause prototype pollution.
 */
export function isSafeKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key);
}

/**
 * Check if a key is safe using the extended dangerous keys list.
 * More paranoid version that blocks additional Object.prototype methods.
 */
export function isSafeKeyStrict(key: string): boolean {
  return !EXTENDED_DANGEROUS_KEYS.has(key);
}

/**
 * Safely get a property from an object using hasOwnProperty check.
 * Returns undefined if the key is dangerous or doesn't exist as own property.
 */
export function safeGet<T>(obj: Record<string, T>, key: string): T | undefined {
  if (!isSafeKey(key)) {
    return undefined;
  }
  if (Object.hasOwn(obj, key)) {
    return obj[key];
  }
  return undefined;
}

/**
 * Safely set a property on an object.
 * Silently ignores dangerous keys to prevent prototype pollution.
 */
export function safeSet<T>(
  obj: Record<string, T>,
  key: string,
  value: T,
): void {
  if (isSafeKey(key)) {
    obj[key] = value;
  }
  // Dangerous keys are silently ignored - this matches jq behavior
  // where __proto__ is treated as a regular key that happens to not work
}

/**
 * Safely delete a property from an object.
 * Ignores dangerous keys.
 */
export function safeDelete<T>(obj: Record<string, T>, key: string): void {
  if (isSafeKey(key)) {
    delete obj[key];
  }
}

/**
 * Create a safe object from entries, filtering out dangerous keys.
 */
export function safeFromEntries<T>(
  entries: Iterable<[string, T]>,
): Record<string, T> {
  // Use null-prototype for additional safety
  const result: Record<string, T> = Object.create(null);
  for (const [key, value] of entries) {
    safeSet(result, key, value);
  }
  return result;
}

/**
 * Safely spread/assign properties from source to target.
 * Only copies own properties and filters dangerous keys.
 */
export function safeAssign<T>(
  target: Record<string, T>,
  source: Record<string, T>,
): Record<string, T> {
  for (const key of Object.keys(source)) {
    safeSet(target, key, source[key]);
  }
  return target;
}

/**
 * Create a shallow copy of an object, filtering dangerous keys.
 */
export function safeCopy<T extends Record<string, unknown>>(obj: T): T {
  const result = Object.create(null) as T;
  for (const key of Object.keys(obj)) {
    if (isSafeKey(key)) {
      (result as Record<string, unknown>)[key] = obj[key];
    }
  }
  return result;
}

/**
 * Check if object has own property safely (not inherited from prototype).
 */
export function safeHasOwn(obj: object, key: string): boolean {
  return Object.hasOwn(obj, key);
}
