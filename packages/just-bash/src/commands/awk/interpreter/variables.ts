/**
 * AWK Variable and Array Operations
 *
 * Handles user variables, built-in variables, and arrays.
 */

import { ExecutionLimitError } from "../../../interpreter/errors.js";
import type { AwkRuntimeContext } from "./context.js";
import { ensureFieldCount, rebuildLine, setFieldSeparator } from "./fields.js";
import { toAwkString, toNumber } from "./type-coercion.js";
import type { AwkValue } from "./types.js";

/**
 * Get a variable value. Handles built-in variables.
 */
export function getVariable(ctx: AwkRuntimeContext, name: string): AwkValue {
  switch (name) {
    case "FS":
      return ctx.FS;
    case "OFS":
      return ctx.OFS;
    case "ORS":
      return ctx.ORS;
    case "OFMT":
      return ctx.OFMT;
    case "CONVFMT":
      return ctx.CONVFMT;
    case "NR":
      return ctx.NR;
    case "NF":
      return ctx.NF;
    case "FNR":
      return ctx.FNR;
    case "FILENAME":
      return ctx.FILENAME;
    case "RSTART":
      return ctx.RSTART;
    case "RLENGTH":
      return ctx.RLENGTH;
    case "SUBSEP":
      return ctx.SUBSEP;
    case "ARGC":
      return ctx.ARGC;
  }

  return ctx.vars[name] ?? "";
}

/**
 * Set a variable value. Handles built-in variables with special behavior.
 */
export function setVariable(
  ctx: AwkRuntimeContext,
  name: string,
  value: AwkValue,
): void {
  switch (name) {
    case "FS":
      setFieldSeparator(ctx, toAwkString(value));
      return;
    case "OFS":
      ctx.OFS = toAwkString(value);
      return;
    case "ORS":
      ctx.ORS = toAwkString(value);
      return;
    case "OFMT":
      ctx.OFMT = toAwkString(value);
      return;
    case "CONVFMT":
      ctx.CONVFMT = toAwkString(value);
      return;
    case "NR":
      ctx.NR = Math.floor(toNumber(value));
      return;
    case "NF": {
      const newNF = Math.floor(toNumber(value));
      if (!Number.isFinite(newNF)) {
        // Rejects NaN and both infinities before touching fields
        ensureFieldCount(ctx, newNF);
      } else if (newNF < 0) {
        throw new Error("NF set to negative value");
      } else if (newNF < ctx.NF) {
        ctx.fields = ctx.fields.slice(0, newNF);
        rebuildLine(ctx);
      } else if (!(newNF <= ctx.NF)) {
        // Also taken when the current NF is NaN
        ensureFieldCount(ctx, newNF);
        rebuildLine(ctx);
      }
      ctx.NF = newNF;
      return;
    }
    case "FNR":
      ctx.FNR = Math.floor(toNumber(value));
      return;
    case "FILENAME":
      ctx.FILENAME = toAwkString(value);
      return;
    case "RSTART":
      ctx.RSTART = Math.floor(toNumber(value));
      return;
    case "RLENGTH":
      ctx.RLENGTH = Math.floor(toNumber(value));
      return;
    case "SUBSEP":
      ctx.SUBSEP = toAwkString(value);
      return;
    case "ARGC":
      // Assigning ARGC in BEGIN is the standard way to drop input
      // files (gawk reads ARGV[1..ARGC-1]); it used to land in
      // ctx.vars and never reach the field getVariable reads.
      ctx.ARGC = Math.floor(toNumber(value));
      // The bound changed, so the input loop's cached index list is
      // stale even though no ARGV entry moved.
      bumpArgvVersion(ctx);
      bumpArgvIndexVersion(ctx);
      return;
  }

  // A scalar write to a name that currently resolves to an array
  // store is a fatal type error in gawk ("attempt to use array `x' in
  // a scalar context") — with one exception: an omitted function
  // parameter is untyped until first used as an array, so its private
  // store is empty and the write converts it to a scalar instead
  // (assigning a scalar to a parameter that was already used as an
  // array still fatals, as does assigning one to any other array,
  // including ARGV/ENVIRON and an array emptied by `delete` or by
  // sorting an empty one: those names stay recorded in
  // ctx.arrayTypedNames, so a deleted store no longer hides the
  // type — review 6010326757).
  const resolved = resolveArrayName(ctx, name);
  // A name ever used as an array keeps that type even when its store
  // is currently empty or was deleted: check the record before the
  // store lookup below, so a missing store cannot hide the type.
  if (isArrayTyped(ctx, resolved)) {
    throw new Error(`attempt to use array \`${name}' in a scalar context`);
  }
  const store = getArrayStore(ctx, name, resolved);
  if (store !== undefined) {
    if (
      resolved.startsWith(LOCAL_ARRAY_PREFIX) &&
      Object.keys(store).length === 0
    ) {
      // Convert the untyped parameter to a scalar: drop its private
      // store and rebind every live frame entry for it to a scalar-only
      // name, so later reads (and isScalarVariable) see a scalar. The
      // value is also recorded under each of those names, so an outer
      // frame's variable reads the scalar assigned through an alias
      // (a how-function assigning through a parameter that aliases the
      // omitted local must make the caller's variable a scalar too).
      delete ctx.arrays[resolved];
      clearStrnumArray(ctx, resolved);
      const scalarName = nextLocalScalarName(ctx);
      for (const frame of ctx.arrayAliasFrames ?? []) {
        for (const [key, target] of frame) {
          if (target === resolved) {
            frame.set(key, scalarName);
            ctx.vars[key] = value;
          }
        }
      }
    } else {
      throw new Error(`attempt to use array \`${name}' in a scalar context`);
    }
  }

  ctx.vars[name] = value;
  // A scalar write through this path carries no provenance: only the
  // assignment evaluator (which can see the right-hand side) may
  // re-mark the variable as a numeric string afterwards.
  ctx.strnumVars?.delete(name);
}

