import { utf8ByteLength } from "./encoding.js";
import type { ExecutionScope } from "./execution-scope.js";
import { ControlFlowError } from "./interpreter/errors.js";
import type { ExecResult } from "./types.js";

/**
 * Chunked interpreter-output sink backed by the one top-level execution
 * budget. Accounting metadata follows bytes as compound commands relay child
 * results, avoiding both budget refreshes and double charging.
 */
export class ExecutionOutputAccumulator {
  private readonly stdoutChunks: string[] = [];
  private readonly stderrChunks: string[] = [];
  private stdoutBytes = 0;
  private stderrBytes = 0;
  private readonly attachedErrors = new WeakSet<ControlFlowError>();

  constructor(
    private readonly scope: ExecutionScope,
    private readonly site: string,
  ) {}

  append(
    stream: "stdout" | "stderr",
    chunk: string,
    alreadyAccountedBytes = 0,
    kind: "text" | "bytes" = "text",
  ): void {
    let bytes: number;
    try {
      bytes = this.scope.appendOutput(
        stream,
        chunk,
        this.site,
        alreadyAccountedBytes,
        kind,
      );
    } catch (error) {
      this.prependTo(error);
      throw error;
    }
    if (chunk) {
      (stream === "stdout" ? this.stdoutChunks : this.stderrChunks).push(chunk);
    }
    if (stream === "stdout") this.stdoutBytes += bytes;
    else this.stderrBytes += bytes;
  }

  /**
   * Attach output retained before a fatal/control-flow error exactly once for
   * this accumulator. The bytes have already been charged by the shared scope,
   * so propagation updates accounting metadata without charging them again.
   */
  prependTo(error: unknown): void {
    if (!(error instanceof ControlFlowError)) return;
    if (this.attachedErrors.has(error)) return;
    this.attachedErrors.add(error);
    error.prependOutput(this.stdout, this.stderr);
  }

  appendResult(result: ExecResult, stdout: string = result.stdout): void {
    const stdoutKind =
      result.stdoutKind === "bytes" || result.stdoutEncoding === "binary"
        ? "bytes"
        : "text";
    const stdoutBytes =
      stdoutKind === "bytes" ? stdout.length : utf8ByteLength(stdout);
    this.append(
      "stdout",
      stdout,
      Math.min(result.internalOutputAccounting?.stdout ?? 0, stdoutBytes),
      stdoutKind,
    );
    this.append(
      "stderr",
      result.stderr,
      result.internalOutputAccounting?.stderr ?? 0,
    );
  }

  build(exitCode: number, extra?: Partial<ExecResult>): ExecResult {
    return {
      stdout: this.stdoutChunks.join(""),
      stderr: this.stderrChunks.join(""),
      exitCode,
      ...extra,
      internalOutputAccounting: {
        stdout: this.stdoutBytes,
        stderr: this.stderrBytes,
      },
    };
  }

  get stdout(): string {
    return this.stdoutChunks.join("");
  }

  get stderr(): string {
    return this.stderrChunks.join("");
  }
}
