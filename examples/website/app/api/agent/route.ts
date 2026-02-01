import { ToolLoopAgent, createAgentUIStreamResponse } from "ai";
import { createBashTool } from "bash-tool";
import { Bash, OverlayFs } from "just-bash";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DATA_DIR = join(__dirname, "./agent-data");

async function getAgent() {
  // Create OverlayFS with agent-data as root (read-only, writes stay in memory)
  const overlayFs = new OverlayFs({ root: AGENT_DATA_DIR,readOnly: true });
  const sandbox = new Bash({ fs: overlayFs, cwd: overlayFs.getMountPoint() });

  const bashToolkit = await createBashTool({
    sandbox,
    destination: overlayFs.getMountPoint(),
  });

  return new ToolLoopAgent({
    model: "claude-haiku-4-5",
    instructions: `You are an expert on just-bash, a TypeScript bash interpreter with an in-memory virtual filesystem.

You have access to a bash sandbox with the full source code of:
- just-bash/ - The main bash interpreter
- bash-tool/ - AI SDK tool for bash

Use the sandbox to explore the source code, demonstrate commands, and help users understand:
- How to use just-bash and bash-tool
- Bash scripting in general
- The implementation details of just-bash

Key features of just-bash:
- Pure TypeScript implementation (no WASM dependencies)
- In-memory virtual filesystem
- Supports common bash commands: ls, cat, grep, awk, sed, jq, etc.
- Custom command support via defineCommand
- Network access control with URL allowlists

Keep responses concise. When demonstrating something, actually run the commands.`,
    tools: bashToolkit.tools,
  });
}

const agentPromise = getAgent();

export async function POST(req: Request) {
  const { messages } = await req.json();

  const agent = await agentPromise;

  console.log("Received messages:", messages);

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
  });
}
