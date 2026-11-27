/**
 * Byte/text boundary types for the shell pipeline.
 *
 * Shell pipes carry bytes, not text. Internally we represent a byte buffer as
 * a JS string where `s.charCodeAt(i)` is the i-th byte (0–255), the same
 * convention as `Buffer.from(s, "latin1")`. That's a space-cheap byte buffer,
 * but the type system can't tell it apart from a real `string`, and command
 * authors keep writing `ctx.stdin.split(...)` / `RegExp.test(ctx.stdin)` /
 * `JSON.parse(ctx.stdin)` over data that is actually UTF-8 packed in latin1.
 * The result is silent mojibake — every multibyte codepoint gets misread as
 * several latin1 chars, then re-encoded as UTF-8 on the way out.
 *
 * `ByteString` is opaque (deliberately not assignable to/from `string`) so
 * you cannot accidentally call string methods on it. The only ways out are
 * `latin1FromBytes` (passthrough — stay byte-clean) and `decodeBytesToUtf8`
 * (decode — process as text). Pick one explicitly per call site.
 */

declare const __byteString: unique symbol;
export interface ByteString {
  readonly [__byteString]: true;
}

const strictUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();
const DEFAULT_MAX_CONVERSION_BYTES = 512 * 1024 * 1024;

function assertConversionSize(
  bytes: number,
  maximum: number,
  operation: string,
): void {
  if (
    !Number.isSafeInteger(bytes) ||
    bytes < 0 ||
    !Number.isSafeInteger(maximum) ||
    maximum < 0 ||
    bytes > maximum
  ) {
    throw new RangeError(
      `${operation}: byte conversion limit exceeded (${maximum} bytes)`,
    );
  }
}

/** Return UTF-8 byte length without allocating an encoded copy. */
export function utf8ByteLength(value: string): number {
  if (typeof Buffer !== "undefined") return Buffer.byteLength(value, "utf8");
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes++;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Tag a latin1 byte buffer (each char = one byte) as a `ByteString`. Use at
 * the pipeline edge: `cmdCtx.stdin = unsafeBytesFromLatin1(prevStdout)`.
 * Avoid inside command implementations.
 */
export function unsafeBytesFromLatin1(s: string): ByteString {
  return s as unknown as ByteString;
}

/**
 * Reveal the underlying latin1 byte buffer. Use when a command intentionally
 * forwards bytes unchanged (cat, head, tee, base64 -d, gzip, ...). Calling
 * regex / parse / `.length-as-chars` on the result re-introduces the
 * mojibake bug — if you need text, use `decodeBytesToUtf8` instead.
 */
export function latin1FromBytes(b: ByteString): string {
  return b as unknown as string;
}

/**
 * Decode a `ByteString` as UTF-8. Use when a command interprets stdin as
 * text (jq, sed, grep, awk, ...). Returns proper Unicode where multibyte
 * codepoints occupy a single JS char, so regex and parsers work correctly.
 *
 * Falls back to the raw latin1 view if the bytes are not valid UTF-8 (e.g.
 * a binary stream piped into grep). Callers that want hard failure on
 * invalid UTF-8 should encode + decode manually with `{ fatal: true }`.
 */
export function decodeBytesToUtf8(
  b: ByteString,
  maxBytes: number = DEFAULT_MAX_CONVERSION_BYTES,
): string {
  const s = b as unknown as string;
  if (!s) return s;
  assertConversionSize(s.length, maxBytes, "UTF-8 decode");

  let hasHighByte = false;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code > 0xff) {
      // Already a real Unicode string — caller passed something that wasn't
      // produced by the pipeline (e.g. a heredoc literal). Nothing to decode.
      return s;
    }
    if (code > 0x7f) hasHighByte = true;
  }
  if (!hasHighByte) return s;

  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);

  try {
    return strictUtf8Decoder.decode(bytes);
  } catch {
    return s;
  }
}

/**
 * Decode a byte array as UTF-8 with error recovery.
 * Valid UTF-8 sequences are decoded to their Unicode characters.
 * Invalid bytes are preserved as Latin-1 characters (byte value = char code).
 */
