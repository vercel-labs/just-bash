import type { Command, CommandContext, ExecResult } from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const headHelp = {
  name: "head",
  summary: "output the first part of files",
  usage: "head [OPTION]... [FILE]...",
  options: [
    "-c, --bytes=NUM    print the first NUM bytes",
    "-n, --lines=NUM    print the first NUM lines (default 10)",
    "-q, --quiet        never print headers giving file names",
    "-v, --verbose      always print headers giving file names",
    "    --help         display this help and exit",
  ],
};

export const headCommand: Command = {
  name: "head",

  async execute(args: string[], ctx: CommandContext): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(headHelp);
    }

    let lines = 10;
    let bytes: number | null = null;
    let quiet = false;
    let verbose = false;
    const files: string[] = [];

    // Parse arguments
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-n" && i + 1 < args.length) {
        lines = parseInt(args[++i], 10);
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
        return unknownOption("head", arg);
      } else if (arg.startsWith("-") && arg !== "-") {
        return unknownOption("head", arg);
      } else {
        files.push(arg);
      }
    }

    if (bytes !== null && (Number.isNaN(bytes) || bytes < 0)) {
      return {
        stdout: "",
        stderr: "head: invalid number of bytes\n",
        exitCode: 1,
      };
    }

    if (Number.isNaN(lines) || lines < 0) {
      return {
        stdout: "",
        stderr: "head: invalid number of lines\n",
        exitCode: 1,
      };
    }

    // Helper to get head of content - optimized to avoid splitting entire file
    const getHead = (content: string): string => {
      if (bytes !== null) {
        return content.slice(0, bytes);
      }

      // Fast path: find the Nth newline without splitting entire content
      if (lines === 0) return "";

      let pos = 0;
      let lineCount = 0;
      const len = content.length;

      while (pos < len && lineCount < lines) {
        const nextNewline = content.indexOf("\n", pos);
        if (nextNewline === -1) {
          // No more newlines, rest of content is last line
          return `${content}\n`;
        }
        lineCount++;
        pos = nextNewline + 1;
      }

      // Return content up to pos (includes trailing newline)
      return pos > 0 ? content.slice(0, pos) : "";
    };

    // If no files, read from stdin
    if (files.length === 0) {
      return {
        stdout: getHead(ctx.stdin),
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
        stdout += getHead(content);
      } catch {
        stderr += `head: ${file}: No such file or directory\n`;
        exitCode = 1;
      }
    }

    return { stdout, stderr, exitCode };
  },
};