/**
 * Prefixes for synthetic per-frame store names. A parameter that
 * receives no array argument gets a private store under one of these
 * names, so it can never resolve to an outer array of the same name:
 * LOCAL_ARRAY_PREFIX for an omitted parameter (a fresh empty array),
 * LOCAL_SCALAR_PREFIX for a parameter that received a scalar. The
 * NUL byte cannot appear in an AWK identifier, so no user array can
 * collide with either namespace; the sequence number keeps two live
 * frames' locals apart.
 */
export const LOCAL_ARRAY_PREFIX = "\0local-array:";
export const LOCAL_SCALAR_PREFIX = "\0local-scalar:";

/**
 * Resolve an array name through the innermost call frame's bindings.
 * Bindings are installed pre-resolved (see callUserFunction), so this
 * is a single lookup, never a chain: a frame's binding always names
 * the final store, and a name with no binding in the current frame is
 * a global array, not a caller's parameter. That is what keeps
 * swapped same-named parameters (a -> b, b -> a) from forming a
 * cycle that resolves to the wrong caller array.
 */
export function resolveArrayName(
  ctx: AwkRuntimeContext,
  array: string,
): string {
  const frames = ctx.arrayAliasFrames ?? [];
  const frame = frames[frames.length - 1];
  return frame?.get(array) ?? array;
}

/**
 * Push a fresh array-binding frame for a user-function call and
 * return it. The caller installs one binding per parameter after the
 * arguments were resolved in the caller's frame.
 */
export function pushArrayFrame(ctx: AwkRuntimeContext): Map<string, string> {
  if (!ctx.arrayAliasFrames) ctx.arrayAliasFrames = [];
  const frame = new Map<string, string>();
  ctx.arrayAliasFrames.push(frame);
  return frame;
}

/**
 * Drop the innermost array-binding frame when its call returns.
 */
