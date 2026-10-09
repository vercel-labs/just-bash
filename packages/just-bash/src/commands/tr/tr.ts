import {
  decodeBytesToUtf8,
  encodeUtf8ToBytes,
  latin1FromBytes,
} from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { sanitizeErrorMessage } from "../../fs/sanitize-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { createStringBuilder } from "../../utils/string-builder.js";
import { hasHelpFlag, showHelp } from "../help.js";

const trHelp = {
  name: "tr",
  summary: "translate or delete characters",
  usage: "tr [OPTION]... SET1 [SET2]",
  options: [
    "-c, -C, --complement   use the complement of SET1",
    "-d, --delete           delete characters in SET1",
    "-s, --squeeze-repeats  squeeze repeated characters",
    "    --help             display this help and exit",
  ],
  description: `SET syntax:
  a-z         character range
  [:alnum:]   all letters and digits
  [:alpha:]   all letters
  [:digit:]   all digits
  [:lower:]   all lowercase letters
  [:upper:]   all uppercase letters
  [:space:]   all whitespace
  [:blank:]   horizontal whitespace
  [:punct:]   all punctuation
  [:print:]   all printable characters
  [:graph:]   all printable characters except space
  [:cntrl:]   all control characters
  [:xdigit:]  all hexadecimal digits
  \\NNN       character with octal value NNN (1 to 3 digits)
  \\\\, \\a, \\b, \\f, \\n, \\r, \\t, \\v  escape sequences`,
};

// POSIX character class definitions (Map prevents prototype pollution)
const POSIX_CLASSES = new Map<string, string>([
  [
    "[:alnum:]",
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  ],
  ["[:alpha:]", "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"],
  ["[:blank:]", " \t"],
  [
    "[:cntrl:]",
    Array.from({ length: 32 }, (_, i) => String.fromCharCode(i))
      .join("")
      .concat(String.fromCharCode(127)),
  ],
  ["[:digit:]", "0123456789"],
  [
    "[:graph:]",
    Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).join(""),
  ],
  ["[:lower:]", "abcdefghijklmnopqrstuvwxyz"],
  [
    "[:print:]",
    Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join(""),
  ],
  ["[:punct:]", "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~"],
  ["[:space:]", " \t\n\r\f\v"],
  ["[:upper:]", "ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
  ["[:xdigit:]", "0123456789ABCDEFabcdef"],
]);

// Backslash escapes in a SET (Map prevents prototype pollution)
const ESCAPES = new Map<string, string>([
  ["a", "\x07"],
  ["b", "\b"],
  ["f", "\f"],
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ["v", "\v"],
]);

const isOctalDigit = (ch: string | undefined): boolean =>
  ch !== undefined && ch >= "0" && ch <= "7";

/**
 * Read one character of a SET starting at `i`, decoding a backslash escape.
 * `\NNN` is one to three octal digits; like GNU tr, a third digit is only
 * taken when the value still fits in a byte, so `\400` is `\40` then `0`.
 * Any other escaped character stands for itself, and a trailing backslash
 * is a literal backslash.
 */
function readSetChar(set: string, i: number): { char: string; next: number } {
  if (set[i] !== "\\" || i + 1 >= set.length) {
    return { char: set[i], next: i + 1 };
  }
  const next = set[i + 1];
  if (isOctalDigit(next)) {
    let value = 0;
    let j = i + 1;
    while (j < i + 4 && isOctalDigit(set[j])) {
      const candidate = value * 8 + (set.charCodeAt(j) - 48);
      if (candidate > 0o377) break;
      value = candidate;
      j++;
    }
    return { char: String.fromCharCode(value), next: j };
  }
  return { char: ESCAPES.get(next) ?? next, next: i + 2 };
}

/** Whether a SET names a byte above `\177` with an octal escape. */
function hasHighOctalEscape(set: string): boolean {
  for (let i = 0; i < set.length; ) {
    const { char, next } = readSetChar(set, i);
    if (
      set[i] === "\\" &&
      isOctalDigit(set[i + 1]) &&
      char.charCodeAt(0) > 0o177
    ) {
      return true;
    }
    i = next;
  }
  return false;
}

