import {
  decodeBytesToUtf8,
  unsafeBytesFromLatin1,
  utf8ByteLength,
} from "./encoding.js";
import type { ExecutionScope } from "./execution-scope.js";
import { ControlFlowError } from "./interpreter/errors.js";
import type { ExecResult, OutputSegment } from "./types.js";

/**
 * Chunked interpreter-output sink backed by the one top-level execution
 * budget. Accounting metadata follows bytes as compound commands relay child
 * results, avoiding both budget refreshes and double charging.
 */
export class ExecutionOutputAccumulator {
  readonly internalOutputSegments: OutputSegment[] = [];
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
      this.internalOutputSegments.push([stream, chunk, kind]);
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
    prependOutputFrom(error, this);
  }

  appendResult(result: ExecResult, stdout: string = result.stdout): void {
    const credit = {
      stdout: result.internalOutputAccounting?.stdout ?? 0,
      stderr: result.internalOutputAccounting?.stderr ?? 0,
    };
    this.append("stdout", "");
    for (const [stream, text, kind] of outputSegments(result, stdout)) {
      const bytes = kind === "bytes" ? text.length : utf8ByteLength(text);
      const already = Math.min(credit[stream], bytes);
      this.append(stream, text, already, kind);
      credit[stream] -= already;
    }
    this.append("stderr", "", credit.stderr);
  }

  build(exitCode: number, extra?: Partial<ExecResult>): ExecResult {
    return {
      internalOutputSegments: this.internalOutputSegments.slice(),
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

// Automa modifications: byte identity accompanies temporal fd ordering.
type OutputSource = Pick<
  ExecResult,
  | "stdout"
  | "stderr"
  | "stdoutKind"
  | "stdoutEncoding"
  | "internalOutputSegments"
>;
export function outputSegments(
  result: OutputSource,
  stdout = result.stdout,
): OutputSegment[] {
  if (!result.internalOutputSegments) {
    const parts: OutputSegment[] = [
      [
        "stdout",
        stdout,
        stdout === result.stdout &&
        (result.stdoutKind === "bytes" || result.stdoutEncoding === "binary")
          ? "bytes"
          : "text",
      ],
      ["stderr", result.stderr, "text"],
    ];
    return parts.filter((part) => part[1]);
  }
  const parts: OutputSegment[] = result.internalOutputSegments.map((part) => [
    ...part,
  ]);
  if (stdout !== result.stdout) {
    for (const part of parts) {
      if (part[0] === "stdout" && part[2] === "bytes") {
        try {
          part[1] = new TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(Uint8Array.from(part[1], (c) => c.charCodeAt(0)));
          part[2] = "text";
        } catch {
          /* Preserve the original invalid-byte fallback. */
        }
      }
    }
  }
  for (const stream of ["stdout", "stderr"] as const) {
    const value = stream === "stdout" ? stdout : result.stderr;
    const included = parts
      .filter((part) => part[0] === stream)
      .map((part) => part[1])
      .join("");
    if (value.length > included.length) {
      const prefix = included && value.endsWith(included);
      const text = prefix
        ? value.slice(0, -included.length)
        : value.slice(included.length);
      if (prefix) parts.unshift([stream, text, "text"]);
      else parts.push([stream, text, "text"]);
    } else if (!value && included) {
      for (let i = parts.length - 1; i >= 0; i--)
        if (parts[i][0] === stream) parts.splice(i, 1);
    }
  }
  return parts;
}
export function outputSize(
  result: OutputSource,
  stream: "stdout" | "stderr",
): number {
  return outputSegments(result).reduce(
    (size, [fd, text, kind]) =>
      fd === stream
        ? size + (kind === "bytes" ? text.length : utf8ByteLength(text))
        : size,
    0,
  );
}
export function prependOutputFrom(
  error: ControlFlowError,
  result: OutputSource,
): void {
  const segments = [...outputSegments(result), ...outputSegments(error)];
  error.prependOutput(result.stdout, result.stderr);
  error.internalOutputSegments = segments;
}
export function accountOutputSegments(
  scope: ExecutionScope,
  result: OutputSource,
  stream: "stdout" | "stderr",
  site: string,
  already: number,
): number {
  const parts = outputSegments(result).filter(([fd]) => fd === stream);
  const size = outputSize(result, stream);
  if (!Number.isSafeInteger(already) || already < 0 || already > size)
    return scope.appendOutput(stream, "", site, already);
  scope.appendOutput(stream, "", site);
  let remaining = already;
  let total = 0;
  for (const [, text, kind] of parts) {
    const credit = Math.min(
      remaining,
      kind === "bytes" ? text.length : utf8ByteLength(text),
    );
    total += scope.appendOutput(stream, text, site, credit, kind);
    remaining -= credit;
  }
  return total;
}

/** Automa: decode consecutive byte fragments only at the shell word boundary. */
export function commandSubstitutionText(result: OutputSource): string {
  let text = "";
  let bytes = "";
  for (const [stream, value, kind] of outputSegments(result)) {
    if (stream !== "stdout") continue;
    if (kind === "bytes") bytes += value;
    else {
      text += decodeBytesToUtf8(unsafeBytesFromLatin1(bytes)) + value;
      bytes = "";
    }
  }
  return text + decodeBytesToUtf8(unsafeBytesFromLatin1(bytes));
}