export function popArrayFrame(ctx: AwkRuntimeContext): void {
  ctx.arrayAliasFrames?.pop();
}

/**
 * A fresh synthetic store name for an omitted parameter's private
 * empty local array. Unique among live frames, so a nested call
 * reusing the parameter name gets a different store.
 */
export function nextLocalArrayName(ctx: AwkRuntimeContext): string {
  const id = ctx.nextLocalArrayId ?? 0;
  ctx.nextLocalArrayId = id + 1;
  return `${LOCAL_ARRAY_PREFIX}${id}`;
}

/**
 * A fresh synthetic store name for a parameter that received a
 * scalar. No array is created under it: array built-ins reject the
 * parameter through isScalarVariable instead.
 */
export function nextLocalScalarName(ctx: AwkRuntimeContext): string {
  const id = ctx.nextLocalArrayId ?? 0;
  ctx.nextLocalArrayId = id + 1;
  return `${LOCAL_SCALAR_PREFIX}${id}`;
}

/**
 * Record that a resolved array name has been used as an array, so a
 * later scalar assignment to it stays the fatal type error gawk
 * reports even after its store is emptied or deleted.
 */
export function markArrayTyped(
  ctx: AwkRuntimeContext,
  resolvedName: string,
): void {
  if (!ctx.arrayTypedNames) ctx.arrayTypedNames = new Set();
  ctx.arrayTypedNames.add(resolvedName);
}

/**
 * True when a resolved array name has ever been used as an array.
 */
export function isArrayTyped(
  ctx: AwkRuntimeContext,
  resolvedName: string,
): boolean {
  return ctx.arrayTypedNames?.has(resolvedName) ?? false;
}

/**
 * Reject an array operation on a name that cannot be an array: a
 * scalar-only function parameter, a built-in scalar, or a variable
 * that currently holds a scalar value with no array store under its
 * resolved name. gawk reports all three as a fatal "attempt to use
 * scalar ... as an array" (review 6010326757): a scalar parameter
 * bound to an uninitialized variable must not silently become an
 * array, and neither must a scalar variable passed as an array
 * argument. Names with a live array store pass, as do uninitialized
 * names (no scalar value recorded), which become arrays on first use.
 * A name recorded as array-typed also passes even when its store is
 * momentarily absent: replaceArrayValues deletes the old store before
 * reinserting the sorted values, and a parameter slot holds "" in
 * ctx.vars while its array lives in the store — neither makes the
 * name a scalar, and gawk keeps the array type after `delete` too
 * (verified against gawk 5.2.1).
 */
export function assertArrayTarget(
  ctx: AwkRuntimeContext,
  rawName: string,
  resolvedName: string,
): void {
  if (resolvedName.startsWith(LOCAL_SCALAR_PREFIX)) {
    throw new Error(
      `attempt to use scalar parameter \`${rawName}' as an array`,
    );
  }
  if (isBuiltinScalarName(resolvedName)) {
    throw new Error(`attempt to use scalar \`${rawName}' as an array`);
  }
  if (
    !isArrayTyped(ctx, resolvedName) &&
    getArrayStore(ctx, rawName, resolvedName) === undefined &&
    ctx.vars[resolvedName] !== undefined
  ) {
    throw new Error(`attempt to use scalar \`${rawName}' as an array`);
  }
}

/**
 * The record that backs an array, or undefined when the array does not
 * exist. ARGV and ENVIRON live outside ctx.arrays (their elements are
 * read through the special cases in getArrayElement), so they are
 * resolved here too, under both the name as written and its
 * alias-resolved form.
 */
export function getArrayStore(
  ctx: AwkRuntimeContext,
  rawName: string,
  resolvedName: string,
): Record<string, AwkValue> | undefined {
  if (rawName === "ARGV" || resolvedName === "ARGV") return ctx.ARGV;
  if (rawName === "ENVIRON" || resolvedName === "ENVIRON") return ctx.ENVIRON;
  return ctx.arrays[resolvedName];
}

