import { type Tool, tool, zodSchema } from "ai";
import { z } from "zod";
import { Bash, type BashOptions } from "../Bash.js";
import type { CommandName } from "../commands/registry.js";
import type { IFileSystem, InitialFiles } from "../fs-interface.js";

type BashToolInput = { command: string };
type BashToolOutput = { stdout: string; stderr: string; exitCode: number };

export interface CreateBashToolOptions {
  /**
   * Initial files to populate the virtual filesystem.
   * The tool instructions will include common operations on a sample of these files.
   * Ignored if `fs` is provided.
   */
  files?: InitialFiles;

  /**
   * Custom filesystem implementation (e.g., OverlayFs for copy-on-write behavior).
   * If provided, `files` option is ignored.
   */
  fs?: IFileSystem;

  /**
   * Additional instructions to append to the tool description.
   */
  extraInstructions?: string;

  /**
   * Optional list of command names to register.
   * If not provided, all built-in commands are available.
   * Use this to restrict which commands can be executed.
   */
  commands?: CommandName[];

  /**
   * Network configuration for commands like curl.
   * Disabled by default for security.
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
}

function generateInstructions(options: CreateBashToolOptions): string {
  const lines: string[] = [
    "Execute bash commands in a virtual environment.",
    "",
    "This is a simulated bash environment with a virtual filesystem. Commands run in isolation without access to the host system.",
    "",
  ];

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

/**
 * Creates an AI SDK tool for executing bash commands in a virtual environment.
 *
 * @example
 * ```typescript
 * import { createBashTool } from "bash-env/ai";
 * import { generateText } from "ai";
 *
 * const bashTool = createBashTool({
 *   files: {
 *     "/src/index.ts": "export const hello = 'world';",
 *     "/README.md": "# My Project",
 *   },
 * });
 *
 * const result = await generateText({
 *   model: yourModel,
 *   tools: { bash: bashTool },
 *   prompt: "List all TypeScript files",
 * });
 * ```
 */
const bashToolSchema = z.object({
  command: z.string().describe("The bash command to execute"),
});

export function createBashTool(
  options: CreateBashToolOptions = {},
): Tool<BashToolInput, BashToolOutput> {
  // Create a shared Bash instance with optional command filtering
  const bashEnv = new Bash({
    fs: options.fs,
    files: options.fs ? undefined : options.files, // files ignored if fs provided
    env: options.env,
    cwd: options.cwd,
    network: options.network,
    commands: options.commands,
  });

  return tool({
    description: generateInstructions(options),
    inputSchema: zodSchema(bashToolSchema),
    execute: async ({ command }) => {
      options.onCall?.(command);
      const result = await bashEnv.exec(command);

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },
  });
}

export type BashTool = ReturnType<typeof createBashTool>;
