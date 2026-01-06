/**
 * Minimal AI agent for exploring the just-bash codebase
 *
 * This file contains only the agent logic - see shell.ts for the interactive loop.
 * Uses bash-tool with uploadDirectory to provide read access to the real project files.
 */

import * as path from "node:path";
import { streamText, stepCountIs } from "ai";
import { createBashTool } from "bash-tool";

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
 */
export async function createAgent(
  options: CreateAgentOptions = {}
): Promise<AgentRunner> {
  const projectRoot = path.resolve(import.meta.dirname, "../..");

  const toolkit = await createBashTool({
    uploadDirectory: { source: projectRoot },
    destination: "/workspace",
    extraInstructions: `You are exploring the just-bash project - a simulated bash environment in TypeScript.
Use bash commands to explore:
- ls /workspace/src to see the source structure
- cat /workspace/README.md to read documentation
- grep -r "pattern" /workspace/src to search code
- find /workspace -name "*.ts" to find files

Help the user understand the codebase, find code, and answer questions.`,
    onBeforeBashCall: (input) => {
      options.onToolCall?.(input.command);
      return undefined;
    },
  });

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];

  return {
    async chat(message, callbacks) {
      history.push({ role: "user", content: message });

      let fullText = "";

      const result = streamText({
        model: "anthropic/claude-haiku-4.5",
        tools: { bash: toolkit.bash },
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