/**
 * Live element count of a prepopulated store, tracked incrementally
 * (see ctx.specialStoreSizes). Falls back to a one-off key scan for a
 * context built without the map, e.g. a hand-built test context.
 */
export function specialStoreSize(
  ctx: AwkRuntimeContext,
  store: Record<string, AwkValue>,
): number {
  if (store === ctx.ARGV) {
    return ctx.specialStoreSizes?.get("ARGV") ?? Object.keys(store).length;
  }
  if (store === ctx.ENVIRON) {
    return ctx.specialStoreSizes?.get("ENVIRON") ?? Object.keys(store).length;
  }
  return Object.keys(store).length;
}

/**
 * Record a prepopulated store's live element count after a bulk
 * write (replace/split) that already knows the new size. No-op for
 * program-created arrays.
 */
export function setSpecialStoreSize(
  ctx: AwkRuntimeContext,
  store: Record<string, AwkValue>,
  size: number,
): void {
  if (!ctx.specialStoreSizes) ctx.specialStoreSizes = new Map();
  if (store === ctx.ARGV) ctx.specialStoreSizes.set("ARGV", size);
  else if (store === ctx.ENVIRON) ctx.specialStoreSizes.set("ENVIRON", size);
}

/**
 * True when the named scalar variable currently holds a numeric
 * string (strnum). Built-in scalars are never strnums.
 */
export function isStrnumVar(ctx: AwkRuntimeContext, name: string): boolean {
  return ctx.strnumVars?.has(name) ?? false;
}

/**
 * Record (or clear) that a scalar variable holds a numeric string.
 * Built-in scalar names are ignored: they are formatted/compared
 * through their own accessors, never through this set — except
 * IGNORECASE, which has no dedicated slot (it lives in vars) and
 * whose strnum-ness decides its truthiness: a field's "0" is false,
 * a plain string's "0" is true.
 */
export function markStrnumVar(
  ctx: AwkRuntimeContext,
  name: string,
  isStrnum: boolean,
): void {
  if (BUILTIN_SCALARS.has(name) && name !== "IGNORECASE") return;
  if (!ctx.strnumVars) ctx.strnumVars = new Set();
  if (isStrnum) ctx.strnumVars.add(name);
  else ctx.strnumVars.delete(name);
}

/**
 * True when an array element (by resolved array name) holds a numeric
 * string (strnum).
 */
export function isStrnumArrayKey(
  ctx: AwkRuntimeContext,
  resolvedName: string,
  key: string,
): boolean {
  return ctx.strnumArrayKeys?.get(resolvedName)?.has(key) ?? false;
}

/**
 * Record (or clear) that an array element holds a numeric string.
 */
export function markStrnumArrayKey(
  ctx: AwkRuntimeContext,
  resolvedName: string,
  key: string,
  isStrnum: boolean,
): void {
  if (!ctx.strnumArrayKeys) ctx.strnumArrayKeys = new Map();
  if (isStrnum) {
    let keys = ctx.strnumArrayKeys.get(resolvedName);
    if (!keys) {
      keys = new Set();
      ctx.strnumArrayKeys.set(resolvedName, keys);
    }
    keys.add(key);
  } else {
    ctx.strnumArrayKeys.get(resolvedName)?.delete(key);
  }
}

/**
 * Replace an array's strnum-key set wholesale (split/asort rebuild
 * the array, so the old keys no longer apply).
 */
export function setStrnumArrayKeys(
  ctx: AwkRuntimeContext,
  resolvedName: string,
  keys: Set<string>,
): void {
  if (!ctx.strnumArrayKeys) ctx.strnumArrayKeys = new Map();
  if (keys.size > 0) ctx.strnumArrayKeys.set(resolvedName, keys);
  else ctx.strnumArrayKeys.delete(resolvedName);
}

/**
 * Drop an array's strnum-key set entirely (whole-array delete/replace
 * with unknown provenance; callers that know the new contents set the
 * keys again afterwards).
 */
