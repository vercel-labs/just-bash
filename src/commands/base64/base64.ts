/**
 * base64 - Encode or decode base64
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { hasHelpFlag, showHelp } from "../help.js";

const base64Help = {
  name: "base64",
  summary: "base64 encode/decode data and print to standard output",
  usage: "base64 [OPTION]... [FILE]",
  options: [
    "-d, --decode    decode data",
    "-w, --wrap=COLS wrap encoded lines after COLS character (default 76, 0 to disable)",
    "    --help      display this help and exit",
  ],
};

const argDefs = {
  decode: { short: "d", long: "decode", type: "boolean" as const },
  wrap: { short: "w", long: "wrap", type: "number" as const, default: 76 },
};

// Helper to read file as binary
async function readBinary(
  ctx: CommandContext,
  files: string[],
  cmdName: string,
): Promise<{ ok: true; data: Uint8Array } | { ok: false; error: ExecResult }> {
  // No files - read from stdin
  if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
    return { ok: true, data: new TextEncoder().encode(ctx.stdin) };
  }

  // Read and concatenate all files as binary
  const chunks: Uint8Array[] = [];
  for (const file of files) {
    if (file === "-") {
      chunks.push(new TextEncoder().encode(ctx.stdin));
      continue;
    }
    try {
      const filePath = ctx.fs.resolvePath(ctx.cwd, file);
      const data = await ctx.fs.readFileBuffer(filePath);
      chunks.push(data);
    } catch {
      return {
        ok: false,
        error: {
          stdout: "",
          stderr: `${cmdName}: ${file}: No such file or directory\n`,
          exitCode: 1,
        },
      };
    }
  }

  // Concatenate all chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return { ok: true, data: result };
}

export const base64Command: Command = {
  name: "base64",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(base64Help);
    }

    const parsed = parseArgs("base64", args, argDefs);
    if (!parsed.ok) return parsed.error;

    const decode = parsed.result.flags.decode;
    const wrapCols = parsed.result.flags.wrap;
    const files = parsed.result.positional;

    try {
      if (decode) {
        // For decoding, read as text and strip whitespace
        const readResult = await readBinary(ctx, files, "base64");
        if (!readResult.ok) return readResult.error;
        const input = new TextDecoder().decode(readResult.data);
        const cleaned = input.replace(/\s/g, "");
        // Decode base64 to bytes, then to UTF-8 string for output
        const bytes = Uint8Array.from(atob(cleaned), (c) => c.charCodeAt(0));
        const decoded = new TextDecoder().decode(bytes);
        return { stdout: decoded, stderr: "", exitCode: 0 };
      }

      // Encoding: read as binary
      const readResult = await readBinary(ctx, files, "base64");
      if (!readResult.ok) return readResult.error;

      // Convert binary to base64
      let encoded = btoa(String.fromCharCode(...readResult.data));

      if (wrapCols > 0) {
        const lines: string[] = [];
        for (let i = 0; i < encoded.length; i += wrapCols) {
          lines.push(encoded.slice(i, i + wrapCols));
        }
        encoded = lines.join("\n") + (encoded.length > 0 ? "\n" : "");
      }
      return { stdout: encoded, stderr: "", exitCode: 0 };
    } catch {
      return { stdout: "", stderr: "base64: invalid input\n", exitCode: 1 };
    }
  },
};
