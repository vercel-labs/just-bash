/**
 * od - dump files in octal and other formats
 *
 * Usage: od [OPTION]... [FILE]...
 *
 * Write an unambiguous representation, octal bytes by default,
 * of FILE to standard output.
 */

import { BoundedStringBuilder } from "../../bounded-builder.js";
import { latin1FromBytes, readBytesFrom } from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type { Command, CommandContext, ExecResult } from "../../types.js";

type OutputFormat = "octal" | "hex" | "char";

async function odExecute(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  // Parse options
  let addressMode: "octal" | "none" = "octal";
  const outputFormats: OutputFormat[] = [];
  const fileArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-c") {
      outputFormats.push("char");
    } else if (arg === "-An" || (arg === "-A" && args[i + 1] === "n")) {
      addressMode = "none";
      if (arg === "-A") i++; // Skip the "n" argument
    } else if (arg === "-t" && args[i + 1]) {
      const format = args[++i];
      if (format === "x1") {
        outputFormats.push("hex");
      } else if (format === "c") {
        outputFormats.push("char");
      } else if (format.startsWith("o")) {
        outputFormats.push("octal");
      }
    } else if (!arg.startsWith("-") || arg === "-") {
      fileArgs.push(arg);
    }
  }

  // Default to octal if no format specified
  if (outputFormats.length === 0) {
    outputFormats.push("octal");
  }

  // Concatenate every operand in order. A `-` operand contributes stdin at
  // that exact position; with no operands stdin is the sole input.
  const input = new BoundedStringBuilder(ctx.limits.maxInputBytes, "od input");
  const operands = fileArgs.length === 0 ? ["-"] : fileArgs;
  for (const operand of operands) {
    if (operand === "-") {
      input.append(latin1FromBytes(ctx.stdin));
      continue;
    }
    const filePath = operand.startsWith("/")
      ? operand
      : `${ctx.cwd}/${operand}`;
    try {
      const content = latin1FromBytes(await readBytesFrom(ctx.fs, filePath));
      ctx.executionScope?.consumeInput(content.length, "od");
      input.append(content);
    } catch (error) {
      rethrowFatalExecutionError(error);
      return {
        stdout: "",
        stderr: `od: ${operand}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  }

  // Check if char format is included (affects field width)
  const hasCharFormat = outputFormats.includes("char");

  // Format a single byte for character mode (4-char field, right-aligned)
  // Real od uses backslash only for named escape sequences, not for generic octal
  function formatCharByte(code: number): string {
    // Named escape sequences (2 chars, padded with 2 leading spaces)
    if (code === 0) return "  \\0";
    if (code === 7) return "  \\a";
    if (code === 8) return "  \\b";
    if (code === 9) return "  \\t";
    if (code === 10) return "  \\n";
    if (code === 11) return "  \\v";
    if (code === 12) return "  \\f";
    if (code === 13) return "  \\r";
    if (code >= 32 && code < 127) {
      // Printable ASCII - 3 leading spaces + char = 4 chars total
      return `   ${String.fromCharCode(code)}`;
    }
    // Non-printable - use 3-digit octal WITHOUT backslash (this is real od behavior)
    return ` ${code.toString(8).padStart(3, "0")}`;
  }

  // Format a single byte for hex mode
  // Field width depends on whether char format is also used
  function formatHexByte(code: number): string {
    if (hasCharFormat) {
      // 4-char field: 2 spaces + 2 hex digits
      return `  ${code.toString(16).padStart(2, "0")}`;
    }
    // 3-char field: 1 space + 2 hex digits
    return ` ${code.toString(16).padStart(2, "0")}`;
  }

  // Format a single byte for octal mode (right-aligned)
  function formatOctalByte(code: number): string {
    return ` ${code.toString(8).padStart(3, "0")}`;
  }

  const inputBytes = input.build();

  // Determine bytes per line (use 16 for hex/char compatibility)
  const bytesPerLine = 16;

  // Build output lines
  const output = new BoundedStringBuilder(
    Math.min(ctx.limits.maxOutputSize, ctx.limits.maxStringLength),
    "od",
  );
  const formatCount = outputFormats.length;
  if (
    formatCount > 0 &&
    inputBytes.length > Math.floor(ctx.limits.maxLoopIterations / formatCount)
  ) {
    throw new ExecutionLimitError(
      `od: format work limit exceeded (${ctx.limits.maxLoopIterations})`,
      "iterations",
    );
  }
  ctx.executionScope?.consumeWork(
    inputBytes.length * formatCount,
    "od formatting",
  );

  for (let offset = 0; offset < inputBytes.length; offset += bytesPerLine) {
    // For each output format, generate a line
    for (let formatIdx = 0; formatIdx < outputFormats.length; formatIdx++) {
      const format = outputFormats[formatIdx];
      let formatted: string[];

      if (format === "char") {
        formatted = Array.from(
          inputBytes.slice(offset, offset + bytesPerLine),
          (char) => formatCharByte(char.charCodeAt(0)),
        );
      } else if (format === "hex") {
        formatted = Array.from(
          inputBytes.slice(offset, offset + bytesPerLine),
          (char) => formatHexByte(char.charCodeAt(0)),
        );
      } else {
        formatted = Array.from(
          inputBytes.slice(offset, offset + bytesPerLine),
          (char) => formatOctalByte(char.charCodeAt(0)),
        );
      }

      // Add address prefix only for the first format of each offset
      let prefix = "";
      if (formatIdx === 0 && addressMode !== "none") {
        prefix = `${offset.toString(8).padStart(7, "0")} `;
      } else if (formatIdx > 0 || addressMode === "none") {
        // For subsequent formats or no-address mode, just use spaces
        prefix = addressMode === "none" ? "" : "        ";
      }

      // No separator needed - each field already includes leading spaces
      output.append(prefix + formatted.join("")).append("\n");
    }
  }

  // Add final address
  if (addressMode !== "none" && inputBytes.length > 0) {
    output.append(inputBytes.length.toString(8).padStart(7, "0")).append("\n");
  }

  return {
    stdout: output.build(),
    stderr: "",
    exitCode: 0,
  };
}

export const od: Command = {
  name: "od",
  execute: odExecute,
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "od",
  flags: [
    { flag: "-c", type: "boolean" },
    { flag: "-A", type: "value", valueHint: "string" },
    { flag: "-t", type: "value", valueHint: "string" },
    { flag: "-N", type: "value", valueHint: "number" },
  ],
  stdinType: "text",
  needsFiles: true,
};