export function clearStrnumArray(
  ctx: AwkRuntimeContext,
  resolvedName: string,
): void {
  ctx.strnumArrayKeys?.delete(resolvedName);
}

/**
 * Initial (prepopulated) element count of the store, or 0 for a
 * program-created array. Derived from the store's identity, not the
 * name, so an alias of ARGV/ENVIRON reports the same baseline.
 */
function prepopulatedSize(
  ctx: AwkRuntimeContext,
  store: Record<string, AwkValue>,
): number {
  if (store === ctx.ARGV) return ctx.arrayElementBaselines.get("ARGV") ?? 0;
  if (store === ctx.ENVIRON)
    return ctx.arrayElementBaselines.get("ENVIRON") ?? 0;
  return 0;
}

/**
 * Initial (prepopulated) element count of the array, or 0 for a
 * program-created array.
 */
export function initialSizeOfArray(
  ctx: AwkRuntimeContext,
  rawName: string,
  resolvedName: string,
): number {
  const store = getArrayStore(ctx, rawName, resolvedName);
  if (!store) return 0;
  return prepopulatedSize(ctx, store);
}

/**
 * How many of an array's elements consume the maxArrayElements
 * allowance: its size beyond the prepopulated contents. A regular
 * array's whole size counts; ARGV/ENVIRON count only past their
 * initial sizes, so replacing their prepopulated entries does not
 * consume the allowance. (Residual bound: each prepopulated store can
 * hold up to its initial size in program-added values without charge,
 * so the total user-held elements stay within maxArrayElements plus
 * the prepopulated sizes.)
 */
export function chargedSizeOfArray(
  ctx: AwkRuntimeContext,
  rawName: string,
  resolvedName: string,
): number {
  const store = getArrayStore(ctx, rawName, resolvedName);
  if (!store) return 0;
  return Math.max(
    0,
    specialStoreSize(ctx, store) - prepopulatedSize(ctx, store),
  );
}

export function isBuiltinScalarName(name: string): boolean {
  return BUILTIN_SCALARS.has(name);
}

/**
 * Whether IGNORECASE is enabled, the way gawk reads it. A number
 * follows numeric truth (0 is false); a numeric string (strnum, e.g.
 * copied from a field) does too, so a field's "0" is false. But any
 * other non-empty string enables it — even "0": gawk treats
 * IGNORECASE as a string flag here, not a numeric truth test, so a
 * plain string assignment IGNORECASE="0" is truthy. The generic
 * isTruthy would get the plain-"0" case wrong.
 */
export function isIgnoreCaseEnabled(ctx: AwkRuntimeContext): boolean {
  const value = getVariable(ctx, "IGNORECASE");
  if (typeof value === "number") return value !== 0;
  if (isStrnumVar(ctx, "IGNORECASE")) return toNumber(value) !== 0;
  return value !== "";
}

/**
 * True when the named variable is an initialized scalar: it holds a
 * scalar value (or is a built-in scalar) and has no array under its
 * alias-resolved name. Uninitialized names are not scalars — built-ins
 * like asort treat them as empty arrays, as before. A name that is
 * both a scalar and an array (possible only after a conflicting
 * assignment) counts as an array here.
 */
const BUILTIN_SCALARS = new Set([
  "FS",
  "OFS",
  "ORS",
  "OFMT",
  "CONVFMT",
  "NR",
  "NF",
  "FNR",
  "FILENAME",
  "RSTART",
  "RLENGTH",
  "SUBSEP",
  "ARGC",
  // Uninitialized but still a scalar: asort(IGNORECASE) is rejected
  // in gawk, not treated as an empty array.
  "IGNORECASE",
]);

