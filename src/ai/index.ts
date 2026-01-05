import { type Tool, tool, zodSchema } from "ai";
import { z } from "zod";
import type { BashLogger, BashOptions } from "../Bash.js";
import type { CommandName } from "../commands/registry.js";
import type { InitialFiles } from "../fs/interface.js";
import { BashSandbox } from "../sandbox/BashSandbox.js";

type BashToolInput = { command: string };
type BashToolOutput = { stdout: string; stderr: string; exitCode: number };

export interface CreateBashToolOptions {
  /**
   * Run commands in a full VM (@vercel/sandbox) instead of the simulated bash.
   * When true, commands run in a real environment with full binary support
   * (node, python, etc.).
   *
   * @default false
   *
   * @example
   * ```typescript
   * // Upgrade to full VM - just add fullVM: true
   * const { tool, filesystem } = createBashTool({
   *   files: { "/data/users.json": '[...]' },
   *   fullVM: true,
   * });
   * ```
   */
  fullVM?: boolean;

  /**
   * Initial files to populate the filesystem.
   */
  files?: InitialFiles;

  /**
   * Additional instructions to append to the tool description.
   */
  extraInstructions?: string;

  /**
   * Optional list of command names to register.
   * If not provided, all built-in commands are available.
   * Use this to restrict which commands can be executed.
   * Only applies when fullVM is false.
   */
  commands?: CommandName[];

  /**
   * Custom commands to register alongside built-in commands.
   * These take precedence over built-ins with the same name.
   * Only applies when fullVM is false.
   */
  customCommands?: BashOptions["customCommands"];

  /**
   * Network configuration for commands like curl.
   * Disabled by default for security.
   * Only applies when fullVM is false.
   */
  network?: BashOptions["network"];

  /**
   * Environment variables to set in the bash environment.
   */
  env?: Record<string, string>;

  /**
   * Current working directory. Defaults to /home/user.
   */
  cwd?: string;

  /**
   * Callback invoked before each command execution.
   * Useful for logging or monitoring tool calls.
   */
  onCall?: (command: string) => void;

  /**
   * Optional logger for execution tracing.
   * Logs exec commands (info), stdout (debug), stderr (info), and exit codes (info).
   * Only applies when fullVM is false.
   */
  logger?: BashLogger;
}

export interface CreateBashToolResult {
  /**
   * AI SDK compatible tool for executing bash commands.
   */
  tool: Tool<BashToolInput, BashToolOutput>;

  /**
   * The filesystem interface for reading/writing files.
   * Use this to add files before the AI runs, or read files the AI created.
   *
   * When `fullVM: true`, this is backed by @vercel/sandbox.
   * Otherwise, it's an in-memory virtual filesystem.
   */
  filesystem: BashSandbox;
}

function generateInstructions(
  options: CreateBashToolOptions,
  isFullVM = false,
): string {
  const lines: string[] = [
    "Execute bash commands in a sandboxed environment.",
    "",
  ];

  if (isFullVM) {
    lines.push(
      "This is a full VM environment with real binary execution support.",
    );
    lines.push("You can run any command including node, python, etc.");
  } else {
    lines.push(
      "This is a simulated bash environment with a virtual filesystem.",
    );
    lines.push("Commands run in isolation without access to the host system.");
  }
  lines.push("");

  // Add file discovery hints if files are provided
  if (options.files && Object.keys(options.files).length > 0) {
    const filePaths = Object.keys(options.files);
    const sampleFiles = filePaths.slice(0, 5);

    lines.push("Available files:");
    for (const file of sampleFiles) {
      lines.push(`  ${file}`);
    }
    if (filePaths.length > 5) {
      lines.push(`  ... and ${filePaths.length - 5} more`);
    }
    lines.push("");
    lines.push("Common operations:");
    lines.push("  ls -la              # List files with details");
    lines.push("  find . -name '*.ts' # Find files by pattern");
    lines.push("  grep -r 'pattern' . # Search file contents");
    lines.push("  cat <file>          # View file contents");
    lines.push("");
  }

  lines.push("To discover commands and their options:");
  lines.push("  help                # List all available commands");
  lines.push("  <command> --help    # Show options for a specific command");
  lines.push("");

  if (options.commands?.length) {
    lines.push(`Available commands: ${options.commands.join(", ")}`);
    lines.push("");
  }

  if (options.network) {
    lines.push("Network access via curl is enabled for this environment.");
    lines.push("");
  }

  if (options.extraInstructions) {
    lines.push(options.extraInstructions);
  }

  return lines.join("\n").trim();
}

const bashToolSchema = z.object({
  command: z.string().describe("The bash command to execute"),
});

/**
 * Creates an AI SDK tool for executing bash commands in a sandboxed environment.
 *
 * Returns both the tool and the filesystem, so you can interact with
 * files before/after the AI runs.
 *
 * @example Simple usage (in-memory bash simulation)
 * ```typescript
 * import { createBashTool } from "just-bash/ai";
 * import { generateText } from "ai";
 *
 * const { tool } = createBashTool({
 *   files: { "/data/users.json": '[{"name": "Alice"}]' },
 * });
 *
 * const result = await generateText({
 *   model: yourModel,
 *   tools: { bash: tool },
 *   prompt: "Count the users in /data/users.json",
 * });
 * ```
 *
 * @example Upgrade to full VM - just add fullVM: true
 * ```typescript
 * const { tool, filesystem } = createBashTool({
 *   files: { "/data/users.json": '[{"name": "Alice"}]' },
 *   fullVM: true,
 * });
 *
 * // Now commands run in a real VM with node, python, etc.
 * ```
 *
 * @example Interact with filesystem before/after AI runs
 * ```typescript
 * const { tool, filesystem } = createBashTool({
 *   files: { "/data/input.json": '{}' },
 * });
 *
 * // Write files that the AI can see
 * await filesystem.writeFiles({ "/config.json": '{"debug": true}' });
 *
 * // Run AI
 * await generateText({ model, tools: { bash: tool }, prompt: "..." });
 *
 * // Read what AI created
 * const output = await filesystem.readFile("/output.txt");
 * ```
 */
export function createBashTool(
  options: CreateBashToolOptions = {},
): CreateBashToolResult {
  const filesystem = new BashSandbox({
    fullVM: options.fullVM,
    files: options.files,
    cwd: options.cwd,
    env: options.env,
    network: options.network,
    commands: options.commands,
    customCommands: options.customCommands,
  });

  const bashTool = tool({
    description: generateInstructions(options, options.fullVM),
    inputSchema: zodSchema(bashToolSchema),
    execute: async ({ command }) => {
      options.onCall?.(command);
      const result = await filesystem.exec(command);
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },
  });

  return { tool: bashTool, filesystem };
}

export type BashTool = ReturnType<typeof createBashTool>["tool"];