function decodeUtf8WithRecovery(bytes: number[]): string {
  let result = "";
  let i = 0;

  while (i < bytes.length) {
    const b0 = bytes[i];

    // ASCII (0xxxxxxx)
    if (b0 < 0x80) {
      result += String.fromCharCode(b0);
      i++;
      continue;
    }

    // 2-byte sequence (110xxxxx 10xxxxxx)
    if ((b0 & 0xe0) === 0xc0) {
      if (
        i + 1 < bytes.length &&
        (bytes[i + 1] & 0xc0) === 0x80 &&
        b0 >= 0xc2 // Reject overlong sequences
      ) {
        const codePoint = ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
        result += String.fromCharCode(codePoint);
        i += 2;
        continue;
      }
      // Invalid or incomplete - output as Latin-1
      result += String.fromCharCode(b0);
      i++;
      continue;
    }

    // 3-byte sequence (1110xxxx 10xxxxxx 10xxxxxx)
    if ((b0 & 0xf0) === 0xe0) {
      if (
        i + 2 < bytes.length &&
        (bytes[i + 1] & 0xc0) === 0x80 &&
        (bytes[i + 2] & 0xc0) === 0x80
      ) {
        // Check for overlong encoding
        if (b0 === 0xe0 && bytes[i + 1] < 0xa0) {
          // Overlong - output first byte as Latin-1
          result += String.fromCharCode(b0);
          i++;
          continue;
        }
        // Check for surrogate range (U+D800-U+DFFF)
        const codePoint =
          ((b0 & 0x0f) << 12) |
          ((bytes[i + 1] & 0x3f) << 6) |
          (bytes[i + 2] & 0x3f);
        if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
          // Invalid surrogate - output first byte as Latin-1
          result += String.fromCharCode(b0);
          i++;
          continue;
        }
        result += String.fromCharCode(codePoint);
        i += 3;
        continue;
      }
      // Invalid or incomplete - output as Latin-1
      result += String.fromCharCode(b0);
      i++;
      continue;
    }

    // 4-byte sequence (11110xxx 10xxxxxx 10xxxxxx 10xxxxxx)
    if ((b0 & 0xf8) === 0xf0 && b0 <= 0xf4) {
      if (
        i + 3 < bytes.length &&
        (bytes[i + 1] & 0xc0) === 0x80 &&
        (bytes[i + 2] & 0xc0) === 0x80 &&
        (bytes[i + 3] & 0xc0) === 0x80
      ) {
        // Check for overlong encoding
        if (b0 === 0xf0 && bytes[i + 1] < 0x90) {
          // Overlong - output first byte as Latin-1
          result += String.fromCharCode(b0);
          i++;
          continue;
        }
        const codePoint =
          ((b0 & 0x07) << 18) |
          ((bytes[i + 1] & 0x3f) << 12) |
          ((bytes[i + 2] & 0x3f) << 6) |
          (bytes[i + 3] & 0x3f);
        // Check for valid range (U+10000 to U+10FFFF)
        if (codePoint > 0x10ffff) {
          // Invalid - output first byte as Latin-1
          result += String.fromCharCode(b0);
          i++;
          continue;
        }
        result += String.fromCodePoint(codePoint);
        i += 4;
        continue;
      }
      // Invalid or incomplete - output as Latin-1
      result += String.fromCharCode(b0);
      i++;
      continue;
    }

    // Invalid lead byte (10xxxxxx or 11111xxx) - output as Latin-1
    result += String.fromCharCode(b0);
    i++;
  }

  return result;
}

/**
 * Read up to `maxDigits` digits in `radix` starting at `i`, as in the octal
 * and hex escapes `\NNN` and `\xHH`. Returns `null` when there is no digit.
 */
function readEscapeDigits(
  str: string,
  i: number,
  radix: 8 | 16,
  maxDigits: number,
): { byte: number; next: number } | null {
  let byte = 0;
  let j = i;
  while (j < str.length && j < i + maxDigits) {
    const digit = Number.parseInt(str[j], radix);
    if (Number.isNaN(digit)) break;
    byte = byte * radix + digit;
    j++;
  }
  return j > i ? { byte, next: j } : null;
}

/**
 * Read one `\NNN` (1-3 octal digits) or `\xHH` (1-2 hex digits) escape at
 * `i`, as in printf formats and `$'...'`. Returns `null` for anything else.
 */