export function isScalarVariable(
  ctx: AwkRuntimeContext,
  name: string,
): boolean {
  const resolved = resolveArrayName(ctx, name);
  // A parameter that received a scalar is bound to a synthetic
  // scalar-only name: it is a scalar even when an outer array of
  // the same name exists.
  if (resolved.startsWith(LOCAL_SCALAR_PREFIX)) return true;
  if (resolved === "ARGV" || resolved === "ENVIRON") return false;
  if (ctx.arrays[resolved] !== undefined) return false;
  if (BUILTIN_SCALARS.has(resolved)) return true;
  return ctx.vars[resolved] !== undefined;
}

/**
 * Record that ARGV (or its ARGC bound) may have changed, so the input
 * loop refreshes its cached list of present indices. Bumped on every
 * insert, delete, replacement of an ARGV element, on replacing the
 * whole store, and on every ARGC assignment — matching the contract
 * documented on ctx.argvVersion. Replacing an existing entry bumps
 * even though the index set is unchanged and the loop reads each
 * entry fresh when its turn comes: the bump keeps the version honest
 * so a future loop change cannot read stale entries (review
 * 6009811820 corrected the earlier no-bump-on-replacement claim).
 */
export function bumpArgvVersion(ctx: AwkRuntimeContext): void {
  ctx.argvVersion = (ctx.argvVersion ?? 0) + 1;
}

/**
 * Record that the SET of present ARGV indices may have changed, so
 * the input loop refreshes its cached sorted index list. Bumped only
 * on insert, delete, whole-store replacement, and ARGC assignment —
 * never when an existing entry's value is replaced (review
 * 6010326757): a replacement cannot change which files are read, so
 * invalidating the cache on it forces a full key scan and sort after
 * every file that updates an existing ARGV value. Callers that change
 * the key set bump both versions; value replacements bump only
 * argvVersion.
 */
export function bumpArgvIndexVersion(ctx: AwkRuntimeContext): void {
  ctx.argvIndexVersion = (ctx.argvIndexVersion ?? 0) + 1;
}

/**
 * Replace an array's contents with the given values, reindexed 1..n.
 * ARGV and ENVIRON are stored outside ctx.arrays; only the values
 * beyond their prepopulated contents are charged to arrayElementCount
 * (their initial sizes are exempt, so a small limit still leaves room
 * for program arrays). Regular arrays go through deleteArray and
 * setArrayElement so the element count stays exact.
 */
export function replaceArrayValues(
  ctx: AwkRuntimeContext,
  rawName: string,
  values: AwkValue[],
  resolvedName: string = resolveArrayName(ctx, rawName),
): void {
  // Replacing an array's contents uses it as an array, so the name
  // keeps its array type even if the replacement empties it.
  markArrayTyped(ctx, resolvedName);
  const store = getArrayStore(ctx, rawName, resolvedName);
  if (store !== undefined && (store === ctx.ARGV || store === ctx.ENVIRON)) {
    const oldCharged = chargedSizeOfArray(ctx, rawName, resolvedName);
    const newCharged = Math.max(
      0,
      values.length - prepopulatedSize(ctx, store),
    );
    if (
      ctx.arrayElementCount - oldCharged + newCharged >
      ctx.maxArrayElements
    ) {
      throw new ExecutionLimitError(
        `array element limit exceeded (${ctx.maxArrayElements})`,
        "array_elements",
      );
    }
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    for (let i = 0; i < values.length; i++) {
      store[String(i + 1)] = values[i];
    }
    setSpecialStoreSize(ctx, store, values.length);
    // The whole store was replaced: its index set may have changed.
    // Only ARGV affects the input loop; an ENVIRON replacement must
    // not invalidate the cached index list.
    if (store === ctx.ARGV) {
      bumpArgvVersion(ctx);
      bumpArgvIndexVersion(ctx);
    }
    // The incoming values carry no provenance here; callers that know
    // it (asort) set the destination's strnum keys again afterwards.
    clearStrnumArray(ctx, resolvedName);
    // Clamped at zero: a context built without baselines (e.g.
    // hand-built in a test) can otherwise drive the count negative.
    ctx.arrayElementCount = Math.max(
      0,
      ctx.arrayElementCount - oldCharged + newCharged,
    );
    return;
  }
  // deleteArray and setArrayElement resolve the name themselves, so
  // they take the raw name: passing the already-resolved store name
  // would resolve it a second time, and a resolved name can itself
  // be a parameter name bound in the current frame (swapped
  // parameters), which would land the values in the wrong array.
  deleteArray(ctx, rawName);
  for (let i = 0; i < values.length; i++) {
    setArrayElement(ctx, rawName, String(i + 1), values[i]);
  }
}

