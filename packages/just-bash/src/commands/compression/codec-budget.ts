/** Shared prospective accounting for compression and archive codecs. */
export interface CodecBudgetOptions {
  /** Maximum bytes accepted from the compressed/input side of the codec. */
  maxInputBytes: number;
  /** Maximum bytes a codec may produce. Must be enforced while producing. */
  maxOutputBytes: number;
  /** Optional expansion-ratio guard, applied after `ratioGraceBytes`. */
  maxExpansionRatio?: number;
  /** Avoid ratio false positives for tiny, intentionally repetitive inputs. */
  ratioGraceBytes?: number;
  /** Maximum bytes of codec work charged across input and output. */
  maxWorkBytes?: number;
  signal?: AbortSignal;
  label?: string;
}

/**
 * A codec must call `acceptInput` before decoding and `acceptOutput` before
 * retaining every output chunk. This makes the safety check prospective: the
 * allocation/side effect does not happen when the reservation fails.
 */
export class CodecBudget {
  private inputBytes = 0;
  private outputBytes = 0;
  private workBytes = 0;
  private readonly label: string;

  constructor(private readonly options: CodecBudgetOptions) {
    this.label = options.label ?? "codec";
    for (const [name, value] of [
      ["maxInputBytes", options.maxInputBytes],
      ["maxOutputBytes", options.maxOutputBytes],
      ["maxExpansionRatio", options.maxExpansionRatio],
      ["ratioGraceBytes", options.ratioGraceBytes],
      ["maxWorkBytes", options.maxWorkBytes],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new Error(`${this.label}: invalid ${name}`);
      }
    }
  }

  checkpoint(): void {
    if (this.options.signal?.aborted) {
      throw new Error(`${this.label}: operation aborted`);
    }
  }

  acceptInput(bytes: number): void {
    this.checkpoint();
    this.inputBytes = this.addWithinLimit(
      this.inputBytes,
      bytes,
      this.options.maxInputBytes,
      "input",
    );
    this.chargeWork(bytes);
  }

  acceptOutput(bytes: number): void {
    this.checkpoint();
    const nextOutput = this.addWithinLimit(
      this.outputBytes,
      bytes,
      this.options.maxOutputBytes,
      "output",
    );
    const grace = this.options.ratioGraceBytes ?? 1024 * 1024;
    const ratio = this.options.maxExpansionRatio;
    if (
      ratio !== undefined &&
      nextOutput > grace &&
      (this.inputBytes === 0 || nextOutput > this.inputBytes * ratio)
    ) {
      throw new Error(
        `${this.label}: expansion ratio exceeds limit (${ratio}:1)`,
      );
    }
    this.outputBytes = nextOutput;
    this.chargeWork(bytes);
  }

  get inputLength(): number {
    return this.inputBytes;
  }

  get outputLength(): number {
    return this.outputBytes;
  }

  private chargeWork(bytes: number): void {
    const maximum =
      this.options.maxWorkBytes ??
      this.options.maxInputBytes + this.options.maxOutputBytes;
    this.workBytes = this.addWithinLimit(
      this.workBytes,
      bytes,
      maximum,
      "work",
    );
  }

  private addWithinLimit(
    current: number,
    bytes: number,
    maximum: number,
    resource: string,
  ): number {
    if (
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      bytes > maximum - current
    ) {
      throw new Error(
        `${this.label}: ${resource} exceeds limit (${maximum} bytes)`,
      );
    }
    return current + bytes;
  }
}
