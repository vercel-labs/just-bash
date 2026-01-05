/**
 * VercelProvider - SandboxProvider implementation using @vercel/sandbox.
 * This provider runs commands in a real VM with full binary execution support.
 *
 * Note: @vercel/sandbox is a peer dependency and must be installed separately.
 */

import type {
  ExecOptions,
  ExecResult,
  FileInput,
  SandboxProvider,
} from "../provider.js";

export interface VercelProviderOptions {
  /**
   * Current working directory.
   */
  cwd?: string;

  /**
   * Environment variables.
   */
  env?: Record<string, string>;

  /**
   * Timeout in milliseconds.
   */
  timeoutMs?: number;
}

// Type definitions for @vercel/sandbox (to avoid hard dependency)
interface VercelSandbox {
  runCommand(
    cmd: string,
    opts?: { cwd?: string; env?: Record<string, string> },
  ): Promise<VercelCommand>;
  writeFiles(
    files: Record<string, string | { content: string; encoding?: string }>,
  ): Promise<void>;
  readFile(path: string, encoding?: string): Promise<string>;
  stop(): Promise<void>;
}

interface VercelCommand {
  wait(): Promise<{ exitCode: number }>;
  stdout(): Promise<string>;
  stderr(): Promise<string>;
}

interface VercelSandboxModule {
  Sandbox: {
    create(opts?: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
    }): Promise<VercelSandbox>;
  };
}

export class VercelProvider implements SandboxProvider {
  private vm: VercelSandbox | null = null;
  private options: VercelProviderOptions;
  private initPromise: Promise<void> | null = null;

  constructor(options: VercelProviderOptions = {}) {
    this.options = options;
  }

  private async ensureInitialized(): Promise<VercelSandbox> {
    if (this.vm) {
      return this.vm;
    }

    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }

    await this.initPromise;
    // After initialize(), this.vm is guaranteed to be set
    // biome-ignore lint/style/noNonNullAssertion: vm is set by initialize()
    return this.vm!;
  }

  private async initialize(): Promise<void> {
    let vercelSandbox: VercelSandboxModule;
    try {
      // Dynamic import - @vercel/sandbox is a peer dependency
      // @ts-expect-error - @vercel/sandbox is optional peer dependency
      vercelSandbox = (await import("@vercel/sandbox")) as VercelSandboxModule;
    } catch {
      throw new Error(
        "Failed to import @vercel/sandbox. Install it with: pnpm add @vercel/sandbox",
      );
    }

    this.vm = await vercelSandbox.Sandbox.create({
      cwd: this.options.cwd,
      env: this.options.env,
      timeoutMs: this.options.timeoutMs,
    });
  }

  async exec(cmd: string, opts?: ExecOptions): Promise<ExecResult> {
    const vm = await this.ensureInitialized();
    const command = await vm.runCommand(cmd, opts);
    const finished = await command.wait();
    return {
      stdout: await command.stdout(),
      stderr: await command.stderr(),
      exitCode: finished.exitCode,
    };
  }

  async writeFiles(files: Record<string, FileInput>): Promise<void> {
    const vm = await this.ensureInitialized();
    // Convert to @vercel/sandbox format
    const converted: Record<
      string,
      string | { content: string; encoding?: string }
    > = {};
    for (const [path, content] of Object.entries(files)) {
      if (typeof content === "string") {
        converted[path] = content;
      } else {
        converted[path] = {
          content: content.content,
          encoding: content.encoding,
        };
      }
    }
    await vm.writeFiles(converted);
  }

  async readFile(path: string, encoding?: "utf-8" | "base64"): Promise<string> {
    const vm = await this.ensureInitialized();
    return vm.readFile(path, encoding);
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const vm = await this.ensureInitialized();
    const flags = opts?.recursive ? "-p " : "";
    await vm.runCommand(`mkdir ${flags}"${path}"`);
  }

  async stop(): Promise<void> {
    if (this.vm) {
      await this.vm.stop();
      this.vm = null;
      this.initPromise = null;
    }
  }
}