/**
 * Get an array element value. The name is resolved through aliases
 * first, so an alias of ARGV or ENVIRON reads the store that built-ins
 * like asort change, instead of a shadow array under the alias name.
 */
export function getArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
): AwkValue {
  const resolvedArray = resolveArrayName(ctx, array);
  // Reading an element uses the name as an array, even for a missing
  // key of an uninitialized array (gawk creates the array on read).
  assertArrayTarget(ctx, array, resolvedArray);
  markArrayTyped(ctx, resolvedArray);
  const store = getArrayStore(ctx, array, resolvedArray);
  return store?.[key] ?? "";
}

/**
 * Set an array element value. An alias of ARGV or ENVIRON writes the
 * real store (with the element-limit check and count), so a write
 * through a function parameter stays visible to later reads.
 */
export function setArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
  value: AwkValue,
): void {
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  assertArrayTarget(ctx, array, resolvedArray);
  markArrayTyped(ctx, resolvedArray);
  const store = getArrayStore(ctx, array, resolvedArray);
  if (store !== undefined && (store === ctx.ARGV || store === ctx.ENVIRON)) {
    if (!(key in store)) {
      // Only elements beyond the prepopulated contents consume the
      // allowance: the initial ARGV/ENVIRON entries are exempt, so a
      // small maxArrayElements still leaves room for program arrays.
      // The store size is tracked incrementally (see
      // ctx.specialStoreSizes): rescanning the keys on every insert
      // made filling ARGV/ENVIRON quadratic.
      const size = specialStoreSize(ctx, store);
      if (size >= prepopulatedSize(ctx, store)) {
        if (ctx.arrayElementCount >= ctx.maxArrayElements) {
          throw new ExecutionLimitError(
            `array element limit exceeded (${ctx.maxArrayElements})`,
            "array_elements",
          );
        }
        ctx.arrayElementCount++;
      }
      setSpecialStoreSize(ctx, store, size + 1);
      // A new key appeared: the input loop's cached index list is
      // stale. Only ARGV affects the loop; an ENVIRON insert must
      // not invalidate it.
      if (store === ctx.ARGV) {
        bumpArgvVersion(ctx);
        bumpArgvIndexVersion(ctx);
      }
    } else if (store === ctx.ARGV) {
      // Replacing an existing ARGV entry bumps argvVersion too
      // (review 6009811820): the index set is unchanged and the loop
      // reads each entry fresh, but the version must reflect every
      // ARGV mutation, as ctx.argvVersion documents. The index
      // version is deliberately NOT bumped here (review 6010326757):
      // a replacement cannot change which files are read, so it must
      // not force a full key scan and sort after every file.
      bumpArgvVersion(ctx);
    }
    store[key] = value;
    // The new value carries no provenance at this layer; the
    // assignment evaluator re-marks the key when the right-hand side
    // is a field or a numeric-string variable.
    markStrnumArrayKey(ctx, resolvedArray, key, false);
    return;
  }
  if (!ctx.arrays[resolvedArray]) {
    // Use null-prototype to prevent prototype pollution with user-controlled keys
    ctx.arrays[resolvedArray] = Object.create(null);
  }
  if (!(key in ctx.arrays[resolvedArray])) {
    if (ctx.arrayElementCount >= ctx.maxArrayElements) {
      throw new ExecutionLimitError(
        `array element limit exceeded (${ctx.maxArrayElements})`,
        "array_elements",
      );
    }
    ctx.arrayElementCount++;
  }
  ctx.arrays[resolvedArray][key] = value;
  // As in the special-store branch, the assignment evaluator re-marks
  // the key when the right-hand side carries numeric-string provenance.
  markStrnumArrayKey(ctx, resolvedArray, key, false);
}

