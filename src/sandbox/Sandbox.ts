import type { Writable } from "node:stream";
import { Bash } from "../Bash.js";
import type { IFileSystem } from "../fs/interface.js";
import { OverlayFs } from "../fs/overlay-fs/index.js";
import type { NetworkConfig } from "../network/index.js";
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

export interface RunCommandParams {
  cmd: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Run the command with sudo. No-op in just-bash (already runs as root). */
  sudo?: boolean;
  /** Return immediately with a live Command object instead of waiting for completion. */
  detached?: boolean;
  /** Stream standard output to a writable. Written after command completes. */
  stdout?: Writable;
  /** Stream standard error to a writable. Written after command completes. */
  stderr?: Writable;
  signal?: AbortSignal;
}

export interface WriteFilesInput {
  [path: string]: string | { content: string; encoding?: "utf-8" | "base64" };
}

/** Escape a string for safe inclusion in a shell command. */
function shellEscape(arg: string): string {
  if (arg === "") return "''";
  // If arg contains no special characters, return as-is
  if (/^[a-zA-Z0-9._\-/=:@]+$/.test(arg)) return arg;
  // Single-quote the argument, escaping any embedded single quotes
  return `'${arg.replace(/'/g, "'\\''")}'`;
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

  // Overload: object form with detached
  async runCommand(
    params: RunCommandParams & { detached: true },
  ): Promise<Command>;
  // Overload: object form (default: waits for completion)
  async runCommand(params: RunCommandParams): Promise<CommandFinished>;
  // Overload: string + args (Vercel style)
  async runCommand(
    command: string,
    args: string[],
    opts?: { signal?: AbortSignal },
  ): Promise<CommandFinished>;
  // Overload: string only or legacy string + opts
  async runCommand(
    command: string,
    opts?: { cwd?: string; env?: Record<string, string> },
  ): Promise<CommandFinished>;
  async runCommand(
    cmdOrParams: string | RunCommandParams,
    argsOrOpts?:
      | string[]
      | { cwd?: string; env?: Record<string, string> }
      | { signal?: AbortSignal },
    opts?: { signal?: AbortSignal },
  ): Promise<Command | CommandFinished> {
    let cmdLine: string;
    let cwd: string | undefined;
    let env: Record<string, string> | undefined;
    let detached = false;
    let stdoutStream: Writable | undefined;
    let stderrStream: Writable | undefined;

    if (typeof cmdOrParams === "object") {
      // Object form: runCommand({ cmd, args?, cwd?, env?, detached?, ... })
      const p = cmdOrParams;
      cmdLine = p.args
        ? `${p.cmd} ${p.args.map(shellEscape).join(" ")}`
        : p.cmd;
      cwd = p.cwd;
      env = p.env;
      detached = p.detached ?? false;
      stdoutStream = p.stdout;
      stderrStream = p.stderr;
    } else if (Array.isArray(argsOrOpts)) {
      // String + args form: runCommand('node', ['--version'])
      cmdLine = `${cmdOrParams} ${argsOrOpts.map(shellEscape).join(" ")}`;
    } else {
      // String form or legacy string + opts
      cmdLine = cmdOrParams;
      const legacyOpts = argsOrOpts as
        | { cwd?: string; env?: Record<string, string> }
        | undefined;
      cwd = legacyOpts?.cwd;
      env = legacyOpts?.env;
    }

    const resolvedCwd = cwd ?? this.bashEnv.getCwd();
    const explicitCwd = cwd !== undefined;
    const command = new Command(
      this.bashEnv,
      cmdLine,
      resolvedCwd,
      env,
      explicitCwd,
    );

    if (detached) {
      return command;
    }

    // Wait for completion, pipe to streams if provided
    const finished = await command.wait();

    if (stdoutStream) {
      const stdout = await command.stdout();
      if (stdout) stdoutStream.write(stdout);
    }
    if (stderrStream) {
      const stderr = await command.stderr();
      if (stderr) stderrStream.write(stderr);
    }

    return finished;
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
