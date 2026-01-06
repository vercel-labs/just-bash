#!/usr/bin/env npx tsx
/**
 * just-bash Code Explorer Agent
 *
 * Usage: npx tsx main.ts
 *
 * Requires ANTHROPIC_API_KEY environment variable.
 */

import { createAgent } from "./agent.js";
import { runShell } from "./shell.js";

let lastWasToolCall = false;

const agent = await createAgent({
  onToolCall: (command) => {
    const prefix = lastWasToolCall ? "" : "\n";
    console.log(
      `${prefix}\x1b[34m\x1b[1mExecuting bash tool:\x1b[0m \x1b[36m${command.trim()}\x1b[0m`
    );
    lastWasToolCall = true;
  },
  onText: () => {
    lastWasToolCall = false;
  },
});
runShell(agent);
