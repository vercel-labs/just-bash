/**
 * BashSandbox - Stateful sandbox with AI SDK tool support.
 *
 * @example
 * ```typescript
 * import { BashSandbox } from "just-bash";
 *
 * // Create sandbox (default: just-bash)
 * const sandbox = new BashSandbox({
 *   files: { "/data/users.json": '[{"name": "Alice"}]' },
 * });
 *
 * // Use as AI SDK tool
 * const agent = new ToolLoopAgent({
 *   tools: { bash: sandbox.tool() },
 * });
 *
 * // Direct operations
 * await sandbox.exec("ls -la");
 * await sandbox.writeFiles({ "/config.json": "{}" });
 * const content = await sandbox.readFile("/config.json");
 *
 * // Switch to full VM (@vercel/sandbox)
 * const vmSandbox = new BashSandbox({ fullVM: true });
 * ```
 */

import { type Tool, tool, zodSchema } from "ai";
import { z } from "zod";
import type { BashOptions } from "../Bash.js";
import type { CommandName } from "../commands/registry.js";
import type { InitialFiles } from "../fs/interface.js";
import type {
  ExecOptions,
  ExecResult,
  FileInput,
  SandboxProvider,
} from "./provider.js";
import { BashProvider } from "./providers/bash-provider.js";
import { VercelProvider } from "./providers/vercel-provider.js";

export interface BashSandboxOptions {
  /**
   * Use @vercel/sandbox for real VM execution.
   * When true, commands run in a real environment with full binary support.
   * Default: false (uses just-bash in-memory sandbox)
   */
  fullVM?: boolean;

  /**
   * Custom sandbox provider.
   * Takes precedence over fullVM option.
   */
  provider?: SandboxProvider;

  /**
   * Initial files to populate the filesystem.
   * Ignored when fullVM is true (use writeFiles after creation).
   */
  files?: InitialFiles;

  /**
   * Current working directory.
   */
  cwd?: string;

  /**
   * Environment variables.
   */
  env?: Record<string, string>;

  /**
   * Path to a directory to use as the root of an OverlayFs.
   * Reads come from this directory, writes stay in memory.
   * Only applicable when fullVM is false.
   */
  overlayRoot?: string;

  /**
   * Network configuration for commands like curl.
   * Only applicable when fullVM is false.
   */
  network?: BashOptions["network"];

  /**
   * Execution limits to prevent runaway compute.
   * Only applicable when fullVM is false.
   */
  executionLimits?: BashOptions["executionLimits"];

  /**
   * Optional list of command names to register.
   * Only applicable when fullVM is false.
   */
  commands?: CommandName[];

  /**
   * Custom commands to register alongside built-in commands.
   * Only applicable when fullVM is false.
   */
  customCommands?: BashOptions["customCommands"];

  /**
   * Timeout in milliseconds (only for fullVM).
   */
  timeoutMs?: number;
}

export interface ToolOptions {
  /**
   * Additional instructions to append to the tool description.
   */
  extraInstructions?: string;

  /**
   * Callback invoked before each command execution.
   */
  onCall?: (command: string) => void;
}

type BashToolInput = { command: string };
type BashToolOutput = { stdout: string; stderr: string; exitCode: number };

const bashToolSchema = z.object({
  command: z.string().describe("The bash command to execute"),
});

export class BashSandbox {
  private _provider: SandboxProvider;
  private options: BashSandboxOptions;

  constructor(options: BashSandboxOptions = {}) {
    this.options = options;

    // Determine provider
    if (options.provider) {
      this._provider = options.provider;
    } else if (options.fullVM) {
      this._provider = new VercelProvider({
        cwd: options.cwd,
        env: options.env,
        timeoutMs: options.timeoutMs,
      });
    } else {
      this._provider = new BashProvider({
        files: options.files,
        cwd: options.cwd,
        env: options.env,
        overlayRoot: options.overlayRoot,
        network: options.network,
        executionLimits: options.executionLimits,
        commands: options.commands,
        customCommands: options.customCommands,
      });
    }
  }

  /**
   * Get the underlying sandbox provider for direct access.
   */
  get sandbox(): SandboxProvider {
    return this._provider;
  }

  /**
   * Execute a command in the sandbox.
   */
  async exec(cmd: string, opts?: ExecOptions): Promise<ExecResult> {
    return this._provider.exec(cmd, opts);
  }

  /**
   * Write files to the sandbox filesystem.
   */
  async writeFiles(files: Record<string, FileInput>): Promise<void> {
    return this._provider.writeFiles(files);
  }

  /**
   * Read a file from the sandbox filesystem.
   */
  async readFile(path: string, encoding?: "utf-8" | "base64"): Promise<string> {
    return this._provider.readFile(path, encoding);
  }

  /**
   * Create a directory in the sandbox filesystem.
   */
  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    return this._provider.mkdir(path, opts);
  }

  /**
   * Stop/cleanup the sandbox.
   * No-op for just-bash, required for fullVM.
   */
  async stop(): Promise<void> {
    return this._provider.stop();
  }

  /**
   * Create an AI SDK compatible tool that uses this sandbox.
   * The tool shares state with the sandbox - files added via writeFiles
   * are visible to the AI, and files created by the AI are readable via readFile.
   */
  tool(options: ToolOptions = {}): Tool<BashToolInput, BashToolOutput> {
    const description = this.generateToolDescription(options);

    return tool({
      description,
      inputSchema: zodSchema(bashToolSchema),
      execute: async ({ command }) => {
        options.onCall?.(command);
        const result = await this._provider.exec(command);
        return {
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        };
      },
    });
  }

  private generateToolDescription(options: ToolOptions): string {
    const lines: string[] = [
      "Execute bash commands in a sandboxed environment.",
      "",
    ];

    if (this.options.fullVM) {
      lines.push(
        "This is a full VM environment with real binary execution support.",
      );
      lines.push("You can run any command including node, python, etc.");
    } else {
      lines.push(
        "This is a simulated bash environment with a virtual filesystem.",
      );
      lines.push(
        "Commands run in isolation without access to the host system.",
      );
    }
    lines.push("");

    // Add file discovery hints if files are provided (only for bash provider)
    if (
      !this.options.fullVM &&
      this.options.files &&
      Object.keys(this.options.files).length > 0
    ) {
      const filePaths = Object.keys(this.options.files);
      const sampleFiles = filePaths.slice(0, 5);

      lines.push("Available files:");
      for (const file of sampleFiles) {
        lines.push(`  ${file}`);
      }
      if (filePaths.length > 5) {
        lines.push(`  ... and ${filePaths.length - 5} more`);
      }
      lines.push("");
    }

    lines.push("Common operations:");
    lines.push("  ls -la              # List files with details");
    lines.push("  find . -name '*.ts' # Find files by pattern");
    lines.push("  grep -r 'pattern' . # Search file contents");
    lines.push("  cat <file>          # View file contents");
    lines.push("");

    lines.push("To discover commands and their options:");
    lines.push("  help                # List all available commands");
    lines.push("  <command> --help    # Show options for a specific command");
    lines.push("");

    if (this.options.commands?.length) {
      lines.push(`Available commands: ${this.options.commands.join(", ")}`);
      lines.push("");
    }

    if (this.options.network) {
      lines.push("Network access via curl is enabled for this environment.");
      lines.push("");
    }

    if (options.extraInstructions) {
      lines.push(options.extraInstructions);
    }

    return lines.join("\n").trim();
  }
}