function expandRange(
  set: string,
  maxLength: number,
  maxIterations: number,
  budget: { iterations: number },
): string {
  let result = "";
  let i = 0;
  const append = (value: string): void => {
    if (value.length > maxLength - result.length) {
      throw new ExecutionLimitError(
        `tr: expanded SET exceeds string length limit (${maxLength})`,
        "string_length",
      );
    }
    result += value;
  };
  const useIterations = (count = 1): void => {
    if (count > maxIterations - budget.iterations) {
      throw new ExecutionLimitError(
        `tr: SET expansion iteration limit exceeded (${maxIterations})`,
        "iterations",
      );
    }
    budget.iterations += count;
  };

  while (i < set.length) {
    useIterations();
    // Check for POSIX character classes like [:alnum:]
    if (set[i] === "[" && set[i + 1] === ":") {
      let found = false;
      for (const [className, chars] of POSIX_CLASSES) {
        if (set.slice(i).startsWith(className)) {
          append(chars);
          i += className.length;
          found = true;
          break;
        }
      }
      if (found) continue;
    }

    const first = readSetChar(set, i);

    // Handle character ranges like a-z; either endpoint may be an escape
    if (set[first.next] === "-" && first.next + 1 < set.length) {
      const last = readSetChar(set, first.next + 1);
      const start = first.char.charCodeAt(0);
      const end = last.char.charCodeAt(0);
      if (end < start) {
        throw new Error(
          `tr: range-endpoints of '${first.char}-${last.char}' are in reverse collating sequence order`,
        );
      }
      const rangeLength = end - start + 1;
      useIterations(rangeLength);
      if (rangeLength > maxLength - result.length) {
        throw new ExecutionLimitError(
          `tr: expanded SET exceeds string length limit (${maxLength})`,
          "string_length",
        );
      }
      for (let code = start; code <= end; code++) {
        result += String.fromCharCode(code);
      }
      i = last.next;
      continue;
    }

    append(first.char);
    i = first.next;
  }

  return result;
}

const argDefs = {
  complement: { short: "c", long: "complement", type: "boolean" as const },
  complementUpper: { short: "C", type: "boolean" as const },
  delete: { short: "d", long: "delete", type: "boolean" as const },
  squeeze: { short: "s", long: "squeeze-repeats", type: "boolean" as const },
};