/**
 * Check if an array element exists. Resolves aliases first, so an alias
 * of ARGV or ENVIRON checks the real store.
 */
export function hasArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
): boolean {
  const resolvedArray = resolveArrayName(ctx, array);
  assertArrayTarget(ctx, array, resolvedArray);
  markArrayTyped(ctx, resolvedArray);
  const store = getArrayStore(ctx, array, resolvedArray);
  return store?.[key] !== undefined;
}

/**
 * Delete an array element. Resolves aliases first, so deleting through
 * an alias of ARGV or ENVIRON removes the element from the real store
 * and keeps the element count exact.
 */
export function deleteArrayElement(
  ctx: AwkRuntimeContext,
  array: string,
  key: string,
): void {
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  assertArrayTarget(ctx, array, resolvedArray);
  markArrayTyped(ctx, resolvedArray);
  const store = getArrayStore(ctx, array, resolvedArray);
  if (store !== undefined && (store === ctx.ARGV || store === ctx.ENVIRON)) {
    if (key in store) {
      // Only a charged element frees allowance when deleted: while the
      // store still holds more than its prepopulated size, the deleted
      // key counts as a program-added one.
      const size = specialStoreSize(ctx, store);
      if (size > prepopulatedSize(ctx, store)) {
        ctx.arrayElementCount = Math.max(0, ctx.arrayElementCount - 1);
      }
      delete store[key];
      setSpecialStoreSize(ctx, store, size - 1);
      // Only ARGV affects the input loop's cached index list, and a
      // deletion changes the key set, so both versions bump.
      if (store === ctx.ARGV) {
        bumpArgvVersion(ctx);
        bumpArgvIndexVersion(ctx);
      }
      markStrnumArrayKey(ctx, resolvedArray, key, false);
    }
    return;
  }
  if (ctx.arrays[resolvedArray]) {
    if (key in ctx.arrays[resolvedArray]) ctx.arrayElementCount--;
    delete ctx.arrays[resolvedArray][key];
    markStrnumArrayKey(ctx, resolvedArray, key, false);
  }
}

/**
 * Delete an entire array. Resolves aliases first, so deleting ARGV or
 * ENVIRON (directly or through an alias) clears the real store and
 * keeps the element count exact.
 */
export function deleteArray(ctx: AwkRuntimeContext, array: string): void {
  // Resolve aliases for function parameter passing
  const resolvedArray = resolveArrayName(ctx, array);
  assertArrayTarget(ctx, array, resolvedArray);
  markArrayTyped(ctx, resolvedArray);
  const store = getArrayStore(ctx, array, resolvedArray);
  if (store !== undefined && (store === ctx.ARGV || store === ctx.ENVIRON)) {
    // Only the charged part (beyond the prepopulated contents) frees
    // allowance; deleting prepopulated entries frees none.
    ctx.arrayElementCount = Math.max(
      0,
      ctx.arrayElementCount - chargedSizeOfArray(ctx, array, resolvedArray),
    );
    for (const key of Object.keys(store)) {
      delete store[key];
    }
    setSpecialStoreSize(ctx, store, 0);
    // Only ARGV affects the input loop's cached index list, and a
    // whole-store delete changes the key set, so both versions bump.
    if (store === ctx.ARGV) {
      bumpArgvVersion(ctx);
      bumpArgvIndexVersion(ctx);
    }
    clearStrnumArray(ctx, resolvedArray);
    return;
  }
  ctx.arrayElementCount -= Object.keys(ctx.arrays[resolvedArray] ?? {}).length;
  delete ctx.arrays[resolvedArray];
  clearStrnumArray(ctx, resolvedArray);
}
