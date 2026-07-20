import {
  decodeBytesToUtf8,
  latin1FromBytes,
  utf8ByteLength,
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
  \\n, \\t, \\r  escape sequences`,
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

    // Handle escape sequences
    if (set[i] === "\\" && i + 1 < set.length) {
      const next = set[i + 1];
      if (next === "n") {
        append("\n");
      } else if (next === "t") {
        append("\t");
      } else if (next === "r") {
        append("\r");
      } else {
        append(next);
      }
      i += 2;
      continue;
    }

    // Handle character ranges like a-z
    if (i + 2 < set.length && set[i + 1] === "-") {
      const start = set.charCodeAt(i);
      const end = set.charCodeAt(i + 2);
      const rangeLength = end >= start ? end - start + 1 : 0;
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
      i += 3;
      continue;
    }

    append(set[i]);
    i++;
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
    try {
      const expansionBudget = { iterations: 0 };
      set1Raw = expandRange(
        sets[0],
        maxStringLength,
        maxIterations,
        expansionBudget,
      );
      set2 =
        sets.length > 1
          ? expandRange(
              sets[1],
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
    // Translation operates on codepoints — set1 / set2 args are real Unicode
    // strings, so we must decode bytes to UTF-8 first, otherwise multibyte
    // chars don't match the SET they were spelled with.
    if (latin1FromBytes(ctx.stdin).length > maxStringLength) {
      throw new ExecutionLimitError(
        `tr: input size limit exceeded (${maxStringLength} bytes)`,
        "string_length",
      );
    }
    const content = decodeBytesToUtf8(ctx.stdin);
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

    let output = "";
    let outputBytes = 0;
    const appendOutput = (value: string): void => {
      const bytes = utf8ByteLength(value);
      if (bytes > maxOutputSize - outputBytes) {
        throw new ExecutionLimitError(
          `tr: output size limit exceeded (${maxOutputSize} bytes)`,
          "output_size",
        );
      }
      output += value;
      outputBytes += bytes;
    };

    if (deleteMode) {
      // Delete characters in set1 (or complement of set1)
      for (const char of content) {
        if (!isInSet1(char)) {
          appendOutput(char);
        }
      }
    } else if (squeezeMode && sets.length === 1) {
      // Squeeze consecutive characters in set1
      let prev = "";
      for (const char of content) {
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
        for (const char of content) {
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

        for (const char of content) {
          appendTranslated(translationMap.get(char) ?? char);
        }
      }
    }

    // tr emits text; the pipeline handles encoding.
    return {
      stdout: output,
      stderr: "",
      exitCode: 0,
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
