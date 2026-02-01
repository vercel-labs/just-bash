#!/usr/bin/env node

import { execSync } from "child_process";
import { existsSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

const AGENT_DATA_DIR = "app/api/agent/_agent-data";

const repos = [
  {
    url: "https://github.com/vercel-labs/just-bash.git",
    dir: "just-bash",
  },
  {
    url: "https://github.com/vercel-labs/bash-tool.git",
    dir: "bash-tool",
  },
];

// Clean and create agent-data directory
if (existsSync(AGENT_DATA_DIR)) {
  rmSync(AGENT_DATA_DIR, { recursive: true });
}

for (const repo of repos) {
  const targetDir = join(AGENT_DATA_DIR, repo.dir);
  console.log(`Cloning ${repo.url} into ${targetDir}...`);

  execSync(
    `git clone --depth 1 --single-branch ${repo.url} ${targetDir}`,
    { stdio: "inherit" }
  );

  // Remove .git directory to save space
  const gitDir = join(targetDir, ".git");
  if (existsSync(gitDir)) {
    rmSync(gitDir, { recursive: true });
  }
}

// Create wtf-is-this.md explanation file
const wtfContent = `# WTF Is This?

This is an interactive demo of **just-bash** running entirely in your browser, with an AI agent that can explore the source code.

## Architecture

\`\`\`
+----------------------------------------------------------+
|                        BROWSER                           |
|  +----------+    +----------+    +----------------+      |
|  | xterm.js |--->| just-bash|--->| Virtual FS     |      |
|  | Terminal |    | (browser)|    | (in-memory)    |      |
|  +----------+    +----------+    +----------------+      |
|       |                                                  |
|       | \`agent\` command                                  |
|       v                                                  |
|  +--------------------------------------------------+   |
|  |          SSE Stream (Server-Sent Events)         |   |
|  +--------------------------------------------------+   |
+----------------------------|-----------------------------+
                             |
                             v
+----------------------------------------------------------+
|                        SERVER                            |
|  +-------------+    +----------+    +----------------+   |
|  |ToolLoopAgent|--->| bash-tool|--->| just-bash      |   |
|  | (AI SDK)    |    |          |    | + OverlayFS    |   |
|  |Claude Haiku |    | - bash   |    |                |   |
|  +-------------+    | - read   |    | Real files:    |   |
|                     | - write  |    | - just-bash/   |   |
|                     +----------+    | - bash-tool/   |   |
|                                     +----------------+   |
+----------------------------------------------------------+
\`\`\`

## Components

### 1. xterm.js (Browser Terminal)
- Renders a real terminal in the browser
- Handles keyboard input, cursor, colors, scrolling
- Supports ANSI escape codes for styling

### 2. just-bash (Browser)
- Pure TypeScript bash interpreter
- Runs locally in browser for regular commands
- In-memory virtual filesystem with pre-loaded files
- No network calls for basic commands like \`ls\`, \`cat\`, \`grep\`

### 3. \`agent\` Command
- Custom command that calls the server
- Sends conversation history to \`/api/agent\`
- Streams response via Server-Sent Events (SSE)
- Displays tool calls (bash commands, file reads) in real-time

### 4. ToolLoopAgent (Server - AI SDK)
- Uses Anthropic's Claude Haiku model
- Loops automatically: think -> tool call -> observe -> think -> ...
- Stops after 20 tool calls or when done
- Streams responses back to browser

### 5. bash-tool (Server)
- Provides tools for the AI agent:
  - \`bash\` - Execute bash commands
  - \`readFile\` - Read file contents
  - \`writeFile\` - Write files (disabled in this demo)
- Integrates with just-bash sandbox

### 6. OverlayFS (Server)
- Overlays real filesystem (this source code) as read-only
- Agent can explore just-bash and bash-tool source
- Writes go to memory, not disk

## Data Flow

1. You type \`agent "how does grep work?"\`
2. Browser just-bash runs the \`agent\` command
3. Command POSTs to \`/api/agent\` with message history
4. Server creates ToolLoopAgent with bash-tool
5. Agent thinks, calls tools (bash, readFile), observes results
6. Each step streams back as SSE events
7. Browser displays tool calls and final response
8. Response added to conversation history for multi-turn chat

## Links

- **just-bash**: https://github.com/vercel-labs/just-bash
- **bash-tool**: https://github.com/vercel-labs/bash-tool
- **AI SDK**: https://ai-sdk.dev
- **xterm.js**: https://xtermjs.org
`;

writeFileSync(join(AGENT_DATA_DIR, "wtf-is-this.md"), wtfContent);
console.log("Created wtf-is-this.md");

console.log("Agent data fetched successfully.");
