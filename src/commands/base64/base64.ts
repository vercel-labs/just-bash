/**
 * base64 - Encode or decode base64
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { parseArgs } from "../../utils/args.js";
import { readAndConcat } from "../../utils/file-reader.js";
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

    // Read input from files or stdin
    const readResult = await readAndConcat(ctx, files, { cmdName: "base64" });
    if (!readResult.ok) return readResult.error;
    const input = readResult.content;

    try {
      if (decode) {
        const cleaned = input.replace(/\s/g, "");
        const decoded = Buffer.from(cleaned, "base64").toString("utf-8");
        return { stdout: decoded, stderr: "", exitCode: 0 };
      }
      let encoded = Buffer.from(input).toString("base64");
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
