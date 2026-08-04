import { utf8ByteLength } from "./encoding.js";
import { ExecutionLimitError } from "./interpreter/errors.js";

function assertBoundedCount(count: number, label: string): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ExecutionLimitError(
      `${label}: invalid bounded allocation count`,
      "array_elements",
    );
  }
}

function allocationError(label: string): ExecutionLimitError {
  return new ExecutionLimitError(
    `${label}: invalid bounded allocation count`,
    "array_elements",
  );
}

/** Add allocation counts without permitting unsafe-integer wraparound. */
export function checkedAdd(left: number, right: number, label: string): number {
  assertBoundedCount(left, label);
  assertBoundedCount(right, label);
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw allocationError(label);
  return result;
}

/** Multiply allocation counts without permitting overflow or invalid inputs. */
export function checkedMultiply(
  left: number,
  right: number,
  label: string,
): number {
  assertBoundedCount(left, label);
  assertBoundedCount(right, label);
  if (left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left)) {
    throw allocationError(label);
  }
  return left * right;
}

/** Repeat only after proving that the resulting UTF-8 byte size is bounded. */
export function boundedRepeat(
  value: string,
  count: number,
  maxBytes: number,
  label: string,
): string {
  const builder = new BoundedStringBuilder(maxBytes, label);
  builder.repeat(value, count);
  return builder.build();
}

/** Join only after charging every value and separator before construction. */
export function boundedJoin(
  values: readonly string[],
  separator: string,
  maxBytes: number,
  label: string,
): string {
  const builder = new BoundedStringBuilder(maxBytes, label);
  for (let index = 0; index < values.length; index++) {
    if (index > 0) builder.append(separator);
    builder.append(values[index]);
  }
  return builder.build();
}

export class BoundedStringBuilder {
  private readonly chunks: string[] = [];
  private usedBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly label: string,
    private readonly createLimitError:
      | (() => ExecutionLimitError)
      | undefined = undefined,
    private readonly reservedBytes = 0,
  ) {
    assertBoundedCount(maxBytes, label);
    assertBoundedCount(reservedBytes, label);
    if (reservedBytes > maxBytes) this.fail();
  }

  private fail(): never {
    throw (
      this.createLimitError?.() ??
      new ExecutionLimitError(
        `${this.label}: output size limit exceeded (${this.maxBytes} bytes)`,
        "output_size",
      )
    );
  }

  get byteLength(): number {
    return this.usedBytes;
  }

  get remainingBytes(): number {
    return this.maxBytes - this.reservedBytes - this.usedBytes;
  }

  reserve(bytes: number): void {
    assertBoundedCount(bytes, this.label);
    if (bytes > this.remainingBytes) {
      this.fail();
    }
  }

  append(value: string): this {
    const bytes = utf8ByteLength(value);
    this.reserve(bytes);
    if (value) this.chunks.push(value);
    this.usedBytes += bytes;
    return this;
  }

  repeat(value: string, count: number): this {
    assertBoundedCount(count, this.label);
    const unitBytes = utf8ByteLength(value);
    if (
      unitBytes !== 0 &&
      count > Math.floor(this.remainingBytes / unitBytes)
    ) {
      this.fail();
    }
    return this.append(value.repeat(count));
  }

  reset(): void {
    this.chunks.length = 0;
    this.usedBytes = 0;
  }

  build(): string {
    return this.chunks.join("");
  }
}

export class BoundedByteBuilder {
  private readonly chunks: Uint8Array[] = [];
  private usedBytes = 0;

  constructor(
    private readonly maxBytes: number,
    private readonly label: string,
  ) {
    assertBoundedCount(maxBytes, label);
  }

  get byteLength(): number {
    return this.usedBytes;
  }

  get remainingBytes(): number {
    return this.maxBytes - this.usedBytes;
  }

  append(value: Uint8Array): this {
    if (value.byteLength > this.remainingBytes) {
      throw new ExecutionLimitError(
        `${this.label}: byte size limit exceeded (${this.maxBytes} bytes)`,
        "string_length",
      );
    }
    if (value.byteLength > 0) this.chunks.push(value);
    this.usedBytes += value.byteLength;
    return this;
  }

  build(): Uint8Array {
    const output = new Uint8Array(this.usedBytes);
    let offset = 0;
    for (const chunk of this.chunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return output;
  }
}
