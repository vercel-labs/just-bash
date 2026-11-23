/**
 * AWK Field Operations
 *
 * Handles $0, $1, $2, etc. field access and modification.
 */

import { utf8ByteLength } from "../../../encoding.js";
import { ExecutionLimitError } from "../../../interpreter/errors.js";
import { ConstantRegex, createUserRegex } from "../../../regex/index.js";
import type { AwkRuntimeContext } from "./context.js";
import { isAwkNumericString, toAwkString } from "./type-coercion.js";
import type { AwkValue } from "./types.js";

/**
 * Split a line into fields based on the field separator.
 * Stops one field past maxArrayElements so oversized records are rejected
 * without materializing every field.
 */
export function splitFields(ctx: AwkRuntimeContext, line: string): string[] {
  // Empty line always has 0 fields in AWK
  if (line === "") {
    return [];
  }
  const max = ctx.maxArrayElements;
  // String.prototype.split treats its limit as a uint32, so leave huge or
  // unlimited maxima unbounded rather than letting them wrap
  const limit = max < 0xfffffffe ? max + 1 : undefined;
  const fields =
    ctx.FS === " "
      ? // Default FS: split on runs of whitespace, skip leading/trailing
        line
          .trim()
          .split(/\s+/, limit)
          .filter(Boolean)
      : ctx.fieldSep.split(line, limit);
  if (fields.length > max) {
    throw new ExecutionLimitError(
      `field count limit exceeded (${max})`,
      "array_elements",
    );
  }
  // Fields re-split from a line are input-like: a numeric-looking one
  // is a strnum, whether the line came from a record, a $0 assignment,
  // or a sub/gsub rewrite of $0 (gawk marks them all the same way).
  // A field assigned a plain string later is unmarked by its own
  // assignment, so this set is rebuilt wholesale on every re-split.
  // Re-split fields are strings, never numbers: any numeric-field
  // record from before the re-split is dropped with it.
  if (!ctx.strnumFields) ctx.strnumFields = new Set();
  ctx.strnumFields.clear();
  ctx.numberFields?.clear();
  fields.forEach((field, index) => {
    if (isAwkNumericString(field)) ctx.strnumFields.add(index + 1);
  });
  return fields;
}

/**
 * Grow the fields array to at least `count` entries, padding with "".
 * Rejects growth beyond maxArrayElements (or a non-finite count, even when
 * the limit is Infinity) before allocating.
 */
export function ensureFieldCount(ctx: AwkRuntimeContext, count: number): void {
  if (Number.isFinite(count) && count <= ctx.fields.length) return;
  if (!Number.isFinite(count) || count > ctx.maxArrayElements) {
    throw new ExecutionLimitError(
      `field count limit exceeded (${ctx.maxArrayElements})`,
      "array_elements",
    );
  }
  // The padded record needs at least count - 1 separators, so reject growth
  // that could never be rebuilt before allocating the padding
  if (
    ctx.maxOutputSize > 0 &&
    (count - 1) * utf8ByteLength(ctx.OFS) > ctx.maxOutputSize
  ) {
    throw recordSizeError(ctx);
  }
  while (ctx.fields.length < count) {
    ctx.fields.push("");
  }
}

function recordSizeError(ctx: AwkRuntimeContext): ExecutionLimitError {
  return new ExecutionLimitError(
    `record size limit exceeded (${ctx.maxOutputSize} bytes)`,
    "string_length",
  );
}

/**
 * Rebuild $0 from the fields array, checking the joined size first.
 * A rebuilt $0 is a computed string, never a numeric string, however
 * numeric-looking it comes out: $0's own strnum flag is cleared here
 * (a field assignment that triggers this rebuild re-marks its own
 * field through the assignment path, not through $0).
 */
export function rebuildLine(ctx: AwkRuntimeContext): void {
  ctx.lineIsStrnum = false;
  if (ctx.maxOutputSize > 0) {
    let size = Math.max(0, ctx.fields.length - 1) * utf8ByteLength(ctx.OFS);
    for (const field of ctx.fields) {
      size += utf8ByteLength(field);
      if (size > ctx.maxOutputSize) break;
    }
    if (size > ctx.maxOutputSize) {
      throw recordSizeError(ctx);
    }
  }
  ctx.line = ctx.fields.join(ctx.OFS);
}

/**
 * Get a field value by index.
 * $0 is the whole line, $1 is first field, etc. A field assigned a
 * number keeps that number: gawk preserves it for later operations
 * (a CONVFMT sort key, a non-finite sort, arithmetic), so the
 * numeric record wins over the stored string spelling.
 */
