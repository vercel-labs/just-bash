# Custom Commands Example

This example demonstrates how to extend just-bash with custom TypeScript commands.

## Commands Included

- **uuid** - Generate random UUIDs (`uuid -n 5` for multiple)
- **json-format** - Pretty-print JSON from stdin or file
- **lorem** - Generate lorem ipsum text (`lorem 3` for 3 paragraphs)
- **wordcount** - Count lines, words, and characters with labels
- **reverse** - Reverse text character by character
- **summarize** - Summarize a URL to markdown (uses [@steipete/summarize-core](https://github.com/steipete/summarize))

## Running the Example

```bash
# Install dependencies
pnpm install

# Run the demo
pnpm start

# To enable the summarize command, set your Vercel AI Gateway API key:
AI_GATEWAY_API_KEY=your-key pnpm start
```

## Summarize Command

The `summarize` command fetches content from a URL and generates a markdown summary:

```bash
# Summarize a URL and save to file
summarize https://example.com > summary.md

# Summarize with specific length
summarize --length short https://example.com > summary.md
```

This demonstrates how custom commands can:
- Make network requests (via summarize-core's content extraction)
- Use AI APIs (Vercel AI Gateway with Claude)
- Output to files via shell redirection

## Creating Your Own Commands

Use `defineCommand` from just-bash:

```typescript
import { defineCommand } from "just-bash";

const myCommand = defineCommand("mycommand", async (args, ctx) => {
  // args: command arguments (string[])
  // ctx: CommandContext with fs, cwd, env, stdin, exec
  
  return {
    stdout: "output here\n",
    stderr: "",
    exitCode: 0,
  };
});
```

Then register it:

```typescript
const bash = new Bash({
  customCommands: [myCommand],
});
```

## CommandContext

Your command receives a context object with:

- `fs` - Virtual filesystem interface
- `cwd` - Current working directory
- `env` - Environment variables
- `stdin` - Standard input (from pipes)
- `exec` - Function to run subcommands

