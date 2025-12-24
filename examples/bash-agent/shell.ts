/**
 * Interactive shell for the bash-env code explorer agent
 */

import * as readline from "node:readline";
import type { AgentRunner } from "./agent.js";

const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

export function runShell(agent: AgentRunner): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`${colors.cyan}${colors.bold}╔══════════════════════════════════════════════════════════════╗
║              bash-env Code Explorer Agent                     ║
║         Ask questions about the codebase!                     ║
╚══════════════════════════════════════════════════════════════╝${colors.reset}
`);
  console.log(
    `${colors.dim}Type your question and press Enter. Type 'exit' to quit.${colors.reset}\n`
  );

  const prompt = (): void => {
    rl.question(`${colors.green}You:${colors.reset} `, async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      if (trimmed.toLowerCase() === "exit") {
        console.log("\nGoodbye!");
        rl.close();
        process.exit(0);
      }

      process.stdout.write(
        `\n${colors.blue}${colors.bold}Agent:${colors.reset} `
      );

      try {
        await agent.chat(trimmed, {
          onText: (text) => process.stdout.write(text),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`\n${colors.yellow}Error: ${message}${colors.reset}`);
      }

      console.log("");
      prompt();
    });
  };

  prompt();
}
