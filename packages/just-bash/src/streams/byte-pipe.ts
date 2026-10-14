import {
  type ByteString,
  latin1FromBytes,
  unsafeBytesFromLatin1,
} from "../encoding.js";
import type { ExecutionScope, ResourceLease } from "../execution-scope.js";

export class BrokenPipeError extends Error {
  constructor() {
    super("Broken pipe");
  }
}

export class BytePipe {
  private buffer = "";
  private lease?: ResourceLease;
  private ended = false;
  private failure: unknown;
  private failed = false;
  private writing = false;
  private reading = false;
  private wakeReader?: () => void;
  private wakeWriter?: () => void;

  constructor(
    private readonly scope: ExecutionScope,
    private readonly capacity: number = 64 * 1024,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new RangeError("Invalid pipe capacity");
  }

  async write(bytes: ByteString): Promise<void> {
    if (this.writing) throw new Error("Pipe writes must be awaited");
    this.writing = true;
    try {
      this.assertWritable();
      const value = latin1FromBytes(bytes);
      let offset = 0;
      while (offset < value.length) {
        this.assertWritable();
        if (this.buffer.length === this.capacity) {
          await new Promise<void>((resolve) => {
            this.wakeWriter = resolve;
          });
          continue;
        }
        const length = Math.min(
          value.length - offset,
          this.capacity - this.buffer.length,
        );
        this.lease?.release();
        this.lease = this.scope.reserveBytes(
          "pipeline",
          this.buffer.length + length,
          "pipeline",
        );
        this.buffer += value.slice(offset, offset + length);
        offset += length;
        this.wakeReader?.();
        this.wakeReader = undefined;
      }
    } finally {
      this.writing = false;
    }
  }

  async read(): Promise<ByteString | null> {
    if (this.reading) throw new Error("Pipe reads must be awaited");
    this.reading = true;
    try {
      while (this.buffer.length === 0 && !this.ended && !this.failed) {
        await new Promise<void>((resolve) => {
          this.wakeReader = resolve;
        });
      }
      if (this.failed) throw this.failure;
      const chunk =
        this.buffer.length > 0 ? unsafeBytesFromLatin1(this.buffer) : null;
      this.buffer = "";
      this.lease?.release();
      this.lease = undefined;
      this.wakeWriter?.();
      this.wakeWriter = undefined;
      return chunk;
    } finally {
      this.reading = false;
    }
  }

  end(): void {
    this.ended = true;
    this.wakeReader?.();
    this.wakeReader = undefined;
    this.wakeWriter?.();
    this.wakeWriter = undefined;
  }

  cancel(error: unknown = new BrokenPipeError()): void {
    if (this.failed) return;
    this.failed = true;
    this.failure = error;
    this.buffer = "";
    this.lease?.release();
    this.lease = undefined;
    this.wakeReader?.();
    this.wakeWriter?.();
    this.wakeReader = undefined;
    this.wakeWriter = undefined;
  }

  private assertWritable(): void {
    if (this.failed) throw this.failure;
    if (this.ended) throw new BrokenPipeError();
  }
}
