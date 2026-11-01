// Automa modifications: patch-awk-records.mjs original interpreter record/capture seams.
import { decodeBytesToUtf8, utf8ByteLength } from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import { createUserRegex, type UserRegex } from "../../regex/index.js";
import { SecurityViolationError } from "../../security/defense-in-depth-box.js";
import type { RuntimeCommandContext } from "../../types.js";
import type { AwkRuntimeContext } from "./interpreter/context.js";
import type { AwkValue } from "./interpreter/types.js";
export interface RecordStream {
  text: string;
  offset: number;
  records: number;
  rs?: string;
  regex?: UserRegex;
}
export const countCharacters = (text: string, end = text.length): number => {
  let count = 0;
  for (let i = 0; i < end; count++) {
    const point = text.codePointAt(i) ?? 0;
    i += point > 0xffff ? 2 : 1;
  }
  return count;
};
export const createRecordStream = (
  ctx: AwkRuntimeContext,
  text: string,
): RecordStream => {
  const size = utf8ByteLength(text);
  if (size > ctx.inputLimit - ctx.inputBytes)
    throw new ExecutionLimitError(
      `aggregate input size limit exceeded (${ctx.inputLimit} bytes)`,
      "string_length",
    );
  ctx.inputBytes += size;
  return { text, offset: 0, records: 0 };
};
export const readRecord = (
  ctx: AwkRuntimeContext,
  input: RecordStream,
): string | null => {
  const text = input.text;
  let start = input.offset;
  const rs = ctx.RS ?? "\n";
  if (rs === "") while (text[start] === "\n") start++;
  if (start >= text.length) {
    input.offset = text.length;
    return null;
  }
  let end = -1,
    separator = "";
  if (rs === "") {
    end = text.indexOf("\n\n", start);
    if (end >= 0) {
      let after = end + 2;
      while (text[after] === "\n") after++;
      separator = text.slice(end, after);
    } else if (text.endsWith("\n")) {
      end = text.length - 1;
      separator = "\n";
    }
  } else if (countCharacters(rs) === 1) {
    end = text.indexOf(rs, start);
    if (end >= 0) separator = rs;
  } else {
    if (input.rs !== rs) {
      input.rs = rs;
      input.regex = createUserRegex(rs, "g");
    }
    const regex = input.regex;
    if (!regex) throw new Error("Missing record separator matcher");
    regex.lastIndex = start;
    let scans = 0;
    for (;;) {
      if (++scans > ctx.maxIterations)
        throw new ExecutionLimitError(
          `record separator scan limit exceeded (${ctx.maxIterations})`,
          "iterations",
        );
      const match = regex.exec(text);
      if (!match) break;
      if (match[0].length) {
        end = match.index;
        separator = match[0];
        break;
      }
      if (regex.lastIndex > text.length) break;
    }
  }
  if (++input.records > ctx.maxArrayElements)
    throw new ExecutionLimitError(
      `record array limit exceeded (${ctx.maxArrayElements})`,
      "array_elements",
    );
  if (end < 0) end = text.length;
  input.offset = end + separator.length;
  ctx.RT = separator;
  return text.slice(start, end);
};
export const setupMainInput = (
  ctx: AwkRuntimeContext,
  command: RuntimeCommandContext,
  files: string[],
  withDefenseContext: <T>(phase: string, op: () => Promise<T>) => Promise<T>,
): void => {
  ctx.inputLimit = Math.min(
    command.limits.maxInputBytes,
    command.limits.maxStringLength,
  );
  ctx.inputBytes = 0;
  let index = 0;
  let current: RecordStream | undefined;
  const operands = files.length ? files : [""];
  ctx.readMain = async () => {
    for (;;) {
      if (ctx.shouldNextFile) {
        current = undefined;
        ctx.shouldNextFile = false;
      }
      if (!current) {
        if (index >= operands.length) return null;
        const name = operands[index++];
        let text: string;
        if (!files.length || name === "-")
          text = decodeBytesToUtf8(command.stdin);
        else {
          const full = command.fs.resolvePath(command.cwd, name);
          try {
            if (
              (
                await withDefenseContext("input file stat", () =>
                  command.fs.stat(full),
                )
              ).size >
              ctx.inputLimit - ctx.inputBytes
            )
              throw new ExecutionLimitError(
                `aggregate input size limit exceeded (${ctx.inputLimit} bytes)`,
                "string_length",
              );
            text = await withDefenseContext("input file read", () =>
              command.fs.readFile(full),
            );
          } catch (error) {
            if (
              error instanceof ExecutionLimitError ||
              error instanceof SecurityViolationError
            )
              throw error;
            throw new Error(`${name}: No such file or directory`);
          }
        }
        current = createRecordStream(ctx, text);
        ctx.FILENAME = name;
        ctx.FNR = 0;
      }
      const record = readRecord(ctx, current);
      if (record !== null) return record;
      current = undefined;
    }
  };
};
export const arrayLength = (
  ctx: AwkRuntimeContext,
  name: string,
): number | undefined => {
  const seen = new Set();
  while (ctx.arrayAliases.has(name) && !seen.has(name)) {
    seen.add(name);
    name = ctx.arrayAliases.get(name) ?? name;
  }
  const array =
    name === "ARGV"
      ? ctx.ARGV
      : name === "ENVIRON"
        ? ctx.ENVIRON
        : ctx.arrays[name];
  if (!array) return undefined;
  const length = Object.keys(array).length;
  if (length > ctx.maxArrayElements)
    throw new ExecutionLimitError(
      `array element limit exceeded (${ctx.maxArrayElements})`,
      "array_elements",
    );
  return length;
};
// Upstream uses an empty scalar slot for unpassed local parameters. It has
// no separate untyped/scalar tag; do not reject that valid array destination.
export const setCaptures = (
  ctx: AwkRuntimeContext,
  name: string,
  match: RegExpExecArray | null,
  text: string,
): void => {
  const seen = new Set();
  while (ctx.arrayAliases.has(name) && !seen.has(name)) {
    seen.add(name);
    name = ctx.arrayAliases.get(name) ?? name;
  }
  if (name === "ARGV" || name === "ENVIRON")
    throw new Error("match() capture array must be an ordinary array");
  if (
    Object.hasOwn(ctx.vars, name) &&
    ctx.vars[name] !== "" &&
    !Object.hasOwn(ctx.arrays, name)
  )
    throw new Error("match() third argument must be an array, not a scalar");
  const indices = match?.indices ?? [];
  if (match && !match.indices)
    throw new Error("match() capture indices unavailable");
  const previous = Object.keys(ctx.arrays[name] ?? {}).length;
  const next: Record<string, AwkValue> = Object.create(null);
  let added = 0;
  const offsets = new Set<number>();
  if (match)
    for (let i = 0; i < match.length; i++) {
      if (match[i] == null) continue;
      added += 3;
      if (ctx.arrayElementCount - previous + added > ctx.maxArrayElements)
        throw new ExecutionLimitError(
          `array element limit exceeded (${ctx.maxArrayElements})`,
          "array_elements",
        );
      offsets.add(indices[i][0]);
      offsets.add(indices[i][1]);
    }
  // Map UTF-16 offsets to character offsets in one pass, not one prefix scan
  // per capture. Temporary metadata is bounded by the capture array quota.
  const positions = new Map<number, number>();
  let cursor = 0,
    characters = 0;
  for (const offset of [...offsets].sort((left, right) => left - right)) {
    while (cursor < offset) {
      cursor += (text.codePointAt(cursor) ?? 0) > 0xffff ? 2 : 1;
      characters++;
    }
    positions.set(offset, characters);
  }
  if (match)
    for (let i = 0; i < match.length; i++) {
      if (match[i] == null) continue;
      const [start, end] = indices[i];
      next[i] = match[i];
      next[`${i}${ctx.SUBSEP}start`] = (positions.get(start) ?? 0) + 1;
      next[`${i}${ctx.SUBSEP}length`] =
        (positions.get(end) ?? 0) - (positions.get(start) ?? 0);
    }
  ctx.arrays[name] = next;
  ctx.arrayElementCount += added - previous;
};