export function getField(ctx: AwkRuntimeContext, index: number): AwkValue {
  if (index === 0) {
    return ctx.line;
  }
  if (index < 0 || index > ctx.fields.length) {
    return "";
  }
  if (ctx.numberFields?.has(index)) {
    return ctx.numberFields.get(index) as number;
  }
  return ctx.fields[index - 1] ?? "";
}

/**
 * Set a field value by index.
 * Setting $0 re-splits the line. Setting other fields rebuilds $0.
 */
export function setField(
  ctx: AwkRuntimeContext,
  index: number,
  value: AwkValue,
): void {
  if (index === 0) {
    // Setting $0 re-splits the line
    ctx.line = toAwkString(value);
    ctx.fields = splitFields(ctx, ctx.line);
    ctx.NF = ctx.fields.length;
  } else if (index > 0) {
    // Extend fields array if needed
    ensureFieldCount(ctx, index);
    ctx.fields[index - 1] = toAwkString(value);
    // A number assigned to a field stays a number (see numberFields):
    // record it, so later reads return the number instead of the
    // string spelling. A string assignment clears any earlier number.
    if (typeof value === "number") {
      if (!ctx.numberFields) ctx.numberFields = new Map();
      ctx.numberFields.set(index, value);
    } else {
      ctx.numberFields?.delete(index);
    }
    ctx.NF = ctx.fields.length;
    // Rebuild $0 from fields
    rebuildLine(ctx);
  }
}

/**
 * Update context with a new line (used when processing input).
 * A record read from input is a numeric string when it looks numeric,
 * so $0 itself carries that provenance until it is rebuilt or rewritten.
 */
export function setCurrentLine(ctx: AwkRuntimeContext, line: string): void {
  ctx.line = line;
  ctx.lineIsStrnum = isAwkNumericString(line);
  ctx.fields = splitFields(ctx, line);
  ctx.NF = ctx.fields.length;
}

/**
 * True when the field at the given 1-based index (0 is $0) currently
 * holds a numeric string. The set alone is not trusted: a stale entry
 * (a field dropped by an NF shrink, a value since overwritten without
 * re-marking) must not report a strnum for a value that no longer
 * looks numeric, so the current value is checked too.
 */
export function isStrnumField(ctx: AwkRuntimeContext, index: number): boolean {
  if (index === 0) {
    return ctx.lineIsStrnum && isAwkNumericString(ctx.line);
  }
  if (index < 1 || index > ctx.fields.length) return false;
  // A field holding a number is a number, not a numeric string — its
  // provenance is the number record, never this set.
  if (ctx.numberFields?.has(index)) return false;
  return (
    (ctx.strnumFields?.has(index) ?? false) &&
    isAwkNumericString(ctx.fields[index - 1])
  );
}

/**
 * Record (or clear) that a field holds a numeric string. Index 0 is
 * $0 itself. A field assigned a number is not marked here: setField
 * records it as a number instead, and isStrnumField reports false
 * for it — a number is not a numeric string.
 */
export function markStrnumField(
  ctx: AwkRuntimeContext,
  index: number,
  isStrnum: boolean,
): void {
  if (index === 0) {
    ctx.lineIsStrnum = isStrnum;
    return;
  }
  if (!ctx.strnumFields) ctx.strnumFields = new Set();
  if (isStrnum) ctx.strnumFields.add(index);
  else ctx.strnumFields.delete(index);
}

/**
 * Drop the number record for one field: the field now holds a plain
 * string (a sub/gsub rewrite, or a string assignment that bypassed
 * setField). A later read returns the stored string spelling.
 */
export function clearFieldNumber(ctx: AwkRuntimeContext, index: number): void {
  ctx.numberFields?.delete(index);
}

/**
 * Drop the number records for fields past `count`: an NF shrink drops
 * those fields, so a later re-growth must read "" for them, not a
 * stale number from before the shrink.
 */
export function clearFieldNumbersPast(
  ctx: AwkRuntimeContext,
  count: number,
): void {
  if (!ctx.numberFields) return;
  for (const index of [...ctx.numberFields.keys()]) {
    if (index > count) ctx.numberFields.delete(index);
  }
}

/**
 * Update field separator and recompile regex.
 */
export function setFieldSeparator(ctx: AwkRuntimeContext, fs: string): void {
  ctx.FS = fs;
  if (fs === " ") {
    ctx.fieldSep = new ConstantRegex(/\s+/);
  } else {
    try {
      ctx.fieldSep = createUserRegex(fs);
    } catch {
      ctx.fieldSep = createUserRegex(fs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
  }
}
