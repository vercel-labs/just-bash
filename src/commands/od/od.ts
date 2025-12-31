/**
 * od - dump files in octal and other formats
 *
 * Usage: od [OPTION]... [FILE]...
 *
 * Write an unambiguous representation, octal bytes by default,
 * of FILE to standard output.
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";

async function odExecute(
  args: string[],
  ctx: CommandContext,
): Promise<ExecResult> {
  const charMode = args.includes("-c");
  const addressMode = args.includes("-An") ? "none" : "octal";

  // Get input - from file or stdin
  let input = ctx.stdin;

  // Check for file argument (non-option args)
  const fileArgs = args.filter((a) => !a.startsWith("-") && a !== "-");
  if (fileArgs.length > 0) {
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

  if (charMode) {
    // Character mode: show each character with escapes for special chars
    const chars: string[] = [];
    for (const char of input) {
      const code = char.charCodeAt(0);
      if (code === 0) chars.push("\\0");
      else if (code === 9) chars.push("\\t");
      else if (code === 10) chars.push("\\n");
      else if (code === 13) chars.push("\\r");
      else if (code === 32) chars.push(" ");
      else if (code >= 32 && code < 127) chars.push(` ${char}`);
      else chars.push(`\\${code.toString(8).padStart(3, "0")}`);
    }

    // Format in groups of 16
    const lines: string[] = [];
    for (let i = 0; i < chars.length; i += 16) {
      const chunk = chars.slice(i, i + 16);
      const prefix =
        addressMode === "none" ? "" : `${i.toString(8).padStart(7, "0")} `;
      lines.push(prefix + chunk.join(" "));
    }
    if (addressMode !== "none") {
      lines.push(input.length.toString(8).padStart(7, "0"));
    }
    return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
  }

  // Default: octal dump
  const bytes: string[] = [];
  for (const char of input) {
    bytes.push(char.charCodeAt(0).toString(8).padStart(3, "0"));
  }

  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 8) {
    const chunk = bytes.slice(i, i + 8);
    const prefix =
      addressMode === "none" ? "" : `${i.toString(8).padStart(7, "0")} `;
    lines.push(prefix + chunk.join(" "));
  }
  if (addressMode !== "none" && bytes.length > 0) {
    lines.push(input.length.toString(8).padStart(7, "0"));
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
