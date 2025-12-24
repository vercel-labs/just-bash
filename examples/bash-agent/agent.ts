/**
 * Minimal AI agent for exploring the bash-env codebase
 *
 * This file contains only the agent logic - see shell.ts for the interactive loop.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { streamText, stepCountIs } from "ai";
import { globSync } from "glob";
import { createBashTool } from "../../src/ai/index.js";

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
 * Reads all TypeScript, Markdown, and config files from the bash-env project
 */
function readProjectFiles(): Record<string, string> {
  const projectRoot = path.resolve(import.meta.dirname, "../..");
  const files: Record<string, string> = {};

  const matches = globSync("**/*.{ts,md,json}", {
    cwd: projectRoot,
    ignore: ["**/node_modules/**", "**/dist/**", "examples/**"],
  });

  for (const match of matches) {
    const fullPath = path.join(projectRoot, match);
    const virtualPath = `/project/${match}`;
    try {
      files[virtualPath] = fs.readFileSync(fullPath, "utf-8");
    } catch {
      // Skip files we can't read
    }
  }

  return files;
}

/**
 * Creates an agent runner that can chat about the bash-env codebase
 */
export function createAgent(options: CreateAgentOptions = {}): AgentRunner {
  const files = readProjectFiles();
  console.log(`Loaded ${Object.keys(files).length} project files\n`);

  const bashTool = createBashTool({
    files,
    extraInstructions: `You are exploring the bash-env project - a simulated bash environment in TypeScript.
The project files are available in /project. Use bash commands to explore:
- ls /project/src to see the source structure
- cat /project/README.md to read documentation
- grep -r "pattern" /project/src to search code
- find /project -name "*.ts" to find files

Help the user understand the codebase, find code, and answer questions.`,
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
