/**
 * rev - reverse lines characterwise
 *
 * Usage: rev [file ...]
 *
 * Copies the specified files to standard output, reversing the order
 * of characters in every line. If no files are specified, standard
 * input is read.
 */

import { decodeBytesToUtf8 } from "../../encoding.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const revHelp = {
  name: "rev",
  summary: "reverse lines characterwise",
  usage: "rev [file ...]",
  description:
    "Copies the specified files to standard output, reversing the order of characters in every line. If no files are specified, standard input is read.",
  examples: [
    "echo 'hello' | rev     # Output: olleh",
    "rev file.txt           # Reverse each line in file",
  ],
};

/**
 * Reverse a string, handling Unicode correctly by using Array.from
 * to split by code points rather than UTF-16 code units.
 */
function reverseString(str: string): string {
  return Array.from(str).reverse().join("");
}

export const rev: RuntimeCommand = {
  name: "rev",
  execute: async (
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> => {
    if (hasHelpFlag(args)) {
      return showHelp(revHelp);
    }

    const files: string[] = [];
    for (const arg of args) {
      if (arg === "--") {
        // Everything after -- is a file
        const idx = args.indexOf(arg);
        files.push(...args.slice(idx + 1));
        break;
      } else if (arg.startsWith("-") && arg !== "-") {
        return unknownOption("rev", arg);
      } else {
        files.push(arg);
      }
    }
    let output = "";

    // Process function for content
    const processContent = (content: string): string => {
      const lines = content.split("\n");
      // Handle trailing newline - if content ends with \n, last element is empty
      const hasTrailingNewline =
        content.endsWith("\n") && lines[lines.length - 1] === "";
      if (hasTrailingNewline) {
        lines.pop();
      }
      const reversed = lines.map(reverseString);
      return reversed.join("\n") + (hasTrailingNewline ? "\n" : "");
    };

    if (files.length === 0) {
      // Read from stdin. rev reverses by codepoint, so decode bytes to UTF-8
      // first — reversing the latin1 bytes of a multibyte sequence would
      // shred valid UTF-8 into garbage.
      const input = decodeBytesToUtf8(ctx.stdin) ?? "";
      output = processContent(input);
    } else {
      // Process each file
      for (const file of files) {
        if (file === "-") {
          // Dash means read from stdin
          const input = decodeBytesToUtf8(ctx.stdin) ?? "";
          output += processContent(input);
        } else {
          const filePath = ctx.fs.resolvePath(ctx.cwd, file);
          const content = await ctx.fs.readFile(filePath);
          if (content === null) {
            return {
              exitCode: 1,
              stdout: output,
              stderr: `rev: ${file}: No such file or directory\n`,
            };
          }
          output += processContent(content);
        }
      }
    }

    // rev emits text; the pipeline handles encoding.
    return {
      exitCode: 0,
      stdout: output,
      stderr: "",
    };
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "rev",
  flags: [],
  stdinType: "text",
  needsFiles: true,
};
