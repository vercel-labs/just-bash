import {
  decodeBytesToUtf8,
  encodeUtf8ToBytes,
  latin1FromBytes,
  unsafeBytesFromLatin1,
} from "../../encoding.js";
import type { ResourceLease } from "../../execution-scope.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { UserRegex } from "../../regex/index.js";
import type { ExecResult, RuntimeCommandContext } from "../../types.js";
import type { RgOptions } from "./rg-options.js";

/** Modes whose output depends only on the current line and its number. */
export function canStreamStdin(options: RgOptions): boolean {
  return !(
    options.multiline ||
    options.count ||
    options.countMatches ||
    options.filesWithMatches ||
    options.filesWithoutMatch ||
    options.quiet ||
    options.onlyMatching ||
    options.beforeContext ||
    options.afterContext ||
    options.column ||
    options.vimgrep ||
    options.byteOffset ||
    options.replace !== null ||
    options.passthru ||
    options.json ||
    options.stats ||
    options.maxCount !== Infinity
  );
}

export async function searchStdinStream(
  ctx: RuntimeCommandContext,
  regex: UserRegex,
  options: RgOptions,
): Promise<ExecResult> {
  const stdio = ctx.stdio;
  if (!stdio) throw new Error("rg: streaming stdin requires stdio");
  let pending = "";
  let pendingLease: ResourceLease | undefined;
  let lineNumber = 0;
  let matched = false;
  let work = 0;
  const chargeWork = (units: number) => {
    work += units;
    if (work > ctx.limits.maxLoopIterations) {
      throw new ExecutionLimitError(
        "rg: matching work limit exceeded",
        "iterations",
      );
    }
    ctx.executionScope?.consumeWork(units, "rg stdin");
  };
  const append = (bytes: string) => {
    if (bytes.length > ctx.limits.maxStringLength - pending.length) {
      throw new ExecutionLimitError(
        "rg: input line exceeds string limit",
        "string_length",
      );
    }
    pendingLease?.release();
    // Retained bytes, decoded line and formatted output can coexist.
    pendingLease = ctx.executionScope?.reserveBytes(
      "rg stdin line",
      (pending.length + bytes.length) * 3,
      "rg",
    );
    pending += bytes;
  };
  const emit = async (line: string) => {
    chargeWork(1);
    lineNumber++;
    regex.lastIndex = 0;
    if ((regex.exec(line) !== null) !== options.invertMatch) {
      matched = true;
      await stdio.write(
        encodeUtf8ToBytes(
          `${options.lineNumber ? `${lineNumber}:` : ""}${line}\n`,
        ),
      );
    } else {
      // Observe downstream closure even during a long run of nonmatches.
      await stdio.write(unsafeBytesFromLatin1(""));
    }
  };
  try {
    for (;;) {
      const chunk = await stdio.read();
      if (chunk === null) break;
      const bytes = latin1FromBytes(chunk);
      // The shared decoder falls back to Latin-1 for the WHOLE input on
      // invalid UTF-8. An ASCII prefix is independent of that decision;
      // after the first high byte, retain the tail until its encoding is known.
      if (/[^\x00-\x7f]/.test(bytes)) {
        append(bytes);
        for (;;) {
          const tail = await stdio.read();
          if (tail === null) break;
          append(latin1FromBytes(tail));
        }
        const prefix = lineNumber > 0 ? "\n" : "";
        const decoded = decodeBytesToUtf8(
          unsafeBytesFromLatin1(prefix + pending),
          ctx.limits.maxStringLength + 1,
        ).slice(prefix.length);
        chargeWork(Math.ceil(pending.length / 1024));
        let start = 0;
        for (
          let end = decoded.indexOf("\n");
          end >= 0;
          end = decoded.indexOf("\n", start)
        ) {
          await emit(decoded.slice(start, end));
          start = end + 1;
        }
        if (start < decoded.length) await emit(decoded.slice(start));
        pending = "";
        break;
      }
      chargeWork(Math.ceil(bytes.length / 1024));
      const chunkLease = ctx.executionScope?.reserveBytes(
        "rg stdin chunk",
        bytes.length,
        "rg",
      );
      try {
        let start = 0;
        for (
          let end = bytes.indexOf("\n");
          end >= 0;
          end = bytes.indexOf("\n", start)
        ) {
          append(bytes.slice(start, end));
          await emit(pending);
          pending = "";
          pendingLease?.release();
          pendingLease = undefined;
          start = end + 1;
        }
        append(bytes.slice(start));
      } finally {
        chunkLease?.release();
      }
    }
    if (pending.length > 0) await emit(pending);
    return { stdout: "", stderr: "", exitCode: matched ? 0 : 1 };
  } finally {
    pendingLease?.release();
  }
}
