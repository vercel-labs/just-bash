/**
 * base64 - Encode or decode base64
 */

import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

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

export const base64Command: Command = {
  name: "base64",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(base64Help);
    }

    let decode = false;
    let wrapCols = 76;
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-d" || arg === "--decode") {
        decode = true;
      } else if (arg === "-w" || arg === "--wrap") {
        wrapCols = Number.parseInt(args[++i] ?? "76", 10) || 0;
      } else if (arg.startsWith("--wrap=")) {
        wrapCols = Number.parseInt(arg.slice(7), 10) || 0;
      } else if (arg.startsWith("-w")) {
        wrapCols = Number.parseInt(arg.slice(2), 10) || 0;
      } else if (arg === "-") {
        files.push("-");
      } else if (arg.startsWith("--")) {
        return unknownOption("base64", arg);
      } else if (arg.startsWith("-")) {
        for (const c of arg.slice(1)) {
          if (c === "d") decode = true;
          else return unknownOption("base64", `-${c}`);
        }
      } else {
        files.push(arg);
      }
    }

    let input: string;
    if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
      input = ctx.stdin;
    } else {
      try {
        const filePath = ctx.fs.resolvePath(ctx.cwd, files[0]);
        input = await ctx.fs.readFile(filePath);
      } catch {
        return {
          stdout: "",
          stderr: `base64: ${files[0]}: No such file or directory\n`,
          exitCode: 1,
        };
      }
    }

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
