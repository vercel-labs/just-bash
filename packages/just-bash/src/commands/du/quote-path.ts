import type { BoundedStringBuilder } from "../../bounded-builder.js";
import {
  encodeUtf8ToBytes,
  latin1FromBytes,
  utf8ByteLength,
} from "../../encoding.js";

/** GNU shell-escape-always quoting, checked before retaining each fragment. */
export function quotePath(
  path: string,
  output: BoundedStringBuilder,
  checkpoint: () => void,
): void {
  checkpoint();
  // Quoting never makes the input shorter. Reject oversized inputs before
  // scanning them or constructing an expanded representation.
  output.reserve(path.length + 2);
  if (
    path.includes("'") &&
    !/["\\$`\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(path)
  ) {
    output.append('"').append(path).append('"');
    return;
  }
  // Compact fragments before retaining them in the bounded builder. A long
  // Unicode operand must not retain one string/array entry per code point.
  let pending = "";
  let pendingBytes = 0;
  const append = (value: string): void => {
    const bytes = pendingBytes + utf8ByteLength(value);
    output.reserve(bytes);
    pending += value;
    pendingBytes = bytes;
    if (pending.length >= 256) {
      output.append(pending);
      pending = "";
      pendingBytes = 0;
    }
  };
  append("'");
  let ansi = false;
  let index = 0;
  for (const char of path) {
    if (++index % 256 === 0) checkpoint();
    const control = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(char);
    if (control) {
      if (!ansi) append("'$'");
      ansi = true;
      const escapeIndex = "\u0007\b\t\n\u000b\f\r".indexOf(char);
      if (escapeIndex >= 0) append(`\\${"abtnvfr"[escapeIndex]}`);
      else {
        for (const byte of latin1FromBytes(encodeUtf8ToBytes(char))) {
          append(`\\${byte.charCodeAt(0).toString(8).padStart(3, "0")}`);
        }
      }
    } else {
      if (ansi) append("'");
      if (char === "'") append(ansi ? "\\''" : "'\\''");
      else {
        if (ansi) append("'");
        append(char);
      }
      ansi = false;
    }
  }
  append("'");
  output.append(pending);
}
