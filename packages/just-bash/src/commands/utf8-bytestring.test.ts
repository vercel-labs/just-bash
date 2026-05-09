/**
 * UTF-8 byte preservation across the pipeline boundary.
 *
 * The shell pipeline carries data as latin1-shaped byte buffers internally:
 * a previous command's stdout is a string where each char is one byte. When
 * a downstream command interprets that buffer as text (regex, parsing, char
 * iteration, code execution, case folding), multibyte UTF-8 sequences get
 * misread as several latin1 chars and the result silently mojibakes.
 *
 * The fix is the opaque `ByteString` type in `src/encoding.ts` — every
 * command author must explicitly pick `latin1FromBytes` (forward bytes) or
 * `decodeBytesToUtf8` (interpret as text). These tests reproduce the bugs
 * the type system now prevents in the worst-affected commands and make sure
 * nothing regresses.
 *
 * The bytes flow as `printf '\x..\x..\x..' | <cmd>` so stdin holds the
 * actual UTF-8 byte sequence (latin1-shaped) the pipeline would deliver.
 * Tests assert the user-visible string at `result.stdout`, which is what
 * the output boundary in `Bash.exec` decodes back to Unicode.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const KOREAN_BYTES = "\\xed\\x95\\x9c\\xea\\xb8\\x80"; // 한글
const KOREAN = "한글";
const CAFE_BYTES = "caf\\xc3\\xa9"; // café
const CAFE = "café";
const CJK_BYTES = "\\xe6\\xbc\\xa2\\xe5\\xad\\x97"; // 漢字
const CJK = "漢字";
// 0xC3 0xA9 is the UTF-8 byte sequence for é. Without the brand, naive
// `.toLowerCase()` on a latin1 byte buffer turns 0xC3 into 0xE3 — silently
// mutating "é" into a corrupt sequence that decodes as a *different* char.
const CASEFOLD_DANGER_BYTES = "\\xc3\\x89"; // É (capital)
const CASEFOLD_DANGER = "É";

describe("UTF-8 byte preservation across the pipeline boundary", () => {
  describe("bash / sh from stdin", () => {
    it("parses a script containing non-ASCII string literals", async () => {
      const env = new Bash();
      const result = await env.exec(`printf 'echo "${CAFE_BYTES}"\\n' | bash`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`${CAFE}\n`);
    });
  });

  describe("rev", () => {
    it("reverses by codepoint, not by latin1 byte", async () => {
      const env = new Bash();
      const result = await env.exec(`printf '${KOREAN_BYTES}\\n' | rev`);
      expect(result.exitCode).toBe(0);
      // "한글" reversed by codepoint is "글한"
      expect(result.stdout).toBe("글한\n");
    });
  });

  describe("wc", () => {
    // The interesting case is reading raw multibyte bytes from a file:
    // `-c` reports 6 (UTF-8 byte length) and `-m` reports 2 (codepoints).
    // This is the path where ByteString matters — the file is read as
    // bytes and only `-m` is supposed to decode.
    it("-c counts bytes and -m counts codepoints from a UTF-8 file", async () => {
      const env = new Bash({ files: { "/k.txt": KOREAN } });
      const c = await env.exec("wc -c /k.txt");
      const m = await env.exec("wc -m /k.txt");
      expect(c.stdout.trim().split(/\s+/)[0]).toBe("6");
      expect(m.stdout.trim().split(/\s+/)[0]).toBe("2");
    });
  });

  describe("cut -c", () => {
    it("slices by codepoint, not by byte", async () => {
      const env = new Bash();
      const result = await env.exec(`printf '${CJK_BYTES}\\n' | cut -c 1-2`);
      expect(result.exitCode).toBe(0);
      // -c 1-2 should give us both codepoints, not 2 of the 6 bytes
      expect(result.stdout).toBe(`${CJK}\n`);
    });
  });

  describe("expand / unexpand", () => {
    it("counts column positions by codepoint, not by byte", async () => {
      const env = new Bash();
      // A single tab after one CJK char should expand to fill column 2
      // through tab-stop 8 (6 spaces). With byte counting it would land in
      // the wrong column.
      const result = await env.exec(
        `printf '${CAFE_BYTES}\\tafter\\n' | expand`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`${CAFE}    after\n`);
    });
  });

  describe("tr", () => {
    it("translates by codepoint", async () => {
      const env = new Bash();
      const result = await env.exec(`printf '${CAFE_BYTES}\\n' | tr 'é' 'X'`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("cafX\n");
    });
  });

  describe("sort -f / uniq -i — case-fold without corruption", () => {
    it("sort -f preserves UTF-8 bytes (does not lowercase 0xC3 to 0xE3)", async () => {
      const env = new Bash();
      // É (capital) appears once. With naive byte-level toLowerCase the
      // leading byte 0xC3 mutates to 0xE3, producing a different valid
      // UTF-8 character — silent data corruption.
      const result = await env.exec(
        `printf '${CASEFOLD_DANGER_BYTES}\\n' | sort -f`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`${CASEFOLD_DANGER}\n`);
    });

    it("uniq -i case-folds by codepoint, preserves bytes in output", async () => {
      const env = new Bash();
      const result = await env.exec(
        `printf '${CAFE_BYTES}\\n${CAFE_BYTES.replace("caf", "CAF")}\\n' | uniq -i`,
      );
      expect(result.exitCode).toBe(0);
      // Two lines that case-fold to the same value collapse to one — the
      // first one wins, byte-perfect.
      expect(result.stdout).toBe(`${CAFE}\n`);
    });
  });

  describe("cat / head / tail / tee — passthrough must stay byte-clean", () => {
    it("cat round-trips multibyte bytes through stdin and stdout", async () => {
      const env = new Bash();
      const result = await env.exec(`printf '${KOREAN_BYTES}\\n' | cat`);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`${KOREAN}\n`);
    });

    it("tee passes UTF-8 stdin through to its stdout unchanged", async () => {
      // (Byte-perfect file write through tee for piped binary data is a
      // pre-existing limitation tied to using a JS string as a byte buffer;
      // fixing it requires migrating the pipe to Uint8Array. tee's stdout
      // path still round-trips correctly through the output boundary.)
      const env = new Bash();
      const result = await env.exec(
        `printf '${CJK_BYTES}\\n' | tee /tmp/out.txt`,
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`${CJK}\n`);
    });
  });
});
