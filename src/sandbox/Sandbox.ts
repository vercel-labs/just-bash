import { Bash } from "../Bash.js";
import type { IFileSystem } from "../fs-interface.js";
import type { NetworkConfig } from "../network/index.js";
import { OverlayFs } from "../overlay-fs/index.js";
import type { CommandFinished } from "./Command.js";
import { Command } from "./Command.js";

export interface SandboxOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  // Bash-specific extensions (not in Vercel Sandbox API)
  /**
   * Custom filesystem implementation.
   * Mutually exclusive with `overlayRoot`.
   */
  fs?: IFileSystem;
  /**
   * Path to a directory to use as the root of an OverlayFs.
   * Reads come from this directory, writes stay in memory.
   * Mutually exclusive with `fs`.
   */
  overlayRoot?: string;
  maxCallDepth?: number;
  maxCommandCount?: number;
  maxLoopIterations?: number;
  /**
   * Network configuration for commands like curl.
   * Network access is disabled by default - you must explicitly configure allowed URLs.
   */
  network?: NetworkConfig;
}

export interface WriteFilesInput {
  [path: string]: string | { content: string; encoding?: "utf-8" | "base64" };
}

export class Sandbox {
  private bashEnv: Bash;

  private constructor(bashEnv: Bash) {
    this.bashEnv = bashEnv;
  }

  static async create(opts?: SandboxOptions): Promise<Sandbox> {
    // Determine filesystem: overlayRoot creates an OverlayFs, otherwise use provided fs
    let fs: IFileSystem | undefined = opts?.fs;
    if (opts?.overlayRoot) {
      if (opts?.fs) {
        throw new Error("Cannot specify both 'fs' and 'overlayRoot' options");
      }
      fs = new OverlayFs({ root: opts.overlayRoot });
    }

    const bashEnv = new Bash({
      env: opts?.env,
      cwd: opts?.cwd,
      // Bash-specific extensions
      fs,
      maxCallDepth: opts?.maxCallDepth,
      maxCommandCount: opts?.maxCommandCount,
      maxLoopIterations: opts?.maxLoopIterations,
      network: opts?.network,
    });
    return new Sandbox(bashEnv);
  }

  async runCommand(
    cmd: string,
    opts?: { cwd?: string; env?: Record<string, string> },
  ): Promise<Command> {
    // Use per-exec options for cwd and env (they don't persist after the command)
    const cwd = opts?.cwd ?? this.bashEnv.getCwd();
    const explicitCwd = opts?.cwd !== undefined;
    return new Command(this.bashEnv, cmd, cwd, opts?.env, explicitCwd);
  }

  async writeFiles(files: WriteFilesInput): Promise<void> {
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
        await this.bashEnv.exec(`mkdir -p ${parentDir}`);
      }

      await this.bashEnv.writeFile(path, data);
    }
  }

  async readFile(path: string, encoding?: "utf-8" | "base64"): Promise<string> {
    const content = await this.bashEnv.readFile(path);
    if (encoding === "base64") {
      return Buffer.from(content).toString("base64");
    }
    return content;
  }

  async mkDir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const flags = opts?.recursive ? "-p" : "";
    await this.bashEnv.exec(`mkdir ${flags} ${path}`);
  }

  async stop(): Promise<void> {
    // No-op for local simulation
  }

  async extendTimeout(_ms: number): Promise<void> {
    // No-op for local simulation
  }

  get domain(): string | undefined {
    return undefined; // Not applicable for local simulation
  }

  /**
   * Bash-specific: Get the underlying Bash instance for advanced operations.
   * Not available in Vercel Sandbox API.
   */
  get bashEnvInstance(): Bash {
    return this.bashEnv;
  }
}

export { Command };
export type { CommandFinished };
export type { OutputMessage } from "./Command.js";
