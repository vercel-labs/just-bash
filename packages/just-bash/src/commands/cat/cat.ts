import { latin1FromBytes, readBytesFrom } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

const catHelp = {
  name: "cat",
  summary: "concatenate files and print on the standard output",
  usage: "cat [OPTION]... [FILE]...",
  options: [
    "-A, --show-all         equivalent to -vET",
    "-b, --number-nonblank  number nonempty output lines, overrides -n",
    "-e                     equivalent to -vE",
    "-E, --show-ends        display $ at end of each line",
    "-n, --number           number all output lines",
    "-s, --squeeze-blank    suppress repeated empty output lines",
    "-t                     equivalent to -vT",
    "-T, --show-tabs        display TAB characters as ^I",
    "-u                     (ignored)",
    "-v, --show-nonprinting use ^ and M- notation, except for LFD and TAB",
    "    --help             display this help and exit",
  ],
};

const argDefs = {
  number: { short: "n", long: "number", type: "boolean" as const },
  numberNonblank: {
    short: "b",
    long: "number-nonblank",
    type: "boolean" as const,
  },
  showEnds: { short: "E", long: "show-ends", type: "boolean" as const },
  showTabs: { short: "T", long: "show-tabs", type: "boolean" as const },
  showNonprinting: {
    short: "v",
    long: "show-nonprinting",
    type: "boolean" as const,
  },
  showAll: { short: "A", long: "show-all", type: "boolean" as const },
  squeeze: { short: "s", long: "squeeze-blank", type: "boolean" as const },
  vE: { short: "e", type: "boolean" as const },
  vT: { short: "t", type: "boolean" as const },
  ignored: { short: "u", type: "boolean" as const },
};

interface CatOptions {
  numberAll: boolean;
  numberNonblank: boolean;
  showEnds: boolean;
  showTabs: boolean;
  showNonprinting: boolean;
  squeeze: boolean;
}

export const catCommand: Command = {
  name: "cat",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(catHelp);
    }

    const parsed = parseArgs("cat", args, argDefs);
    if (!parsed.ok) return parsed.error;
    const f = parsed.result.flags;

    // Alias expansion: -A == -vET, -e == -vE, -t == -vT.
    const showEnds = f.showEnds || f.showAll || f.vE;
    const showTabs = f.showTabs || f.showAll || f.vT;
    const showNonprinting = f.showNonprinting || f.showAll || f.vE || f.vT;
    const squeeze = f.squeeze;
    // -b overrides -n.
    const numberNonblank = f.numberNonblank;
    const numberAll = f.number && !numberNonblank;

    const opts: CatOptions = {
      numberAll,
      numberNonblank,
      showEnds,
      showTabs,
      showNonprinting,
      squeeze,
    };

    const files = parsed.result.positional;

    const maxStringLength = ctx.limits.maxStringLength;
    const maxOutputSize = Math.min(maxStringLength, ctx.limits.maxOutputSize);
    const inputs = files.length === 0 ? ["-"] : files;
    let stderr = "";
    let exitCode = 0;
    let aggregateInputBytes = 0;

    let stdout: string;
    const transform =
      showEnds ||
      showTabs ||
      showNonprinting ||
      squeeze ||
      numberAll ||
      numberNonblank;

    let stream = "";
    for (const file of inputs) {
      try {
        const content =
          file === "-"
            ? ctx.stdin
            : await readBytesFrom(ctx.fs, ctx.fs.resolvePath(ctx.cwd, file));
        const rawContent = latin1FromBytes(content);
        const contentLength = rawContent.length;
        const inputLimit = transform ? maxStringLength : maxOutputSize;
        if (contentLength > inputLimit - aggregateInputBytes) {
          throw new ExecutionLimitError(
            `cat: ${transform ? "input" : "output"} size limit exceeded (${inputLimit} bytes)`,
            transform ? "string_length" : "output_size",
          );
        }
        aggregateInputBytes += contentLength;
        stream += rawContent;
      } catch (error) {
        rethrowFatalExecutionError(error);
        stderr += `cat: ${file}: No such file or directory\n`;
        exitCode = 1;
      }
    }

    if (!transform) {
      stdout = stream;
    } else {
      stdout = formatCat(
        stream,
        opts,
        maxOutputSize,
        ctx.limits.maxArrayElements,
      );
    }

    // cat is byte-clean: it forwards every byte of stdin / file content
    // unchanged. Mark stdout binary unconditionally so the pipeline glue
    // doesn't UTF-8-encode the bytes a second time when the next stage
    // happens to be a byte consumer, and so `> /file` redirects skip the
    // smart-utf8 encoding path that would otherwise double-encode.
    return {
      stdout,
      stderr,
      exitCode,
      stdoutEncoding: "binary",
    };
  },
};

