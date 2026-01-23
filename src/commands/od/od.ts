/**
 * od - dump files in octal and other formats
 *
 * Usage: od [OPTION]... [FILE]...
 *
 * Write an unambiguous representation, octal bytes by default,
 * of FILE to standard output.
 */

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

  // Get input - from file or stdin
  let input = ctx.stdin;

  // Check for file argument
  if (fileArgs.length > 0 && fileArgs[0] !== "-") {
    const filePath = fileArgs[0].startsWith("/")
      ? fileArgs[0]
      : `${ctx.cwd}/${fileArgs[0]}`;
    try {
      input = await ctx.fs.readFile(filePath);
    } catch {
      return {
        stdout: "",
        stderr: `od: ${fileArgs[0]}: No such file or directory\n`,
        exitCode: 1,
      };
    }
  }

  // Format a single byte for character mode
  function formatCharByte(code: number): string {
    if (code === 0) return "\\0";
    if (code === 7) return "\\a";
    if (code === 8) return "\\b";
    if (code === 9) return "\\t";
    if (code === 10) return "\\n";
    if (code === 11) return "\\v";
    if (code === 12) return "\\f";
    if (code === 13) return "\\r";
    if (code >= 32 && code < 127) {
      // Printable ASCII - right-align in 3-char field
      return ` ${String.fromCharCode(code)}`;
    }
    // Non-printable - use octal
    return `\\${code.toString(8).padStart(3, "0")}`;
  }

  // Format a single byte for hex mode
  function formatHexByte(code: number): string {
    return code.toString(16).padStart(2, "0");
  }

  // Format a single byte for octal mode
  function formatOctalByte(code: number): string {
    return code.toString(8).padStart(3, "0");
  }

  // Get bytes from input
  const bytes: number[] = [];
  for (const char of input) {
    bytes.push(char.charCodeAt(0));
  }

  // Determine bytes per line (use 16 for hex/char compatibility)
  const bytesPerLine = 16;

  // Build output lines
  const lines: string[] = [];

  for (let offset = 0; offset < bytes.length; offset += bytesPerLine) {
    const chunkBytes = bytes.slice(offset, offset + bytesPerLine);

    // For each output format, generate a line
    for (let formatIdx = 0; formatIdx < outputFormats.length; formatIdx++) {
      const format = outputFormats[formatIdx];
      let formatted: string[];

      if (format === "char") {
        formatted = chunkBytes.map(formatCharByte);
      } else if (format === "hex") {
        formatted = chunkBytes.map(formatHexByte);
      } else {
        formatted = chunkBytes.map(formatOctalByte);
      }

      // Add address prefix only for the first format of each offset
      let prefix = "";
      if (formatIdx === 0 && addressMode !== "none") {
        prefix = `${offset.toString(8).padStart(7, "0")} `;
      } else if (formatIdx > 0 || addressMode === "none") {
        // For subsequent formats or no-address mode, just use spaces
        prefix = addressMode === "none" ? "" : "        ";
      }

      // Use single space for most modes, but different spacing may be needed
      lines.push(prefix + formatted.join(" "));
    }
  }

  // Add final address
  if (addressMode !== "none" && bytes.length > 0) {
    lines.push(bytes.length.toString(8).padStart(7, "0"));
  }

  return {
    stdout: lines.length > 0 ? `${lines.join("\n")}\n` : "",
    stderr: "",
    exitCode: 0,
  };
}

export const od: Command = {
  name: "od",
  execute: odExecute,
};