export function readOctalOrHexEscape(
  str: string,
  i: number,
): { byte: number; next: number } | null {
  if (str[i] !== "\\") return null;
  if (str[i + 1] === "x") return readEscapeDigits(str, i + 2, 16, 2);
  return readEscapeDigits(str, i + 1, 8, 3);
}

/**
 * Read one `\0NNN` (0-3 octal digits after the 0, so `\0` alone is NUL) or
 * `\xHH` (1-2 hex digits) escape at `i`, as in `echo -e`. Returns `null` for
 * anything else.
 */
export function readZeroOctalOrHexEscape(
  str: string,
  i: number,
): { byte: number; next: number } | null {
  if (str[i] !== "\\") return null;
  if (str[i + 1] === "x") return readEscapeDigits(str, i + 2, 16, 2);
  if (str[i + 1] !== "0") return null;
  return readEscapeDigits(str, i + 2, 8, 3) ?? { byte: 0, next: i + 2 };
}

/**
 * Read the run of byte escapes that starts at `start`, such as `\303\251` or
 * `\xc3\xa9`, and decode the bytes together as UTF-8. Bash writes each escape
 * as one byte, so a multibyte character spelled as escapes reads back as that
 * character. `readByte` parses one escape in the caller's syntax and returns
 * `null` where the run ends.
 */
export function decodeByteEscapes(
  str: string,
  start: number,
  readByte: (str: string, i: number) => { byte: number; next: number } | null,
): { text: string; next: number } {
  const bytes: number[] = [];
  let i = start;
  for (let read = readByte(str, i); read; read = readByte(str, i)) {
    bytes.push(read.byte & 0xff);
    i = read.next;
  }
  return { text: decodeUtf8WithRecovery(bytes), next: i };
}

/**
 * UTF-8 encode `s` (treating every char as a Unicode codepoint) into a
 * `ByteString`. Use at sites that *know* their input is decoded Unicode
 * text and need to emit it back as bytes — typically the inverse of an
 * earlier `decodeBytesToUtf8` call inside the same command.
 */
export function encodeUtf8ToBytes(
  s: string,
  maxBytes: number = DEFAULT_MAX_CONVERSION_BYTES,
): ByteString {
  if (!s) return s as unknown as ByteString;
  const byteLength = utf8ByteLength(s);
  assertConversionSize(byteLength, maxBytes, "UTF-8 encode");
  // ASCII already has the byte-string representation. Avoid encoding and then
  // reconstructing an identical string on every text pipeline boundary.
  if (byteLength === s.length) return s as unknown as ByteString;
  return stringFromBytes(utf8Encoder.encode(s)) as unknown as ByteString;
}

/** The empty `ByteString`. */
export const EMPTY_BYTES: ByteString = "" as unknown as ByteString;

const BYTE_STRING_CHUNK_SIZE = 8192;

/** Convert bytes to a latin1-shaped string in bounded chunks. */
function stringFromBytes(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    // Share only the supplied view; Buffer.from(bytes) would copy the input.
    return Buffer.from(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    ).toString("latin1");
  }
  const chunks: string[] = [];
  // Spreading a typed array expands its iterator into temporary argument
  // storage. Reuse a bounded numeric array for the portable conversion.
  const codes: number[] = [];
  for (let i = 0; i < bytes.length; i += BYTE_STRING_CHUNK_SIZE) {
    const length = Math.min(BYTE_STRING_CHUNK_SIZE, bytes.length - i);
    codes.length = length;
    for (let j = 0; j < length; j++) codes[j] = bytes[i + j];
    chunks.push(String.fromCharCode.apply(null, codes));
  }
  return chunks.join("");
}

/**
 * Convert a `Uint8Array` to a `ByteString`. Each byte becomes one char.
 * The reverse is `Uint8Array.from(latin1FromBytes(b), (c) => c.charCodeAt(0))`.
 */
export function bytesFromUint8Array(
  buf: Uint8Array,
  maxBytes: number = DEFAULT_MAX_CONVERSION_BYTES,
): ByteString {
  assertConversionSize(buf.byteLength, maxBytes, "byte-string conversion");
  return stringFromBytes(buf) as unknown as ByteString;
}