/**
 * GNU `cat -v` byte transformation (per byte 0-255). LF and TAB are handled
 * by the caller and never passed here.
 */
function showNonprintingByte(byte: number): string {
  if (byte >= 32) {
    if (byte < 127) return String.fromCharCode(byte);
    if (byte === 127) return "^?";
    // byte >= 128
    const c = byte - 128;
    if (c >= 32) return c === 127 ? "M-^?" : `M-${String.fromCharCode(c)}`;
    return `M-^${String.fromCharCode(c + 64)}`;
  }
  // byte < 32 (TAB and LF already handled by caller)
  return `^${String.fromCharCode(byte + 64)}`;
}

/** Apply -v / -T transforms to a single line's bytes (excludes the newline). */
function transformLine(
  line: string,
  opts: CatOptions,
  maxLength: number,
): string {
  if (!opts.showNonprinting && !opts.showTabs) return line;
  let out = "";
  const append = (value: string): void => {
    if (value.length > maxLength - out.length) {
      throw new ExecutionLimitError(
        `cat: output size limit exceeded`,
        "output_size",
      );
    }
    out += value;
  };
  for (let i = 0; i < line.length; i++) {
    const b = line.charCodeAt(i);
    if (b === 9) {
      append(opts.showTabs ? "^I" : "\t");
    } else if (opts.showNonprinting) {
      append(showNonprintingByte(b));
    } else {
      append(line[i]);
    }
  }
  return out;
}

/**
 * Format the concatenated byte stream applying numbering, squeeze, and the
 * -v/-T/-E transforms in GNU per-line order.
 */
function formatCat(
  stream: string,
  opts: CatOptions,
  maxOutputSize: number,
  maxArrayElements: number,
): string {
  let partCount = 1;
  for (let i = 0; i < stream.length; i++) {
    if (stream.charCodeAt(i) === 10) partCount++;
    if (partCount > maxArrayElements) {
      throw new ExecutionLimitError(
        `cat: array element limit exceeded (${maxArrayElements})`,
        "array_elements",
      );
    }
  }
  const parts = stream.split("\n");
  let out = "";
  let lineNo = 1;
  let prevBlank = false;
  const append = (value: string): void => {
    if (value.length > maxOutputSize - out.length) {
      throw new ExecutionLimitError(
        `cat: output size limit exceeded (${maxOutputSize} bytes)`,
        "output_size",
      );
    }
    out += value;
  };

  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    const terminated = !isLast;
    const content = parts[i];

    // A trailing empty segment means the stream ended with a newline (or was
    // empty): there is no final partial line to emit.
    if (isLast && content === "") break;

    const blank = content === "";

    // Squeeze: collapse runs of adjacent blank lines into a single blank line.
    if (opts.squeeze && blank && prevBlank) {
      continue;
    }
    prevBlank = blank;

    let prefix = "";
    if (opts.numberAll || (opts.numberNonblank && !blank)) {
      prefix = `${String(lineNo).padStart(6, " ")}\t`;
      lineNo++;
    }

    const remaining = maxOutputSize - out.length - prefix.length;
    if (remaining < 0) {
      throw new ExecutionLimitError(
        `cat: output size limit exceeded (${maxOutputSize} bytes)`,
        "output_size",
      );
    }
    append(prefix + transformLine(content, opts, remaining));
    if (terminated) {
      append(opts.showEnds ? "$\n" : "\n");
    }
  }

  return out;
}

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "cat",
  flags: [
    { flag: "-n", type: "boolean" },
    { flag: "-A", type: "boolean" },
    { flag: "-b", type: "boolean" },
    { flag: "-s", type: "boolean" },
    { flag: "-v", type: "boolean" },
    { flag: "-e", type: "boolean" },
    { flag: "-t", type: "boolean" },
  ],
  stdinType: "text",
  needsFiles: true,
};
