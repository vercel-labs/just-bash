import {
  boundedJoin,
  checkedAdd,
  checkedMultiply,
} from "../../bounded-builder.js";
import { utf8ByteLength } from "../../encoding.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";

/**
 * seq - print a sequence of numbers
 *
 * Usage:
 *   seq LAST           - print numbers from 1 to LAST
 *   seq FIRST LAST     - print numbers from FIRST to LAST
 *   seq FIRST INCR LAST - print numbers from FIRST to LAST by INCR
 *
 * Options:
 *   -s STRING  use STRING to separate numbers (default: newline)
 *   -w         equalize width by padding with leading zeros
 */
export const seqCommand: Command = {
  name: "seq",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    let separator = "\n";
    let equalizeWidth = false;
    const nums: string[] = [];

    // Parse arguments
    let i = 0;
    while (i < args.length) {
      const arg = args[i];

      if (arg === "-s" && i + 1 < args.length) {
        separator = args[i + 1];
        i += 2;
        continue;
      }

      if (arg === "-w") {
        equalizeWidth = true;
        i++;
        continue;
      }

      if (arg === "--") {
        i++;
        break;
      }

      if (arg.startsWith("-") && arg !== "-") {
        // Check for combined flags or -sSTRING
        if (arg.startsWith("-s") && arg.length > 2) {
          separator = arg.slice(2);
          i++;
          continue;
        }
        if (arg === "-ws" || arg === "-sw") {
          equalizeWidth = true;
          if (i + 1 < args.length) {
            separator = args[i + 1];
            i += 2;
            continue;
          }
        }
        // Unknown option - treat as number (might be negative)
      }

      nums.push(arg);
      i++;
    }

    // Collect remaining args as numbers
    while (i < args.length) {
      nums.push(args[i]);
      i++;
    }

    if (nums.length === 0) {
      return {
        stdout: "",
        stderr: "seq: missing operand\n",
        exitCode: 1,
      };
    }

    let first = 1;
    let increment = 1;
    let last: number;

    if (nums.length === 1) {
      last = parseFloat(nums[0]);
    } else if (nums.length === 2) {
      first = parseFloat(nums[0]);
      last = parseFloat(nums[1]);
    } else {
      first = parseFloat(nums[0]);
      increment = parseFloat(nums[1]);
      last = parseFloat(nums[2]);
    }

    // Validate numbers
    if (
      !Number.isFinite(first) ||
      !Number.isFinite(increment) ||
      !Number.isFinite(last)
    ) {
      const invalid = nums.find((n) => !Number.isFinite(parseFloat(n)));
      return {
        stdout: "",
        stderr: `seq: invalid floating point argument: '${invalid}'\n`,
        exitCode: 1,
      };
    }

    if (increment === 0) {
      return {
        stdout: "",
        stderr: "seq: invalid Zero increment value: '0'\n",
        exitCode: 1,
      };
    }

    // Generate sequence
    const results: string[] = [];

    // Determine precision for floating point
    const getPrecision = (n: number): number => {
      const str = String(n);
      const dotIndex = str.indexOf(".");
      return dotIndex === -1 ? 0 : str.length - dotIndex - 1;
    };

    const precision = Math.max(
      getPrecision(first),
      getPrecision(increment),
      getPrecision(last),
    );

    // Limit iterations to prevent infinite loops
    const maxIterations = Math.min(
      ctx.limits.maxLoopIterations,
      ctx.limits.maxArrayElements,
    );
    const maxOutputSize = Math.min(
      ctx.limits.maxOutputSize,
      ctx.limits.maxStringLength,
    );
    const separatorBytes = utf8ByteLength(separator);
    let projectedOutputBytes = 0;
    let iterations = 0;

    const appendResult = (value: string): void => {
      if (iterations >= maxIterations) {
        throw new ExecutionLimitError(
          `seq: iteration limit exceeded (${maxIterations})`,
          "iterations",
        );
      }
      const nextSize = checkedAdd(
        checkedAdd(
          projectedOutputBytes,
          results.length > 0 ? separatorBytes : 0,
          "seq",
        ),
        checkedAdd(utf8ByteLength(value), 1, "seq"),
        "seq",
      );
      if (nextSize > maxOutputSize) {
        throw new ExecutionLimitError(
          `seq: output size limit exceeded (${maxOutputSize} bytes)`,
          "output_size",
        );
      }
      projectedOutputBytes = nextSize - 1;
      results.push(value);
      iterations++;
    };

    if (increment > 0) {
      for (let n = first; n <= last + 1e-10; n += increment) {
        appendResult(
          precision > 0 ? n.toFixed(precision) : String(Math.round(n)),
        );
      }
    } else {
      for (let n = first; n >= last - 1e-10; n += increment) {
        appendResult(
          precision > 0 ? n.toFixed(precision) : String(Math.round(n)),
        );
      }
    }

    // Equalize width if requested
    if (equalizeWidth && results.length > 0) {
      let maxLen = 0;
      for (const result of results) {
        maxLen = Math.max(
          maxLen,
          result.startsWith("-") ? result.length - 1 : result.length,
        );
      }
      const valuesBytes = results.reduce(
        (total, result) =>
          checkedAdd(total, maxLen + (result.startsWith("-") ? 1 : 0), "seq"),
        0,
      );
      const paddedOutputBytes = checkedAdd(
        checkedAdd(
          valuesBytes,
          checkedMultiply(
            separatorBytes,
            Math.max(0, results.length - 1),
            "seq",
          ),
          "seq",
        ),
        1,
        "seq",
      );
      if (paddedOutputBytes > maxOutputSize) {
        throw new ExecutionLimitError(
          `seq: output size limit exceeded (${maxOutputSize} bytes)`,
          "output_size",
        );
      }
      for (let j = 0; j < results.length; j++) {
        const isNegative = results[j].startsWith("-");
        const num = isNegative ? results[j].slice(1) : results[j];
        const padded = num.padStart(maxLen, "0");
        results[j] = isNegative ? `-${padded}` : padded;
      }
    }

    const output = boundedJoin(results, separator, maxOutputSize - 1, "seq");
    return {
      stdout: output ? `${output}\n` : "",
      stderr: "",
      exitCode: 0,
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "seq",
  flags: [
    { flag: "-s", type: "value", valueHint: "string" },
    { flag: "-w", type: "boolean" },
  ],
  needsArgs: true,
};
