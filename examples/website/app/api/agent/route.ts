import { ToolLoopAgent, createAgentUIStreamResponse, stepCountIs } from "ai";
import { createBashTool } from "bash-tool";
import { Bash, OverlayFs } from "just-bash";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_DATA_DIR = join(__dirname, "./_agent-data");

const SYSTEM_INSTRUCTIONS = `You are an expert on just-bash, a TypeScript bash interpreter with an in-memory virtual filesystem.

You have access to a bash sandbox with the full source code of:
- just-bash/ - The main bash interpreter
- bash-tool/ - AI SDK tool for bash


Refer to the README.md of the projects to answer questions about just-bash and bash-tool 
themselves which is your main focus. Never talk about this demo implementation unless asked explicitly.

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

Use cat to read files. Use head, tail to read parts of large files.

Keep responses concise. You do not have access to pnpm, npm, or node.`;

export async function POST(req: Request) {
  const { messages } = await req.json();
  const lastUserMessage = messages.filter((m: { role: string }) => m.role === "user").pop();
  console.log("Prompt:", lastUserMessage?.parts?.[0]?.text);
  const overlayFs = new OverlayFs({ root: AGENT_DATA_DIR, readOnly: true });
  const sandbox = new Bash({ fs: overlayFs, cwd: overlayFs.getMountPoint() });
  const bashToolkit = await createBashTool({
    sandbox,
    destination: overlayFs.getMountPoint(),
  });

  // Create a fresh agent per request for proper streaming
  const agent = new ToolLoopAgent({
    model: "claude-haiku-4-5",
    instructions: SYSTEM_INSTRUCTIONS,
    tools: {
      bash: bashToolkit.tools.bash,
    },
    stopWhen: stepCountIs(20),
  });

  return createAgentUIStreamResponse({
    agent,
    uiMessages: messages,
  });
}
