# just-bash Code Explorer Agent

An interactive AI agent that lets you chat about the just-bash codebase using natural language.

## Files

- `main.ts` - Entry point
- `agent.ts` - Agent logic (createBashTool + AI SDK)
- `shell.ts` - Interactive readline shell

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set your Anthropic API key:

   ```bash
   export ANTHROPIC_API_KEY=your-key-here
   ```

3. Run:
   ```bash
   npm start
   ```

## Logging

All bash commands are logged to `commands.log` with execution details:

```
[INFO] exec {"command":"ls src"}
[DEBUG] stdout {"output":"Bash.ts\ncommands\n..."}
[INFO] exit {"exitCode":0}
```

## Usage

Ask questions like:

- "What commands are available?"
- "How is the grep command implemented?"
- "Show me the Bash class"
- "Find all test files"

Type `exit` to quit.

## Development

```bash
npm run typecheck
```
