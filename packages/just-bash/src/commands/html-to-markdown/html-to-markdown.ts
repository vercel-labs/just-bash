/**
 * html-to-markdown - Convert HTML to Markdown using TurndownService
 *
 * This is a non-standard command that converts HTML from stdin to Markdown.
 */

import TurndownService from "turndown";
import {
  decodeBytesToUtf8,
  latin1FromBytes,
  utf8ByteLength,
} from "../../encoding.js";
import { rethrowFatalExecutionError } from "../../fatal-execution-error.js";
import { ExecutionLimitError } from "../../interpreter/errors.js";
import type {
  ExecResult,
  RuntimeCommand,
  RuntimeCommandContext,
} from "../../types.js";
import { hasHelpFlag, showHelp, unknownOption } from "../help.js";

const htmlToMarkdownHelp = {
  name: "html-to-markdown",
  summary: "convert HTML to Markdown (BashEnv extension)",
  usage: "html-to-markdown [OPTION]... [FILE]",
  description: [
    "Convert HTML content to Markdown format using the turndown library.",
    "This is a non-standard BashEnv extension command, not available in regular bash.",
    "",
    "Read HTML from FILE or standard input and output Markdown to standard output.",
    "Commonly used with curl to convert web pages:",
    "  curl -s https://example.com | html-to-markdown",
    "",
    "Supported HTML elements:",
    "  - Headings (h1-h6) → # Markdown headings",
    "  - Paragraphs (p) → Plain text with blank lines",
    "  - Links (a) → [text](url)",
    "  - Images (img) → ![alt](src)",
    "  - Bold/Strong → **text**",
    "  - Italic/Em → _text_",
    "  - Code (code, pre) → `inline` or fenced blocks",
    "  - Lists (ul, ol, li) → - or 1. items",
    "  - Blockquotes → > quoted text",
    "  - Horizontal rules (hr) → ---",
  ],
  options: [
    "-b, --bullet=CHAR     bullet character for unordered lists (-, +, or *)",
    "-c, --code=FENCE      fence style for code blocks (``` or ~~~)",
    "-r, --hr=STRING       string for horizontal rules (default: ---)",
    "    --heading-style=STYLE",
    "                      heading style: 'atx' for # headings (default),",
    "                      'setext' for underlined headings (h1/h2 only)",
    "    --help            display this help and exit",
  ],
  examples: [
    "echo '<h1>Hello</h1><p>World</p>' | html-to-markdown",
    "html-to-markdown page.html",
    "curl -s https://example.com | html-to-markdown > page.md",
  ],
};

