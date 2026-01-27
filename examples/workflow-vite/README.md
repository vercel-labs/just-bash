# Workflow Vite Example

This example demonstrates using just-bash with [Workflow](https://useworkflow.dev) for durable workflow execution.

## What it demonstrates

- **Serializable Bash instances**: The `Bash` class implements Workflow's serde protocol, allowing instances to be serialized between workflow steps
- **State preservation**: Filesystem state persists across serialization boundaries
- **Serial step execution**: Each step receives, modifies, and returns the Bash instance

## Running the example

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm dev
```

## How it works

The workflow plugin transforms functions marked with `"use step"` and `"use workflow"` directives into durable workflow steps.

Between steps, the Workflow runtime serializes all step outputs (including the `Bash` instance) and deserializes them when needed. This enables:

- **Durability**: Workflow state survives process restarts
- **Resumability**: Workflows can resume from the last completed step
- **Isolation**: Each step runs independently with serialized inputs

## Limitations

1. **Only InMemoryFs**: OverlayFs cannot be serialized (it wraps a real filesystem)
2. **Callbacks not serialized**: `logger`, `trace`, `sleep`, `secureFetch` must be re-configured after deserialize
3. **Custom commands**: Must be re-registered after deserialize
4. **Shell variables per-exec**: In just-bash, each `exec()` call is isolated; shell variables don't persist across calls (filesystem does)
