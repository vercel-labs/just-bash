/**
 * String-related jq builtins
 *
 * Handles string manipulation functions like join, split, test, match, gsub, etc.
 */

import { ExecutionLimitError } from "../../../interpreter/errors.js";
import { createUserRegex } from "../../../regex/index.js";
import { utf8ByteLength } from "../../printf/escapes.js";
import type { EvalContext } from "../evaluator.js";
import type { AstNode } from "../parser.js";
import type { QueryValue } from "../value-operations.js";

type EvalFn = (
  value: QueryValue,
  ast: AstNode,
  ctx: EvalContext,
) => QueryValue[];

function resultLimit(ctx: EvalContext): number {
  return ctx.limits.maxArrayElements;
}

function stringLimit(ctx: EvalContext): number {
  return Math.min(ctx.limits.maxStringLength, ctx.limits.maxOutputSize);
}

function assertResultCount(ctx: EvalContext, count: number): void {
  const limit = resultLimit(ctx);
  if (!Number.isSafeInteger(count) || count < 0 || count > limit) {
    throw new ExecutionLimitError(
      `query result element limit exceeded (${limit})`,
      "array_elements",
    );
  }
}

function countLiteralSplit(
  value: string,
  separator: string,
  limit: number,
): number {
  if (value === "") return separator === "" ? 0 : 1;
  if (separator === "") return value.length;
  let count = 1;
  let offset = 0;
  while (true) {
    const match = value.indexOf(separator, offset);
    if (match < 0) return count;
    count++;
    if (count > limit) return count;
    offset = match + separator.length;
  }
}

/**
 * Handle string builtins that need evaluate function for arguments.
 * Returns null if the builtin name is not a string builtin handled here.
 */
export function evalStringBuiltin(
  value: QueryValue,
  name: string,
  args: AstNode[],
  ctx: EvalContext,
  evaluate: EvalFn,
): QueryValue[] | null {
  switch (name) {
    case "join": {
      if (!Array.isArray(value)) return [null];
      const seps = args.length > 0 ? evaluate(value, args[0], ctx) : [""];
      // jq: null values become empty strings, others get stringified
      // Also check for arrays/objects which should error
      for (const x of value) {
        if (Array.isArray(x) || (x !== null && typeof x === "object")) {
          throw new Error("cannot join: contains arrays or objects");
        }
      }
      // Handle generator args - each separator produces its own output
      assertResultCount(ctx, seps.length);
      return seps.map((sep) => {
        const separator = String(sep);
        let bytes = 0;
        for (let i = 0; i < value.length; i++) {
          const text =
            value[i] === null
              ? ""
              : typeof value[i] === "string"
                ? value[i]
                : String(value[i]);
          bytes += utf8ByteLength(text as string);
          if (i > 0) bytes += utf8ByteLength(separator);
          if (bytes > stringLimit(ctx)) {
            throw new ExecutionLimitError(
              `query string size limit exceeded (${stringLimit(ctx)} bytes)`,
              "string_length",
            );
          }
        }
        return value
          .map((item) =>
            item === null ? "" : typeof item === "string" ? item : String(item),
          )
          .join(separator);
      });
    }

    case "split": {
      if (typeof value !== "string" || args.length === 0) return [null];
      const seps = evaluate(value, args[0], ctx);
      const sep = String(seps[0]);
      assertResultCount(ctx, countLiteralSplit(value, sep, resultLimit(ctx)));
      return [value.split(sep)];
    }

    case "splits": {
      // Split string by regex, return each part as separate output
      if (typeof value !== "string" || args.length === 0) return [];
      const patterns = evaluate(value, args[0], ctx);
      const pattern = String(patterns[0]);
      try {
        const flags =
          args.length > 1 ? String(evaluate(value, args[1], ctx)[0]) : "g";
        // Ensure global flag is set for split
        const regex = createUserRegex(
          pattern,
          flags.includes("g") ? flags : `${flags}g`,
        );
        let count = 1;
        for (const match of regex.matchAll(value)) {
          count += Math.max(1, match.length);
          assertResultCount(ctx, count);
        }
        const split = regex.split(value);
        assertResultCount(ctx, split.length);
        return split;
      } catch (error) {
        if (error instanceof ExecutionLimitError) throw error;
        return [];
      }
    }

    case "scan": {
      // Find all regex matches in string
      if (typeof value !== "string" || args.length === 0) return [];
      const patterns = evaluate(value, args[0], ctx);
      const pattern = String(patterns[0]);
      try {
        const flags =
          args.length > 1 ? String(evaluate(value, args[1], ctx)[0]) : "";
        // Ensure global flag is set for matchAll
        const regex = createUserRegex(
          pattern,
          flags.includes("g") ? flags : `${flags}g`,
        );
        const results: QueryValue[] = [];
        for (const m of regex.matchAll(value)) {
          assertResultCount(ctx, results.length + 1);
          if (m.length > 1) {
            // Has capture groups - return array of captured groups (excluding full match)
            assertResultCount(ctx, m.length - 1);
            results.push(m.slice(1));
          } else {
            // No capture groups - return full match string
            results.push(m[0]);
          }
        }
        return results;
      } catch (error) {
        if (error instanceof ExecutionLimitError) throw error;
        return [];
      }
    }

    case "test": {
      if (typeof value !== "string" || args.length === 0) return [false];
      const patterns = evaluate(value, args[0], ctx);
      const pattern = String(patterns[0]);
      try {
        const flags =
          args.length > 1 ? String(evaluate(value, args[1], ctx)[0]) : "";
        return [createUserRegex(pattern, flags).test(value)];
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
        const re = createUserRegex(pattern, `${flags}d`);
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
        const re = createUserRegex(pattern, flags);
        const m = re.match(value);
        if (!m || !m.groups) return [Object.create(null)];
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
        return [createUserRegex(pattern, flags).replace(value, replacement)];
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
          createUserRegex(pattern, effectiveFlags).replace(value, replacement),
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
      throw new Error("trim input must be a string");

    case "ltrim":
      if (typeof value === "string") return [value.trimStart()];
      throw new Error("trim input must be a string");

    case "rtrim":
      if (typeof value === "string") return [value.trimEnd()];
      throw new Error("trim input must be a string");

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

    case "ascii":
      if (typeof value === "string" && value.length > 0) {
        return [value.charCodeAt(0)];
      }
      return [null];

    case "explode":
      if (typeof value === "string") {
        let count = 0;
        for (const _codePoint of value) {
          count++;
          assertResultCount(ctx, count);
        }
        return [Array.from(value).map((c) => c.codePointAt(0))];
      }
      return [null];

    case "implode":
      if (!Array.isArray(value)) {
        throw new Error("implode input must be an array");
      }
      {
        // jq: Invalid code points get replaced with Unicode replacement character (0xFFFD)
        const REPLACEMENT_CHAR = 0xfffd;
        const chars = (value as QueryValue[]).map((cp) => {
          // Check for non-numeric values
          if (typeof cp === "string") {
            throw new Error(
              `string (${JSON.stringify(cp)}) can't be imploded, unicode codepoint needs to be numeric`,
            );
          }
          if (typeof cp !== "number" || Number.isNaN(cp)) {
            throw new Error(
              `number (null) can't be imploded, unicode codepoint needs to be numeric`,
            );
          }
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

    default:
      return null;
  }
}
