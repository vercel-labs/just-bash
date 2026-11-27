/**
 * AWK Field Operations
 *
 * Handles $0, $1, $2, etc. field access and modification.
 */

import { utf8ByteLength } from "../../../encoding.js";
import { ExecutionLimitError } from "../../../interpreter/errors.js";
import { createUserRegex } from "../../../regex/index.js";
import type { AwkRuntimeContext } from "./context.js";
import { toAwkString } from "./type-coercion.js";
import type { AwkValue } from "./types.js";

/**
 * Splits a string into at most `limit` fields, as awk does for one FS.
 */
export type FieldSplitter = (input: string, limit?: number) => string[];

/** The default FS: runs of whitespace, ignoring leading and trailing ones. */
export const splitOnWhitespace: FieldSplitter = (input, limit) =>
  input.trim().split(/\s+/, limit).filter(Boolean);

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
  const fields = ctx.fieldSep(line, limit);
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
 * Compile FS, or a split() separator string, into a field splitter.
 */
export function compileFieldSeparator(fs: string): FieldSplitter {
  if (fs === " ") {
    return splitOnWhitespace;
  }
  const literal = fs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Any other single character separates fields literally, as in POSIX awk
  if (fs.length === 1) {
    return regexSplitter(literal);
  }
  try {
    return regexSplitter(fs);
  } catch {
    return regexSplitter(literal);
  }
}

// Callers bound the field count through the split limit, and ignored empty
// matches must not use up the regex's own result cap
const UNCAPPED = { maxResults: Number.MAX_SAFE_INTEGER };

/**
 * Split on a regex the way awk does: empty matches never separate fields,
 * except that an empty pattern splits into characters.
 */
export function regexSplitter(pattern: string): FieldSplitter {
  if (pattern === "") {
    const regex = createUserRegex("", "", UNCAPPED);
    return (input, limit) => regex.split(input, limit);
  }
  const regex = createUserRegex(pattern, "g", UNCAPPED);
  return (input, limit = Number.POSITIVE_INFINITY) => {
    if (input === "") return [];
    const fields: string[] = [];
    let start = 0;
    for (const match of regex.matchAll(input)) {
      if (fields.length >= limit) return fields;
      if (match[0] === "") continue;
      const index = match.index ?? 0;
      fields.push(input.slice(start, index));
      start = index + match[0].length;
    }
    if (fields.length < limit) fields.push(input.slice(start));
    return fields;
  };
}

/**
 * Update field separator and recompile regex.
 */
export function setFieldSeparator(ctx: AwkRuntimeContext, fs: string): void {
  ctx.FS = fs;
  ctx.fieldSep = compileFieldSeparator(fs);
}
