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
export function decodeBytesToUtf8(b: ByteString): string {
  const s = b as unknown as string;
  if (!s) return s;

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
 * Re-encode UTF-8 text into a `ByteString`. Inverse of `decodeBytesToUtf8`.
 * Use when a text-processing command emits its result back into the pipeline.
 */
export function encodeUtf8ToBytes(s: string): ByteString {
  let needsEncode = false;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) {
      needsEncode = true;
      break;
    }
  }
  if (!needsEncode) return s as unknown as ByteString;

  const bytes = utf8Encoder.encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out as unknown as ByteString;
}

/** The empty `ByteString`. */
export const EMPTY_BYTES: ByteString = "" as unknown as ByteString;
