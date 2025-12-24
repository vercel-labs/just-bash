import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const tailHelp = {
  name: "tail",
  summary: "output the last part of files",
  usage: "tail [OPTION]... [FILE]...",
  options: [
    "-c, --bytes=NUM    print the last NUM bytes",
    "-n, --lines=NUM    print the last NUM lines (default 10)",
    "-n +NUM            print starting from line NUM",
    "-q, --quiet        never print headers giving file names",
    "-v, --verbose      always print headers giving file names",
    "    --help         display this help and exit",
  ],
};

export const tailCommand: Command = {
  name: "tail",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(tailHelp);
    }

    let lines = 10;
    let bytes: number | null = null;
    let fromLine = false; // true if +n syntax (start from line n)
    let quiet = false;
    let verbose = false;
    const files: string[] = [];

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-n" && i + 1 < args.length) {
        const nextArg = args[++i];
        if (nextArg.startsWith("+")) {
          fromLine = true;
          lines = parseInt(nextArg.slice(1), 10);
        } else {
          lines = parseInt(nextArg, 10);
        }
      } else if (arg.startsWith("-n+")) {
        fromLine = true;
        lines = parseInt(arg.slice(3), 10);
      } else if (arg.startsWith("-n")) {
        lines = parseInt(arg.slice(2), 10);
      } else if (arg === "-c" && i + 1 < args.length) {
        bytes = parseInt(args[++i], 10);
      } else if (arg.startsWith("-c")) {
        bytes = parseInt(arg.slice(2), 10);
      } else if (arg.startsWith("--bytes=")) {
        bytes = parseInt(arg.slice(8), 10);
      } else if (arg.startsWith("--lines=")) {
        lines = parseInt(arg.slice(8), 10);
      } else if (arg === "-q" || arg === "--quiet" || arg === "--silent") {
        quiet = true;
      } else if (arg === "-v" || arg === "--verbose") {
        verbose = true;
      } else if (arg.match(/^-\d+$/)) {
        lines = parseInt(arg.slice(1), 10);
      } else if (arg.startsWith("--")) {
        return unknownOption("tail", arg);
      } else if (arg.startsWith("-") && arg !== "-") {
        return unknownOption("tail", arg);
      } else {
        files.push(arg);
      }
    }

    if (bytes !== null && (Number.isNaN(bytes) || bytes < 0)) {
      return {
        stdout: "",
        stderr: "tail: invalid number of bytes\n",
        exitCode: 1,
      };
    }

    if (Number.isNaN(lines) || lines < 0) {
      return {
        stdout: "",
        stderr: "tail: invalid number of lines\n",
        exitCode: 1,
      };
    }

    // Helper to get tail of content - optimized to avoid splitting entire file
    const getTail = (content: string): string => {
      if (bytes !== null) {
        return content.slice(-bytes);
      }

      const len = content.length;
      if (len === 0) return "";

      // For fromLine (+n), we still need to count from start
      if (fromLine) {
        let pos = 0;
        let lineCount = 1;
        while (pos < len && lineCount < lines) {
          const nextNewline = content.indexOf("\n", pos);
          if (nextNewline === -1) break;
          lineCount++;
          pos = nextNewline + 1;
        }
        const result = content.slice(pos);
        return result.endsWith("\n") ? result : `${result}\n`;
      }

      // Fast path: scan backwards to find last N newlines
      if (lines === 0) return "";

      // Start from end, skip trailing newline if present
      let pos = len - 1;
      if (content[pos] === "\n") pos--;

      let lineCount = 0;
      while (pos >= 0 && lineCount < lines) {
        if (content[pos] === "\n") {
          lineCount++;
          if (lineCount === lines) {
            pos++; // Move past this newline
            break;
          }
        }
        pos--;
      }

      if (pos < 0) pos = 0;
      const result = content.slice(pos);
      // Check if content ends with newline using direct char access (faster than endsWith)
      return content[len - 1] === "\n" ? result : `${result}\n`;
    };

    // If no files, read from stdin
    if (files.length === 0) {
      return {
        stdout: getTail(ctx.stdin),
        stderr: "",
        exitCode: 0,
      };
    }

    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    // Determine whether to show headers
    // -v always shows, -q never shows, default shows for multiple files
    const showHeaders = verbose || (!quiet && files.length > 1);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Show header if needed
      if (showHeaders) {
        if (i > 0) stdout += "\n";
        stdout += `==> ${file} <==\n`;
      }

      try {
        const filePath = ctx.fs.resolvePath(ctx.cwd, file);
        const content = await ctx.fs.readFile(filePath);
        stdout += getTail(content);
      } catch {
        stderr += `tail: ${file}: No such file or directory\n`;
        exitCode = 1;
      }
    }

    return { stdout, stderr, exitCode };
  },
};
