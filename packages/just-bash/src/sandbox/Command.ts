import type { Bash } from "../Bash.js";
import { _clearTimeout, _setTimeout } from "../timers.js";
import type { ExecResult } from "../types.js";

export interface OutputMessage {
  type: "stdout" | "stderr";
  data: string;
  timestamp: Date;
}

export class Command {
  readonly cmdId: string;
  readonly cwd: string;
  readonly startedAt: Date;
  exitCode: number | undefined;

  private bashEnv: Bash;
  private cmdLine: string;
  private env?: Record<string, string>;
  private explicitCwd: boolean;
  private signal?: AbortSignal;
  private timeoutMs?: number;
  private abortController = new AbortController();
  private timeoutId: ReturnType<typeof _setTimeout> | undefined;
  private externalAbortListener: (() => void) | undefined;
  private resultPromise: Promise<ExecResult>;

  constructor(
    bashEnv: Bash,
    cmdLine: string,
    cwd: string,
    env?: Record<string, string>,
    explicitCwd = false,
    signal?: AbortSignal,
    timeoutMs?: number,
  ) {
    this.cmdId = crypto.randomUUID();
    this.cwd = cwd;
    this.startedAt = new Date();
    this.bashEnv = bashEnv;
    this.cmdLine = cmdLine;
    this.env = env;
    this.explicitCwd = explicitCwd;
    this.signal = signal;
    this.timeoutMs = timeoutMs;

    this.setupCancellation();

    // Start execution immediately
    this.resultPromise = this.execute();
  }

  private setupCancellation(): void {
    if (this.signal) {
      if (this.signal.aborted) {
        this.abortController.abort(this.signal.reason);
      } else {
        this.externalAbortListener = () => {
          this.abortController.abort(this.signal?.reason);
        };
        this.signal.addEventListener("abort", this.externalAbortListener, {
          once: true,
        });
      }
    }

    if (this.timeoutMs !== undefined) {
      const timeout = Math.max(0, this.timeoutMs);
      this.timeoutId = _setTimeout(() => {
        this.abortController.abort(
          new Error(`sandbox command timeout after ${timeout}ms`),
        );
      }, timeout);
    }
  }

  private cleanupCancellation(): void {
    if (this.timeoutId !== undefined) {
      _clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    if (this.signal && this.externalAbortListener) {
      this.signal.removeEventListener("abort", this.externalAbortListener);
      this.externalAbortListener = undefined;
    }
  }

  private async execute(): Promise<ExecResult> {
    // Always pass command-specific signal to support cancellation.
    const options = {
      cwd: this.explicitCwd ? this.cwd : undefined,
      env: this.env,
      signal: this.abortController.signal,
    };
    try {
      const result = await this.bashEnv.exec(this.cmdLine, options);
      this.exitCode = result.exitCode;
      return result;
    } finally {
      this.cleanupCancellation();
    }
  }

  async *logs(): AsyncGenerator<OutputMessage, void, unknown> {
    const result = await this.resultPromise;

    // For Bash, we don't have true streaming, so emit all at once
    if (result.stdout) {
      yield { type: "stdout", data: result.stdout, timestamp: new Date() };
    }
    if (result.stderr) {
      yield { type: "stderr", data: result.stderr, timestamp: new Date() };
    }
  }

  async wait(): Promise<CommandFinished> {
    await this.resultPromise;
    return this as CommandFinished;
  }

  async output(): Promise<string> {
    const result = await this.resultPromise;
    return result.stdout + result.stderr;
  }

  async stdout(): Promise<string> {
    const result = await this.resultPromise;
    return result.stdout;
  }

  async stderr(): Promise<string> {
    const result = await this.resultPromise;
    return result.stderr;
  }

  async kill(): Promise<void> {
    this.abortController.abort(new Error("command killed"));
    // Preserve API contract: kill() resolves once cancellation has been requested.
  }
}

export interface CommandFinished extends Command {
  exitCode: number; // Guaranteed to be defined
}
