import type { Writable } from "node:stream";
import { Bash } from "../Bash.js";
import type { IFileSystem } from "../fs/interface.js";
import { OverlayFs } from "../fs/overlay-fs/index.js";
import { shellJoinArgs } from "../helpers/shell-quote.js";
import type { NetworkConfig } from "../network/index.js";
import type { DefenseInDepthConfig } from "../security/types.js";
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
  /**
   * Defense-in-depth configuration. Defaults to true (enabled).
   * Monkey-patches dangerous JavaScript globals during bash execution.
   */
  defenseInDepth?: DefenseInDepthConfig | boolean;
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

export class Sandbox {
  private bashEnv: Bash;
  private timeoutMs?: number;

  private constructor(bashEnv: Bash, timeoutMs?: number) {
    this.bashEnv = bashEnv;
    this.timeoutMs = timeoutMs;
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
      defenseInDepth: opts?.defenseInDepth,
    });
    return new Sandbox(bashEnv, opts?.timeoutMs);
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
    _opts?: { signal?: AbortSignal },
  ): Promise<Command | CommandFinished> {
    let cmdLine: string;
    let cwd: string | undefined;
    // @banned-pattern-ignore: static keys only, never accessed with user input
    let env: Record<string, string> | undefined;
    let signal: AbortSignal | undefined;
    let detached = false;
    let stdoutStream: Writable | undefined;
    let stderrStream: Writable | undefined;

    if (typeof cmdOrParams === "object") {
      // Object form: runCommand({ cmd, args?, cwd?, env?, detached?, ... })
      const p = cmdOrParams;
      const argv = [p.cmd, ...(p.args ?? [])];
      cmdLine = shellJoinArgs(argv);
      cwd = p.cwd;
      env = p.env;
      signal = p.signal;
      detached = p.detached ?? false;
      stdoutStream = p.stdout;
      stderrStream = p.stderr;
    } else if (Array.isArray(argsOrOpts)) {
      // String + args form: runCommand('node', ['--version'])
      const runOpts = _opts;
      cmdLine = shellJoinArgs([cmdOrParams, ...argsOrOpts]);
      signal = runOpts?.signal;
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
      signal,
      this.timeoutMs,
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
    const cwd = this.bashEnv.getCwd();
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
      const resolvedPath = this.bashEnv.fs.resolvePath(cwd, path);
      const parentDir =
        resolvedPath.substring(0, resolvedPath.lastIndexOf("/")) || "/";
      if (parentDir !== "/") {
        await this.bashEnv.fs.mkdir(parentDir, { recursive: true });
      }

      await this.bashEnv.writeFile(resolvedPath, data);
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
    const resolvedPath = this.bashEnv.fs.resolvePath(
      this.bashEnv.getCwd(),
      path,
    );
    await this.bashEnv.fs.mkdir(resolvedPath, {
      recursive: opts?.recursive ?? false,
    });
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
