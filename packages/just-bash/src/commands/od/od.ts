/** Bounded byte dumping with GNU address, type, skip and repeat controls. */
import { BoundedStringBuilder } from "../../bounded-builder.js";
import { latin1FromBytes, readBytesFrom } from "../../encoding.js";
import type { ResourceLease } from "../../execution-scope.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

type Address = "o" | "x" | "d" | "n";
type ByteFormat = { kind: "x" | "u" | "o" | "c"; size: 1 | 2 };
function parseCount(value: string): number {
  const digits = value.replace(/^\+/, "");
  const result = /^0[xX][0-9a-fA-F]+$/.test(digits)
    ? Number(digits)
    : /^0[0-7]*$/.test(digits)
      ? Number.parseInt(digits, 8)
      : /^(?:0|[1-9][0-9]*)$/.test(digits)
        ? Number(digits)
        : NaN;
  return Number.isSafeInteger(result) && result >= 0 ? result : NaN;
}
const characterEscapes = new Map([
  [0, "\\0"],
  [7, "\\a"],
  [8, "\\b"],
  [9, "\\t"],
  [10, "\\n"],
  [11, "\\v"],
  [12, "\\f"],
  [13, "\\r"],
]);
function charByte(code: number): string {
  return (
    characterEscapes.get(code) ??
    (code >= 32 && code < 127
      ? String.fromCharCode(code)
      : code.toString(8).padStart(3, "0"))
  );
}
function pad(value: string, width: number, character = " "): string {
  // All native fields are <= 8 columns, independent of input length.
  if (!Number.isInteger(width) || width < 0 || width > 8)
    throw new Error("od: invalid field width");
  // @banned-pattern-ignore: width is checked above against fixed native field maximum 8.
  return value.padStart(width, character);
}
function nativeWidth(format: ByteFormat): number {
  return format.kind === "c"
    ? 4
    : format.kind === "x"
      ? format.size * 2 + 1
      : format.kind === "u"
        ? format.size === 1
          ? 4
          : 6
        : format.size === 1
          ? 4
          : 7;
}

