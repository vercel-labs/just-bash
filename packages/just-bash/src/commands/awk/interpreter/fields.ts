/**
 * AWK Field Operations
 *
 * Handles $0, $1, $2, etc. field access and modification.
 */

import { utf8ByteLength } from "../../../encoding.js";
import { ExecutionLimitError } from "../../../interpreter/errors.js";
import {
  ConstantRegex,
  createUserRegex,
  type RegexLike,
} from "../../../regex/index.js";
import type { AwkRuntimeContext } from "./context.js";
import { toAwkString } from "./type-coercion.js";
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
 */
export function rebuildLine(ctx: AwkRuntimeContext): void {
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
 * $0 is the whole line, $1 is first field, etc.
 */
export function getField(ctx: AwkRuntimeContext, index: number): AwkValue {
  if (index === 0) {
    return ctx.line;
  }
  if (index < 0 || index > ctx.fields.length) {
    return "";
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
    ctx.NF = ctx.fields.length;
    // Rebuild $0 from fields
    rebuildLine(ctx);
  }
}

/**
 * Update context with a new line (used when processing input).
 */
export function setCurrentLine(ctx: AwkRuntimeContext, line: string): void {
  ctx.line = line;
  ctx.fields = splitFields(ctx, line);
  ctx.NF = ctx.fields.length;
}

/**
 * Compile FS for splitFields. The regex result cap sits one past the field
 * limit so an oversized record fails instead of being silently truncated.
 */
export function compileFieldSeparator(
  fs: string,
  maxFields: number,
): RegexLike {
  if (fs === " ") {
    return new ConstantRegex(/\s+/);
  }
  const limits = {
    maxResults: Math.min(maxFields + 1, Number.MAX_SAFE_INTEGER),
  };
  const literal = fs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Any other single character separates fields literally, as in POSIX awk
  if (fs.length === 1) {
    return createUserRegex(literal, "", limits);
  }
  try {
    return createUserRegex(fs, "", limits);
  } catch {
    return createUserRegex(literal, "", limits);
  }
}

/**
 * Update field separator and recompile regex.
 */
export function setFieldSeparator(ctx: AwkRuntimeContext, fs: string): void {
  ctx.FS = fs;
  ctx.fieldSep = compileFieldSeparator(fs, ctx.maxArrayElements);
}