export const trCommand: RuntimeCommand = {
  name: "tr",
  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(trHelp);
    }

    const parsed = parseArgs("tr", args, argDefs);
    if (!parsed.ok) return parsed.error;

    // -c and -C both enable complement mode
    const complementMode =
      parsed.result.flags.complement || parsed.result.flags.complementUpper;
    const deleteMode = parsed.result.flags.delete;
    const squeezeMode = parsed.result.flags.squeeze;
    const sets = parsed.result.positional;

    if (sets.length < 1) {
      return {
        stdout: "",
        stderr: "tr: missing operand\n",
        exitCode: 1,
      };
    }

    if (!deleteMode && !squeezeMode && sets.length < 2) {
      return {
        stdout: "",
        stderr: "tr: missing operand after SET1\n",
        exitCode: 1,
      };
    }

    const maxOperands = deleteMode && !squeezeMode ? 1 : 2;
    if (sets.length > maxOperands) {
      return {
        stdout: "",
        stderr: `tr: extra operand '${sanitizeErrorMessage(sets[maxOperands])}'\n`,
        exitCode: 1,
      };
    }

    let set1Raw: string;
    let set2: string;
    const maxStringLength = Math.min(
      ctx.limits.maxInputBytes,
      ctx.limits.maxStringLength,
    );
    const maxIterations = ctx.limits.maxLoopIterations;
    const maxArrayElements = ctx.limits.maxArrayElements;
    const maxOutputSize = Math.min(
      ctx.limits.maxOutputSize,
      ctx.limits.maxStringLength,
    );
    // GNU tr works on bytes. This tr decodes its input so that a SET like 'é'
    // matches the character, but an octal escape above \177 names a single
    // byte. A SET with one switches tr to bytes: the input is not decoded, and
    // the SETs' own characters become their UTF-8 bytes, as in GNU tr.
    const byteMode = sets.some(hasHighOctalEscape);
    const setBytes = (set: string): string =>
      byteMode ? latin1FromBytes(encodeUtf8ToBytes(set)) : set;
    try {
      const expansionBudget = { iterations: 0 };
      set1Raw = expandRange(
        setBytes(sets[0]),
        maxStringLength,
        maxIterations,
        expansionBudget,
      );
      set2 =
        sets.length > 1
          ? expandRange(
              setBytes(sets[1]),
              maxStringLength,
              maxIterations,
              expansionBudget,
            )
          : "";
    } catch (e) {
      rethrowFatalExecutionError(e);
      const message = sanitizeErrorMessage((e as Error).message);
      return {
        stdout: "",
        stderr: `${message}\n`,
        exitCode: 1,
      };
    }
    // Outside byte mode, translation operates on codepoints — set1 / set2 args
    // are real Unicode strings, so we must decode bytes to UTF-8 first,
    // otherwise multibyte chars don't match the SET they were spelled with.
    if (latin1FromBytes(ctx.stdin).length > maxStringLength) {
      throw new ExecutionLimitError(
        `tr: input size limit exceeded (${maxStringLength} bytes)`,
        "string_length",
      );
    }
    const content = byteMode
      ? latin1FromBytes(ctx.stdin)
      : decodeBytesToUtf8(ctx.stdin);
    if (set1Raw.length > maxArrayElements || set2.length > maxArrayElements) {
      throw new ExecutionLimitError(
        `tr: array element limit exceeded (${maxArrayElements})`,
        "array_elements",
      );
    }
    const set1 = new Set(set1Raw);
    const set2Chars = new Set(set2);

    // Helper to check if character is in set1 (considering complement mode)
    const isInSet1 = (char: string): boolean => {
      const inSet = set1.has(char);
      return complementMode ? !inSet : inSet;
    };

    // Small inputs already bound the number of one-codepoint appends. Avoid
    // batching them; large inputs still compact output every 8192 fragments.
    const output = createStringBuilder(content.length <= 32768 ? 32768 : 32);
    let outputBytes = 0;
    const appendOutput = (value: string): void => {
      // Every append is empty or one codepoint, so account for its UTF-8
      // width directly. Lone surrogate code units still cost three bytes.
      let bytes = 0;
      if (byteMode) bytes = value.length;
      else if (value.length === 2) bytes = 4;
      else if (value.length === 1) {
        const code = value.charCodeAt(0);
        bytes = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : 3;
      }
      if (bytes > maxOutputSize - outputBytes) {
        throw new ExecutionLimitError(
          `tr: output size limit exceeded (${maxOutputSize} bytes)`,
          "output_size",
        );
      }
      output.append(value);
      outputBytes += bytes;
    };

    if (deleteMode) {
      // Delete characters in set1 (or complement of set1)
      // Advance by codepoint without allocating a string-iterator result per
      // character. Use the same traversal in the squeeze/translation loops.
      for (let i = 0; i < content.length; ) {
        const code = content.codePointAt(i) as number;
        const char = code > 0xffff ? content.slice(i, i + 2) : content[i];
        i += char.length;
        if (!isInSet1(char)) {
          appendOutput(char);
        }
      }
    } else if (squeezeMode && sets.length === 1) {
      // Squeeze consecutive characters in set1
      let prev = "";
      for (let i = 0; i < content.length; ) {
        const code = content.codePointAt(i) as number;
        const char = code > 0xffff ? content.slice(i, i + 2) : content[i];
        i += char.length;
        if (isInSet1(char) && char === prev) {
          continue; // Skip repeated character
        }
        appendOutput(char);
        prev = char;
      }
    } else {
      // Translate characters from set1 to set2
      let translatedPrev = "";
      const appendTranslated = (char: string): void => {
        if (squeezeMode && set2Chars.has(char) && char === translatedPrev) {
          return;
        }
        appendOutput(char);
        translatedPrev = char;
      };
      if (complementMode) {
        // In complement mode, all characters NOT in set1 are translated
        // They're all mapped to a single character (last char of set2)
        const targetChar = set2.length > 0 ? set2[set2.length - 1] : "";
        for (let i = 0; i < content.length; ) {
          const code = content.codePointAt(i) as number;
          const char = code > 0xffff ? content.slice(i, i + 2) : content[i];
          i += char.length;
          if (!set1.has(char)) {
            appendTranslated(targetChar);
          } else {
            appendTranslated(char);
          }
        }
      } else {
        // Normal translation mode
        const translationMap = new Map<string, string>();
        for (let i = 0; i < set1Raw.length; i++) {
          // If set2 is shorter, use the last character of set2
          const targetChar = i < set2.length ? set2[i] : set2[set2.length - 1];
          translationMap.set(set1Raw[i], targetChar);
        }

        for (let i = 0; i < content.length; ) {
          const code = content.codePointAt(i) as number;
          const char = code > 0xffff ? content.slice(i, i + 2) : content[i];
          i += char.length;
          appendTranslated(translationMap.get(char) ?? char);
        }
      }
    }

    // In byte mode stdout is already bytes; otherwise tr emits text and the
    // pipeline handles encoding.
    return {
      stdout: output.finish(),
      stderr: "",
      exitCode: 0,
      ...(byteMode && { stdoutKind: "bytes" as const }),
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "tr",
  flags: [
    { flag: "-c", type: "boolean" },
    { flag: "-C", type: "boolean" },
    { flag: "-d", type: "boolean" },
    { flag: "-s", type: "boolean" },
  ],
  stdinType: "text",
  needsArgs: true,
};