/**
 * Read a file's raw bytes from any `IFileSystem`. Prefers the optional
 * {@link IFileSystem.readFileBytes} method (built-in filesystems implement
 * it natively), falling back to {@link IFileSystem.readFileBuffer} +
 * conversion for external/custom filesystems written before
 * `readFileBytes` existed. Use this from internal commands instead of
 * calling `fs.readFileBytes` directly so user-supplied filesystems keep
 * working.
 */
export async function readBytesFrom(
  fs: {
    readFileBytes?(path: string): Promise<ByteString>;
    readFileBuffer(path: string): Promise<Uint8Array>;
  },
  path: string,
): Promise<ByteString> {
  if (typeof fs.readFileBytes === "function") {
    return fs.readFileBytes(path);
  }
  return bytesFromUint8Array(await fs.readFileBuffer(path));
}

// ---------------------------------------------------------------------------
// Stdout shape helpers.
//
// The pipeline carries `ExecResult.stdout` as a `string` for back-compat,
// but the same string can be either JS-Unicode text or a latin1-shaped byte
// buffer. The pipe glue and redirection layer must treat those shapes
// differently — they decide based on `stdoutKind` (preferred) or the legacy
// `stdoutEncoding` flag, never by inspecting characters.
// ---------------------------------------------------------------------------

/** Either-or shape of a command's `stdout`. */
export type OutputKind = "text" | "bytes";

/**
 * Read the explicit shape of a command's stdout. Falls back to the legacy
 * `stdoutEncoding === "binary"` flag for results produced before the
 * `stdoutKind` field existed; defaults to `"text"` otherwise.
 */
export function stdoutKind(result: {
  stdoutKind?: OutputKind;
  stdoutEncoding?: "binary";
}): OutputKind {
  if (result.stdoutKind) return result.stdoutKind;
  return result.stdoutEncoding === "binary" ? "bytes" : "text";
}

/**
 * Coerce a command's stdout to a `ByteString` for the byte-shaped pipe.
 * Text gets UTF-8 encoded once (codepoints → bytes); bytes pass through.
 */
export function stdoutAsBytes(result: {
  stdout: string;
  stdoutKind?: OutputKind;
  stdoutEncoding?: "binary";
}): ByteString {
  return stdoutKind(result) === "bytes"
    ? unsafeBytesFromLatin1(result.stdout)
    : encodeUtf8ToBytes(result.stdout);
}

/**
 * Normalize a command's stdout to decoded UTF-8 text, consulting its explicit
 * `stdoutKind` (or legacy `stdoutEncoding`) rather than guessing from string
 * contents. Byte-shaped output is UTF-8 decoded once (falling back to the raw
 * latin1 view for non-UTF-8 bytes); text-shaped output is returned unchanged so
 * it is never re-decoded. Used at the statement/script concatenation and
 * command-substitution boundaries so interleaved text and byte producers
 * combine into a single, consistently-decoded string.
 */
export function decodedTextFromResult(result: {
  stdout: string;
  stdoutKind?: OutputKind;
  stdoutEncoding?: "binary";
}): string {
  return stdoutKind(result) === "bytes"
    ? decodeBytesToUtf8(unsafeBytesFromLatin1(result.stdout))
    : result.stdout;
}

/**
 * Build an `ExecResult`-shaped object whose stdout is decoded text. Sets
 * `stdoutKind: "text"` so the pipe knows to UTF-8 encode it on handoff
 * and redirects know to write it as UTF-8. Use for command authors that
 * decode their input and emit Unicode text — they no longer have to
 * manually re-encode for downstream byte consumers.
 */
export function textOutput(data: string): {
  stdout: string;
  stdoutKind: "text";
} {
  return { stdout: data, stdoutKind: "text" };
}

/**
 * Build an `ExecResult`-shaped object whose stdout is a latin1 byte view.
 * Sets both `stdoutKind: "bytes"` (new contract) and `stdoutEncoding:
 * "binary"` (legacy alias) so older code paths keep working through the
 * migration. Use for command authors that emit raw bytes (cat, gzip,
 * tar, base64 -d, ...).
 */
export function bytesOutput(data: ByteString): {
  stdout: string;
  stdoutKind: "bytes";
  stdoutEncoding: "binary";
} {
  return {
    stdout: latin1FromBytes(data),
    stdoutKind: "bytes",
    stdoutEncoding: "binary",
  };
}
