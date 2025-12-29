/**
 * Minimal AI agent for exploring the just-bash codebase
 *
 * This file contains only the agent logic - see shell.ts for the interactive loop.
 * Uses OverlayFs to provide read access to the real project files while
 * keeping any writes in memory (copy-on-write behavior).
 */

import { appendFileSync } from "node:fs";
import * as path from "node:path";
import { streamText, stepCountIs } from "ai";
import { createBashTool } from "../../src/ai/index.js";
import { OverlayFs, type BashLogger } from "../../dist/index.js";

export interface AgentRunner {
  chat(
    message: string,
    callbacks: {
      onText: (text: string) => void;
    }
  ): Promise<void>;
}

export interface CreateAgentOptions {
  onToolCall?: (command: string) => void;
  onText?: (text: string) => void;
}

/**
 * Creates an agent runner that can chat about the just-bash codebase
 *
 * Uses OverlayFs to provide direct read access to the real project files.
 * Any writes the agent makes stay in memory and don't affect the real filesystem.
 */
export function createAgent(options: CreateAgentOptions = {}): AgentRunner {
  const projectRoot = path.resolve(import.meta.dirname, "../..");

  // Create OverlayFs - files are mounted at /home/user/project by default
  const overlayFs = new OverlayFs({ root: projectRoot });

  // Logger that appends to commands.log
  const logFile = path.resolve(import.meta.dirname, "commands.log");
  const logger: BashLogger = {
    info: (msg, data) =>
      appendFileSync(logFile, `[INFO] ${msg} ${JSON.stringify(data)}\n`),
    debug: (msg, data) =>
      appendFileSync(logFile, `[DEBUG] ${msg} ${JSON.stringify(data)}\n`),
  };

  const bashTool = createBashTool({
    logger,
    fs: overlayFs,
    extraInstructions: `You are exploring the just-bash project - a simulated bash environment in TypeScript.
Use bash commands to explore:
- All files are in the project directory. Use cd to navigate to the project directory.
- ls ./src to see the source structure
- cat README.md to read documentation
- grep -r "pattern" src to search code
- find . -name "*.ts" to find files

Help the user understand the codebase, find code, and answer questions.

Note: This environment uses OverlayFs - you can read real project files, but any
writes you make stay in memory and don't affect the actual filesystem.`,
    onCall: options.onToolCall,
  });

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  return {
    async chat(message, callbacks) {
      history.push({ role: "user", content: message });

      let fullText = "";

      const result = streamText({
        model: "anthropic/claude-haiku-4.5",
        tools: { bash: bashTool },
        stopWhen: stepCountIs(50),
        messages: history,
      });

      for await (const chunk of result.textStream) {
        options.onText?.(chunk);
        callbacks.onText(chunk);
        fullText += chunk;
      }

      history.push({ role: "assistant", content: fullText });
    },
  };
}