export const htmlToMarkdownCommand: RuntimeCommand = {
  name: "html-to-markdown",

  async execute(
    args: string[],
    ctx: RuntimeCommandContext,
  ): Promise<ExecResult> {
    if (hasHelpFlag(args)) {
      return showHelp(htmlToMarkdownHelp);
    }

    let bullet = "-";
    let codeFence = "```";
    let hr = "---";
    let headingStyle: "setext" | "atx" = "atx";
    const files: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === "-b" || arg === "--bullet") {
        bullet = args[++i] ?? "-";
      } else if (arg.startsWith("--bullet=")) {
        bullet = arg.slice(9);
      } else if (arg === "-c" || arg === "--code") {
        codeFence = args[++i] ?? "```";
      } else if (arg.startsWith("--code=")) {
        codeFence = arg.slice(7);
      } else if (arg === "-r" || arg === "--hr") {
        hr = args[++i] ?? "---";
      } else if (arg.startsWith("--hr=")) {
        hr = arg.slice(5);
      } else if (arg.startsWith("--heading-style=")) {
        const style = arg.slice(16);
        if (style === "setext" || style === "atx") {
          headingStyle = style;
        }
      } else if (arg === "-") {
        files.push("-");
      } else if (arg.startsWith("--")) {
        return unknownOption("html-to-markdown", arg);
      } else if (arg.startsWith("-")) {
        return unknownOption("html-to-markdown", arg);
      } else {
        files.push(arg);
      }
    }

    // Get input. HTML is text — decode bytes to UTF-8 so character entities
    // and tag boundaries are recognized correctly. File reads use utf8 by
    // default already.
    let input: string;
    const maxInputBytes = Math.min(
      ctx.limits.maxInputBytes,
      ctx.limits.maxStringLength,
    );
    if (files.length === 0 || (files.length === 1 && files[0] === "-")) {
      if (latin1FromBytes(ctx.stdin).length > maxInputBytes) {
        throw new ExecutionLimitError(
          `html-to-markdown: input size limit exceeded (${maxInputBytes} bytes)`,
          "string_length",
        );
      }
      input = decodeBytesToUtf8(ctx.stdin);
    } else {
      try {
        const filePath = ctx.fs.resolvePath(ctx.cwd, files[0]);
        const stat = await ctx.fs.stat(filePath);
        if (stat.size > maxInputBytes) {
          throw new ExecutionLimitError(
            `html-to-markdown: input size limit exceeded (${maxInputBytes} bytes)`,
            "string_length",
          );
        }
        input = await ctx.fs.readFile(filePath);
        if (utf8ByteLength(input) > maxInputBytes) {
          throw new ExecutionLimitError(
            `html-to-markdown: input size limit exceeded (${maxInputBytes} bytes)`,
            "string_length",
          );
        }
      } catch (error) {
        rethrowFatalExecutionError(error);
        return {
          stdout: "",
          stderr: `html-to-markdown: ${files[0]}: No such file or directory\n`,
          exitCode: 1,
        };
      }
    }

    if (!input.trim()) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    if (!["-", "+", "*"].includes(bullet)) {
      return {
        stdout: "",
        stderr: "html-to-markdown: invalid bullet marker\n",
        exitCode: 1,
      };
    }
    if (codeFence !== "```" && codeFence !== "~~~") {
      return {
        stdout: "",
        stderr: "html-to-markdown: invalid code fence\n",
        exitCode: 1,
      };
    }

    let tagCount = 0;
    const maxOperations = ctx.limits.maxLoopIterations;
    for (let index = 0; index < input.length; index++) {
      if (input.charCodeAt(index) === 60 && ++tagCount > maxOperations) {
        throw new ExecutionLimitError(
          `html-to-markdown: complexity limit exceeded (${maxOperations} tags)`,
          "iterations",
        );
      }
    }
    ctx.executionScope?.consumeWork(tagCount, "html-to-markdown tags");

    const inputSize = utf8ByteLength(input);
    const maxOutputBytes = Math.min(
      ctx.limits.maxStringLength,
      ctx.limits.maxOutputSize,
    );
    // Turndown is an opaque synchronous library. Reserve a conservative
    // expansion envelope before calling it so neither its result nor the
    // simultaneous input/result retention can cross configured ceilings.
    const expansionFactor = 4;
    if (inputSize > Math.floor((maxOutputBytes - 1) / expansionFactor)) {
      throw new ExecutionLimitError(
        `html-to-markdown: prospective output size limit exceeded (${maxOutputBytes} bytes)`,
        "output_size",
      );
    }
    const prospectiveOutputBytes = inputSize * expansionFactor + 1;
    const inputLease = ctx.executionScope?.reserveBytes(
      "html input",
      inputSize,
      "html-to-markdown",
    );
    const prospectiveOutputLease = ctx.executionScope?.reserveBytes(
      "html prospective output",
      prospectiveOutputBytes,
      "html-to-markdown",
    );

    try {
      const turndownService = new TurndownService({
        bulletListMarker: bullet as "-" | "+" | "*",
        codeBlockStyle: "fenced",
        fence: codeFence as "```" | "~~~",
        hr,
        headingStyle,
      });

      // Remove script and style elements entirely (including their content)
      turndownService.remove(["script", "style", "footer"]);

      const markdown = turndownService.turndown(input).trim();
      const outputBytes = utf8ByteLength(markdown) + 1;
      if (outputBytes > maxOutputBytes) {
        throw new ExecutionLimitError(
          `html-to-markdown: output size limit exceeded (${maxOutputBytes} bytes)`,
          "output_size",
        );
      }
      // html-to-markdown emits text; the pipeline handles encoding.
      return {
        stdout: `${markdown}\n`,
        stderr: "",
        exitCode: 0,
      };
    } catch (error) {
      rethrowFatalExecutionError(error);
      return {
        stdout: "",
        stderr: `html-to-markdown: conversion error: ${
          (error as Error).message
        }\n`,
        exitCode: 1,
      };
    } finally {
      prospectiveOutputLease?.release();
      inputLease?.release();
    }
  },
};

import type { CommandFuzzInfo } from "../fuzz-flags-types.js";

export const flagsForFuzzing: CommandFuzzInfo = {
  name: "html-to-markdown",
  flags: [],
  stdinType: "text",
};
