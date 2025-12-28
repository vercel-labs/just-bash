/**
 * Custom commands for just-bash
 *
 * Demonstrates how to create custom TypeScript commands that integrate
 * seamlessly with the bash environment.
 */

import { randomUUID } from "node:crypto";
import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { createLinkPreviewClient } from "@steipete/summarize-core/content";
import {
  buildLinkSummaryPrompt,
  pickSummaryLengthForCharacters,
} from "@steipete/summarize-core/prompts";
import { defineCommand } from "just-bash";

/**
 * Generate a random UUID
 *
 * Usage: uuid [-n count]
 */
export const uuidCommand = defineCommand("uuid", async (args) => {
  let count = 1;

  // Parse -n flag
  const nIndex = args.indexOf("-n");
  if (nIndex !== -1 && args[nIndex + 1]) {
    count = parseInt(args[nIndex + 1], 10);
    if (isNaN(count) || count < 1) {
      return {
        stdout: "",
        stderr: "uuid: invalid count\n",
        exitCode: 1,
      };
    }
  }

  const uuids = Array.from({ length: count }, () => randomUUID()).join("\n");
  return {
    stdout: uuids + "\n",
    stderr: "",
    exitCode: 0,
  };
});

/**
 * Pretty-print JSON from stdin or file
 *
 * Usage: json-format [file] or pipe JSON to it
 */
export const jsonFormatCommand = defineCommand("json-format", async (args, ctx) => {
  let input = ctx.stdin;

  // Read from file if provided
  if (args[0] && !ctx.stdin) {
    try {
      input = await ctx.fs.readFile(ctx.fs.resolvePath(ctx.cwd, args[0]));
    } catch {
      return {
        stdout: "",
        stderr: `json-format: ${args[0]}: No such file\n`,
        exitCode: 1,
      };
    }
  }

  if (!input.trim()) {
    return {
      stdout: "",
      stderr: "json-format: no input\n",
      exitCode: 1,
    };
  }

  try {
    const parsed = JSON.parse(input);
    return {
      stdout: JSON.stringify(parsed, null, 2) + "\n",
      stderr: "",
      exitCode: 0,
    };
  } catch {
    return {
      stdout: "",
      stderr: "json-format: invalid JSON\n",
      exitCode: 1,
    };
  }
});

/**
 * Generate lorem ipsum text
 *
 * Usage: lorem [paragraphs]
 */
export const loremCommand = defineCommand("lorem", async (args) => {
  const paragraphs = [
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
    "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
    "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
    "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
    "Curabitur pretium tincidunt lacus. Nulla gravida orci a odio. Nullam varius, turpis et commodo pharetra.",
  ];

  let count = 1;
  if (args[0]) {
    count = parseInt(args[0], 10);
    if (isNaN(count) || count < 1) {
      return {
        stdout: "",
        stderr: "lorem: invalid paragraph count\n",
        exitCode: 1,
      };
    }
  }

  const output = Array.from(
    { length: count },
    (_, i) => paragraphs[i % paragraphs.length]
  ).join("\n\n");

  return {
    stdout: output + "\n",
    stderr: "",
    exitCode: 0,
  };
});

/**
 * Count words, lines, and characters in stdin
 *
 * Usage: wordcount or pipe text to it
 * Similar to wc but with labeled output
 */
export const wordcountCommand = defineCommand("wordcount", async (args, ctx) => {
  let input = ctx.stdin;

  // Read from file if provided
  if (args[0] && !ctx.stdin) {
    try {
      input = await ctx.fs.readFile(ctx.fs.resolvePath(ctx.cwd, args[0]));
    } catch {
      return {
        stdout: "",
        stderr: `wordcount: ${args[0]}: No such file\n`,
        exitCode: 1,
      };
    }
  }

  const lines = input.split("\n").length - (input.endsWith("\n") ? 1 : 0);
  const words = input.trim().split(/\s+/).filter(Boolean).length;
  const chars = input.length;

  return {
    stdout: `Lines: ${lines}\nWords: ${words}\nChars: ${chars}\n`,
    stderr: "",
    exitCode: 0,
  };
});

/**
 * Reverse text from stdin
 *
 * Usage: reverse or pipe text to it
 */
export const reverseCommand = defineCommand("reverse", async (_args, ctx) => {
  const lines = ctx.stdin.split("\n");
  const reversed = lines.map((line) => line.split("").reverse().join(""));
  return {
    stdout: reversed.join("\n"),
    stderr: "",
    exitCode: 0,
  };
});

/**
 * Summarize a URL to markdown using AI
 *
 * A simplified version of https://github.com/steipete/summarize
 * Uses @steipete/summarize-core for content extraction and prompt generation.
 *
 * Usage: summarize <url>
 *        summarize --length short|medium|long <url>
 *
 * Requires AI_GATEWAY_API_KEY environment variable (Vercel AI Gateway).
 */
export const summarizeCommand = defineCommand("summarize", async (args) => {
  // Check for API key
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    return {
      stdout: "",
      stderr: "summarize: AI_GATEWAY_API_KEY environment variable not set\n",
      exitCode: 1,
    };
  }

  // Parse arguments
  let lengthArg: "short" | "medium" | "long" | undefined;
  let url: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--length" && args[i + 1]) {
      const len = args[i + 1];
      if (len === "short" || len === "medium" || len === "long") {
        lengthArg = len;
        i++; // skip next arg
      }
    } else if (!args[i].startsWith("-")) {
      url = args[i];
    }
  }

  if (!url) {
    return {
      stdout: "",
      stderr: "summarize: usage: summarize [--length short|medium|long] <url>\n",
      exitCode: 1,
    };
  }

  // Validate URL
  try {
    new URL(url);
  } catch {
    return {
      stdout: "",
      stderr: `summarize: invalid URL: ${url}\n`,
      exitCode: 1,
    };
  }

  try {
    // Fetch content from URL using summarize-core
    const client = createLinkPreviewClient();
    const extracted = await client.fetchLinkContent(url);

    if (!extracted.content) {
      return {
        stdout: "",
        stderr: "summarize: could not extract content from URL\n",
        exitCode: 1,
      };
    }

    // Determine summary length
    const summaryLength =
      lengthArg ?? pickSummaryLengthForCharacters(extracted.content.length);

    // Build prompt using summarize-core
    const systemPrompt = buildLinkSummaryPrompt({
      url,
      title: extracted.title ?? null,
      siteName: extracted.siteName ?? null,
      description: extracted.description ?? null,
      content: extracted.content,
      truncated: extracted.truncated ?? false,
      hasTranscript: false,
      summaryLength,
      shares: [],
    });

    const { text } = await generateText({
      model: gateway("anthropic/claude-3-5-haiku-latest"),
      maxOutputTokens: 2048,
      system: systemPrompt,
      prompt: extracted.content,
    });

    // Format as markdown with title
    const title = extracted.title ?? "Summary";
    const markdown = `# ${title}\n\n> Source: ${url}\n\n${text}\n`;

    return {
      stdout: markdown,
      stderr: "",
      exitCode: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      stdout: "",
      stderr: `summarize: error: ${message}\n`,
      exitCode: 1,
    };
  }
});

