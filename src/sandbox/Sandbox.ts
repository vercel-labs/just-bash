import { BashEnv } from "../BashEnv.js";
import type { IFileSystem } from "../fs-interface.js";
import type { NetworkConfig } from "../network/index.js";
import type { CommandFinished } from "./Command.js";
import { Command } from "./Command.js";

export interface SandboxOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  // BashEnv-specific extensions (not in Vercel Sandbox API)
  fs?: IFileSystem;
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
  private bashEnv: BashEnv;

  private constructor(bashEnv: BashEnv) {
    this.bashEnv = bashEnv;
  }

  static async create(opts?: SandboxOptions): Promise<Sandbox> {
    const bashEnv = new BashEnv({
      env: opts?.env,
      cwd: opts?.cwd,
      // BashEnv-specific extensions
      fs: opts?.fs,
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
    // If cwd option is provided, cd to it first
    if (opts?.cwd) {
      await this.bashEnv.exec(`cd ${opts.cwd}`);
    }

    // If env options provided, set them temporarily
    if (opts?.env) {
      for (const [key, value] of Object.entries(opts.env)) {
        await this.bashEnv.exec(`export ${key}=${value}`);
      }
    }

    const cwd = this.bashEnv.getCwd();
    return new Command(this.bashEnv, cmd, cwd);
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
   * BashEnv-specific: Get the underlying BashEnv instance for advanced operations.
   * Not available in Vercel Sandbox API.
   */
  get bashEnvInstance(): BashEnv {
    return this.bashEnv;
  }
}

export { Command };
export type { CommandFinished };
export type { OutputMessage } from "./Command.js";
