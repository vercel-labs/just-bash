/**
 * BashProvider - SandboxProvider implementation using just-bash.
 * This is the default provider for BashSandbox.
 */

import { Bash, type BashOptions } from "../../Bash.js";
import type { IFileSystem, InitialFiles } from "../../fs/interface.js";
import { OverlayFs } from "../../fs/overlay-fs/index.js";
import type {
  ExecOptions,
  ExecResult,
  FileInput,
  SandboxProvider,
} from "../provider.js";

export interface BashProviderOptions {
  /**
   * Initial files to populate the virtual filesystem.
   */
  files?: InitialFiles;

  /**
   * Current working directory. Defaults to /home/user.
   */
  cwd?: string;

  /**
   * Environment variables.
   */
  env?: Record<string, string>;

  /**
   * Path to a directory to use as the root of an OverlayFs.
   * Reads come from this directory, writes stay in memory.
   */
  overlayRoot?: string;

  /**
   * Network configuration for commands like curl.
   * Disabled by default for security.
   */
  network?: BashOptions["network"];

  /**
   * Execution limits to prevent runaway compute.
   */
  executionLimits?: BashOptions["executionLimits"];

  /**
   * Optional list of command names to register.
   * If not provided, all built-in commands are available.
   */
  commands?: BashOptions["commands"];

  /**
   * Custom commands to register alongside built-in commands.
   */
  customCommands?: BashOptions["customCommands"];
}

export class BashProvider implements SandboxProvider {
  private bash: Bash;

  constructor(options: BashProviderOptions = {}) {
    // Determine filesystem
    let fs: IFileSystem | undefined;
    if (options.overlayRoot) {
      fs = new OverlayFs({ root: options.overlayRoot });
    }

    this.bash = new Bash({
      fs,
      files: fs ? undefined : options.files,
      cwd: options.cwd,
      env: options.env,
      network: options.network,
      executionLimits: options.executionLimits,
      commands: options.commands,
      customCommands: options.customCommands,
    });
  }

  async exec(cmd: string, opts?: ExecOptions): Promise<ExecResult> {
    const result = await this.bash.exec(cmd, opts);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    };
  }

  async writeFiles(files: Record<string, FileInput>): Promise<void> {
    for (const [path, content] of Object.entries(files)) {
      let data: string;
      if (typeof content === "string") {
        data = content;
      } else {
        if (content.encoding === "base64") {
          data = Buffer.from(content.content, "base64").toString("utf-8");
        } else {
          data = content.content;
        }
      }

      // Ensure parent directory exists
      const parentDir = path.substring(0, path.lastIndexOf("/")) || "/";
      if (parentDir !== "/") {
        await this.bash.exec(`mkdir -p "${parentDir}"`);
      }

      await this.bash.writeFile(path, data);
    }
  }

  async readFile(path: string, encoding?: "utf-8" | "base64"): Promise<string> {
    const content = await this.bash.readFile(path);
    if (encoding === "base64") {
      return Buffer.from(content).toString("base64");
    }
    return content;
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const flags = opts?.recursive ? "-p " : "";
    await this.bash.exec(`mkdir ${flags}"${path}"`);
  }

  async stop(): Promise<void> {
    // No-op for just-bash
  }

  /**
   * Get the underlying Bash instance for advanced operations.
   */
  get bashInstance(): Bash {
    return this.bash;
  }
}
