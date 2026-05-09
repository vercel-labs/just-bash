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
 * UTF-8 encode `s` (treating every char as a Unicode codepoint) into a
 * `ByteString`. Use at sites that *know* their input is decoded Unicode
 * text and need to emit it back as bytes — typically the inverse of an
 * earlier `decodeBytesToUtf8` call inside the same command.
 */
export function encodeUtf8ToBytes(s: string): ByteString {
  if (!s) return s as unknown as ByteString;
  const bytes = utf8Encoder.encode(s);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
  return out as unknown as ByteString;
}

/**
 * Coerce a string of unknown shape into a `ByteString` for the pipe
 * boundary. The pipe contract is "every command's stdin is a byte
 * buffer", but two upstream shapes both look like JS strings:
 *
 *   - real Unicode text with codepoints (echo, printf, heredocs,
 *     here-strings, command substitution — anything from bash's
 *     string-as-codepoints world). UTF-8 encode it so byte consumers
 *     downstream (`wc -c`, `base64`, `md5sum`) and binary writes see
 *     real UTF-8 bytes instead of code units.
 *   - a latin1-shaped byte buffer that's already passed through this
 *     pipeline (cat, gzip, sed/grep/jq after they re-encoded). Pipeline
 *     glue distinguishes this case via `stdoutEncoding: "binary"` and
 *     skips the call here entirely; if a producer forgets that flag,
 *     the encode here interprets each char as a codepoint and may
 *     double-encode high bytes — that's the producer's bug.
 *
 * Caveat: `echo -en '\0377'` produces a JS string with codepoint 0xFF
 * intending it to be a single raw byte. We can't tell that intent apart
 * from a real Latin-1-supplement codepoint, so `\0377` gets UTF-8
 * encoded to `0xC3 0xBF` here — a known divergence from real bash for
 * raw octal/hex byte escapes piped to byte consumers, separate from the
 * UTF-8 byte-length contract upheld for everything else.
 */
export function bytesFromPipe(s: string): ByteString {
  if (!s) return s as unknown as ByteString;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return encodeUtf8ToBytes(s);
  }
  return s as unknown as ByteString;
}

/** The empty `ByteString`. */
export const EMPTY_BYTES: ByteString = "" as unknown as ByteString;

/**
 * Convert a `Uint8Array` to a `ByteString`. Each byte becomes one char.
 * The reverse is `Uint8Array.from(latin1FromBytes(b), (c) => c.charCodeAt(0))`.
 */
export function bytesFromUint8Array(buf: Uint8Array): ByteString {
  let out = "";
  for (let i = 0; i < buf.length; i++) out += String.fromCharCode(buf[i]);
  return out as unknown as ByteString;
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
