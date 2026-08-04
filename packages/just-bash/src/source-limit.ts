import { utf8ByteLength } from "./commands/printf/escapes.js";
import { ExecutionLimitError } from "./interpreter/errors.js";

/** Reject source before normalization or parsing can duplicate it. */
export function assertSourceWithinLimit(
  source: string,
  maxSourceBytes: number,
): void {
  if (
    source.length > maxSourceBytes ||
    utf8ByteLength(source) > maxSourceBytes
  ) {
    throw new ExecutionLimitError(
      `script input size limit exceeded (${maxSourceBytes} bytes)`,
      "string_length",
    );
  }
}