async function odExecute(
  args: string[],
  ctx: RuntimeCommandContext,
): Promise<ExecResult> {
  if (hasHelpFlag(args))
    return showHelp({
      name: "od",
      summary: "dump bytes in selected formats",
      usage: "od [OPTION]... [FILE]...",
      options: [
        "-A RADIX, --address-radix=RADIX  addresses: o, x, d, or n (none)",
        "-t TYPE, --format=TYPE  x1/x2/u1/u2/o1/o2/c; may be repeated",
        "-c  display characters and escapes",
        "-N N, --read-bytes=N  read at most N bytes",
        "-j N, --skip-bytes=N  skip N input bytes",
        "-v, --output-duplicates  show every repeated line",
        "--help  display this help and exit",
      ],
    });
  let address: Address = "o";
  let readBytes = Infinity;
  let skipBytes = 0;
  let verbose = false;
  const formats: ByteFormat[] = [];
  const files: string[] = [];
  const fail = (message: string): ExecResult => ({
    stdout: "",
    stderr: `od: ${message}\n`,
    exitCode: 1,
  });
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      files.push(...args.slice(i + 1));
      break;
    }
    if (arg === "-v" || arg === "--output-duplicates") {
      verbose = true;
      continue;
    }
    if (arg === "-c") {
      formats.push({ kind: "c", size: 1 });
      continue;
    }
    let option: "N" | "j" | "t" | "A" | undefined;
    let value: string | undefined;
    for (const [short, long] of [
      ["N", "read-bytes"],
      ["j", "skip-bytes"],
      ["t", "format"],
      ["A", "address-radix"],
    ] as const) {
      if (arg === `-${short}` || arg === `--${long}`) {
        option = short;
        value = args[++i];
        break;
      }
      if (arg.startsWith(`-${short}`) && !arg.startsWith("--")) {
        option = short;
        value = arg.slice(2);
        break;
      }
      if (arg.startsWith(`--${long}=`)) {
        option = short;
        value = arg.slice(long.length + 3);
        break;
      }
    }
    if (option) {
      if (value === undefined) return fail("option requires an argument");
      if (option === "N" || option === "j") {
        const count = parseCount(value);
        if (Number.isNaN(count)) return fail(`invalid byte count: ${value}`);
        if (option === "N") readBytes = count;
        else skipBytes = count;
      } else if (option === "A") {
        if (!["o", "x", "d", "n"].includes(value))
          return fail(`invalid character '${value}' following -A`);
        address = value as Address;
      } else {
        let offset = 0;
        while (offset < value.length) {
          const kind = value[offset++];
          if (kind === "c") {
            formats.push({ kind, size: 1 });
            continue;
          }
          if (kind !== "x" && kind !== "u" && kind !== "o")
            return fail(`unsupported format '${value}'`);
          const digit = value[offset];
          if (digit !== "1" && digit !== "2")
            return fail(`unsupported format '${value}'`);
          formats.push({ kind, size: digit === "1" ? 1 : 2 });
          offset++;
        }
        if (!value) return fail("empty format");
      }
    } else if (arg.startsWith("-") && arg !== "-")
      return unknownOption("od", arg);
    else files.push(arg);
  }
  if (formats.length === 0) formats.push({ kind: "o", size: 2 });
  const leases: ResourceLease[] = [];
  try {
    // Raw byte strings may need two UTF-8 bytes in the generic builder. The
    // explicit counter below admits the actual bytes before retaining a slice.
    const input = new BoundedStringBuilder(
      ctx.limits.maxInputBytes * 2,
      "od input",
    );
    let retainedBytes = 0;
    let inputBytes = 0;
    let remainingSkip = skipBytes;
    let remainingRead = readBytes;
    let opened = false;
    let stdinRead = false;
    for (const operand of files.length ? files : ["-"]) {
      if (opened && remainingSkip === 0 && remainingRead === 0) break;
      opened = true;
      let content: string;
      let fileLease: ResourceLease | undefined;
      try {
        if (operand === "-") {
          content = stdinRead ? "" : latin1FromBytes(ctx.stdin);
          stdinRead = true;
        } else {
          const path = ctx.fs.resolvePath(ctx.cwd, operand);
          try {
            const stat = await ctx.fs.stat(path);
            if (stat.size > ctx.limits.maxInputBytes)
              throw new ExecutionLimitError(
                "od: input size limit exceeded",
                "string_length",
              );
            fileLease = ctx.executionScope?.reserveBytes(
              "od-file",
              stat.size * 3,
            );
            content = latin1FromBytes(await readBytesFrom(ctx.fs, path));
            if (content.length > stat.size)
              throw new ExecutionLimitError(
                "od: input grew while reading",
                "string_length",
              );
            ctx.executionScope?.consumeInput(content.length, "od");
          } catch (error) {
            rethrowFatalExecutionError(error);
            return fail(`${operand}: No such file or directory`);
          }
        }
        if (content.length > ctx.limits.maxInputBytes - inputBytes)
          throw new ExecutionLimitError(
            "od: aggregate input size limit exceeded",
            "string_length",
          );
        inputBytes += content.length;
        const skipped = Math.min(remainingSkip, content.length);
        remainingSkip -= skipped;
        const selected = content.slice(skipped, skipped + remainingRead);
        if (selected.length > ctx.limits.maxInputBytes - retainedBytes)
          throw new ExecutionLimitError(
            "od: input size limit exceeded",
            "string_length",
          );
        retainedBytes += selected.length;
        // A substring can retain the original backing string until formatting ends.
        const retainedLease = ctx.executionScope?.reserveBytes(
          "od-input",
          selected.length ? content.length * 2 : 0,
        );
        if (retainedLease) leases.push(retainedLease);
        input.append(selected);
        remainingRead -= selected.length;
      } finally {
        fileLease?.release();
      }
    }
    if (remainingSkip > 0)
      return fail("cannot skip past end of combined input");
    const bytes = input.build();
    const work = bytes.length * formats.length;
    if (!Number.isSafeInteger(work) || work > ctx.limits.maxTraversalWork)
      throw new ExecutionLimitError(
        `od: format work limit exceeded (${ctx.limits.maxTraversalWork})`,
        "iterations",
      );
    ctx.executionScope?.consumeWork(work, "od formatting");
    const output = new BoundedStringBuilder(
      Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength),
      "od",
    );
    const radix = address === "x" ? 16 : address === "d" ? 10 : 8;
    const addressWidth = address === "x" ? 6 : 7;
    const widthPerByte = formats.reduce(
      (max, format) => Math.max(max, nativeWidth(format) / format.size),
      0,
    );
    const bytesPerLine = 16;
    let previous = "";
    let repeating = false;
    for (let offset = 0; offset < bytes.length; offset += bytesPerLine) {
      const chunk = bytes.slice(offset, offset + bytesPerLine);
      if (!verbose && chunk.length === bytesPerLine && previous === chunk) {
        if (!repeating) output.append("*\n");
        repeating = true;
        continue;
      }
      previous = chunk;
      repeating = false;
      for (let index = 0; index < formats.length; index++) {
        const format = formats[index];
        const fieldWidth = Math.ceil(widthPerByte * format.size);
        if (address !== "n")
          output.append(
            index === 0
              ? pad((skipBytes + offset).toString(radix), addressWidth, "0")
              : pad("", addressWidth),
          );
        for (let column = 0; column < chunk.length; column += format.size) {
          const low = chunk.charCodeAt(column);
          const value =
            low +
            (format.size === 2 ? (chunk.charCodeAt(column + 1) || 0) * 256 : 0);
          const text =
            format.kind === "c"
              ? charByte(low)
              : format.kind === "x"
                ? pad(value.toString(16), format.size * 2, "0")
                : format.kind === "o"
                  ? pad(value.toString(8), format.size === 1 ? 3 : 6, "0")
                  : String(value);
          output.append(pad(text, fieldWidth));
        }
        output.append("\n");
      }
    }
    if (address !== "n")
      output
        .append(
          pad((skipBytes + bytes.length).toString(radix), addressWidth, "0"),
        )
        .append("\n");
    return { stdout: output.build(), stderr: "", exitCode: 0 };
  } finally {
    for (const lease of leases) lease.release();
  }
}

export const od: RuntimeCommand = { name: "od", execute: odExecute };

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";
export const flagsForFuzzing: CommandFuzzInfo = {
  name: "od",
  flags: [
    { flag: "-c", type: "boolean" },
    { flag: "-A", type: "value", valueHint: "string" },
    { flag: "-t", type: "value", valueHint: "string" },
    { flag: "-N", type: "value", valueHint: "number" },
    { flag: "-j", type: "value", valueHint: "number" },
    { flag: "-v", type: "boolean" },
  ],
  stdinType: "text",
  needsFiles: true,
};
