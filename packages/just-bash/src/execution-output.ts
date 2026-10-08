import { type OutputKind, utf8ByteLength } from "./encoding.js";
import type { ExecutionScope } from "./execution-scope.js";
import { ControlFlowError } from "./interpreter/errors.js";
import { chunksDescribe } from "./output-chunks.js";
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
    kind: OutputKind = "text",
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
      this.orderedChunks.push({ stream, text: chunk, kind });
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
    error.prependOutput(this.stdout, this.stderr, this.orderedChunks);
  }

  /**
   * Absorb the output an aborted child carried out on a control-flow error,
   * the way a subshell swallows `exit` and keeps what ran before it.
   */
  appendError(error: ControlFlowError): void {
    const orderMark = this.orderedChunks.length;
    this.append("stdout", error.stdout, error.internalOutputAccounting.stdout);
    this.append("stderr", error.stderr, error.internalOutputAccounting.stderr);
    this.adoptChunks(orderMark, error.outputChunks, error.stdout, error.stderr);
  }

  appendResult(result: ExecResult, stdout: string = result.stdout): void {
    // The shape of what is appended, not of what the producer emitted: a
    // caller that hands over decoded text in place of the result's own byte
    // buffer is appending Unicode whatever the producer's shape was.
    const stdoutKind: OutputKind =
      stdout === result.stdout &&
      (result.stdoutKind === "bytes" || result.stdoutEncoding === "binary")
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
    this.adoptChunks(
      orderMark,
      result.internalOutputChunks,
      stdout,
      result.stderr,
    );
  }

  /**
   * Replace the two coarse entries a child's append just added with the finer
   * sequence the child recorded, so nesting does not flatten the ordering a
   * level at a time. Byte accounting is untouched: those bytes were charged by
   * the appends this refines.
   */
  private adoptChunks(
    orderMark: number,
    chunks: OutputChunk[] | undefined,
    stdout: string,
    stderr: string,
  ): void {
    if (!chunksDescribe(chunks, stdout, stderr)) return;
    // Truncate and push rather than splicing the child's chunks in: a spread
    // passes them as arguments, which overflows the stack once the array is
    // long enough. Nothing bounds its length, so it must not be spread.
    this.orderedChunks.length = orderMark;
    for (const chunk of chunks) {
      this.orderedChunks.push(chunk);
    }
  }

  build(exitCode: number, extra?: Partial<ExecResult>): ExecResult {
    return {
      stdout: this.stdoutChunks.join(""),
      stderr: this.stderrChunks.join(""),
      exitCode,
      ...extra,
      ...(this.orderedChunks.length > 0 && {
        // A copy: the array behind it keeps growing if this accumulator is
        // appended to again, and a result already handed out must not change.
        internalOutputChunks: [...this.orderedChunks],
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

  /** The write order recorded so far, for handing to an outer scope. */
  get chunks(): OutputChunk[] {
    return this.orderedChunks;
  }
}
