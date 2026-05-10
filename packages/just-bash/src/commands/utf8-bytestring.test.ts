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

  describe("decoded-text → byte-consumer pipe boundary", () => {
    // When sed/grep/rev/awk decode their stdin and emit Unicode codepoints,
    // the pipe boundary must re-encode that text back to UTF-8 bytes
    // before the next command sees it. Otherwise byte consumers (`wc -c`,
    // `base64`, `md5sum`, etc.) operate on JS code units instead of bytes.

    it("text-emitting cmd → wc -c reports byte count, not code units", async () => {
      const env = new Bash({ files: { "/in.txt": "한글" } });
      // sed decodes, runs the regex, emits Unicode text.
      // wc -c must see 6 (UTF-8 bytes), not 2 (code units of "한글").
      const r = await env.exec(`cat /in.txt | sed 's/$//' | wc -c`);
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe("6");
    });

    it("rev → base64 round-trips through UTF-8 bytes correctly", async () => {
      const env = new Bash({ files: { "/in.txt": "한" } });
      // rev decodes, reverses by codepoint, emits text. Then base64 must
      // see UTF-8 bytes — without re-encoding it would treat the single
      // codepoint U+D55C as one byte and emit garbage.
      const r = await env.exec(`cat /in.txt | rev | base64`);
      expect(r.exitCode).toBe(0);
      // base64 of UTF-8 bytes 0xED 0x95 0x9C is "7ZWc".
      expect(r.stdout.trim()).toBe("7ZWc");
    });

    it("grep → md5sum hashes the original UTF-8 bytes", async () => {
      const env = new Bash({ files: { "/in.txt": "한글\n" } });
      // grep -o decodes for regex, emits matched text. md5 of "한글\n"
      // (7 UTF-8 bytes) must match `printf '한글\n' | md5sum` semantics.
      const r = await env.exec(`cat /in.txt | grep -o '한글' | md5sum`);
      expect(r.exitCode).toBe(0);
      // md5 of the 7 UTF-8 bytes "한글\n" — verified against host
      // `printf '한글\n' | md5sum`. (just-bash's md5sum emits two
      // spaces before the filename to match GNU coreutils format.)
      expect(r.stdout.trim()).toBe("ebef630fbec2e89fbcd589797bb6441c  -");
    });
  });

  describe("split named-file UTF-8 chunking", () => {
    it("splits a UTF-8 file by line without truncating multibyte chars", async () => {
      const env = new Bash({ files: { "/in.txt": "한\n글\n漢\n" } });
      const r = await env.exec("split -l 1 /in.txt /tmp/c_");
      expect(r.exitCode).toBe(0);
      const aa = await env.fs.readFile("/tmp/c_aa", "utf8");
      const ab = await env.fs.readFile("/tmp/c_ab", "utf8");
      const ac = await env.fs.readFile("/tmp/c_ac", "utf8");
      expect(aa).toBe("한\n");
      expect(ab).toBe("글\n");
      expect(ac).toBe("漢\n");
    });
  });

  describe("sort -f / uniq -i write decoded output as UTF-8 bytes", () => {
    it("sort -f -o preserves UTF-8 bytes in the written file", async () => {
      const env = new Bash({ files: { "/in.txt": "Café\nApple\n" } });
      const r = await env.exec("sort -f -o /out.txt /in.txt");
      expect(r.exitCode).toBe(0);
      const written = await env.fs.readFileBuffer("/out.txt");
      expect(new TextDecoder().decode(written)).toBe("Apple\nCafé\n");
    });

    it("uniq -i piped to wc -c reports the right byte count", async () => {
      const env = new Bash({ files: { "/in.txt": "Café\nCAFÉ\n" } });
      // After case-fold collapse, output is "Café\n" — 6 UTF-8 bytes
      // (C=1, a=1, f=1, é=2, \n=1).
      const r = await env.exec("uniq -i /in.txt | wc -c");
      expect(r.exitCode).toBe(0);
      expect(r.stdout.trim()).toBe("6");
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
