import { utf8ByteLength } from "./encoding.js";
import type { ExecutionScope } from "./execution-scope.js";
import { ControlFlowError } from "./interpreter/errors.js";
import type { ExecResult, OutputChunk } from "./types.js";

/**
 * Chunked interpreter-output sink backed by the one top-level execution
 * budget. Accounting metadata follows bytes as compound commands relay child
 * results, avoiding both budget refreshes and double charging.
 */
export class ExecutionOutputAccumulator {
  private readonly stdoutChunks: string[] = [];
  private readonly stderrChunks: string[] = [];
  // The same pieces in arrival order, which is the order the shell produced
  // them. Splitting them across the two arrays above is what discards it.
  private readonly orderedChunks: OutputChunk[] = [];
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
      this.orderedChunks.push({ stream, text: chunk });
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
    const orderMark = this.orderedChunks.length;
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
    // A child that recorded its own ordering knows better than the two entries
    // just appended, which say stdout-then-stderr for the whole child. Swap
    // them for the finer sequence so nesting does not flatten it a level at a
    // time. Skipped when the caller overrode stdout, since the child's chunks
    // then describe content this result no longer carries. Byte accounting is
    // untouched either way: it was charged by the appends above.
    const childChunks =
      stdout === result.stdout ? result.outputChunks : undefined;
    if (childChunks?.length) {
      // Truncate and push rather than splicing the child's chunks in: a spread
      // passes them as arguments, which overflows the stack once the array is
      // long enough. Nothing bounds its length, so it must not be spread.
      this.orderedChunks.length = orderMark;
      for (const chunk of childChunks) {
        this.orderedChunks.push(chunk);
      }
    }
  }

  build(exitCode: number, extra?: Partial<ExecResult>): ExecResult {
    return {
      stdout: this.stdoutChunks.join(""),
      stderr: this.stderrChunks.join(""),
      exitCode,
      ...extra,
      ...(this.orderedChunks.length > 0 && {
        outputChunks: this.orderedChunks,
      }),
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
