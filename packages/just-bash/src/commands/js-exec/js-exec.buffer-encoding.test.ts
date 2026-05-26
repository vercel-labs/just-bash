import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("buffer encoding", () => {
  // ─── Encode side ─────────────────────────────────────────────────

  it("Buffer.from(str).toString('base64')", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('hello').toString('base64'))"`,
    );
    expect(result.stdout).toBe("aGVsbG8=\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from(str).toString('base64url')", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('hello').toString('base64url'))"`,
    );
    expect(result.stdout).toBe("aGVsbG8\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from(bytes).toString('base64') with binary bytes", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from([0xff,0xfe,0x00]).toString('base64'))"`,
    );
    expect(result.stdout).toBe("//4A\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from(bytes).toString('base64url') with binary bytes", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from([0xff,0xfe,0x00]).toString('base64url'))"`,
    );
    expect(result.stdout).toBe("__4A\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from(bytes).toString('hex')", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from([0xff,0xfe,0x00]).toString('hex'))"`,
    );
    expect(result.stdout).toBe("fffe00\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from(bytes).toString('latin1') preserves high bytes", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from([0xff]).toString('latin1'))"`,
    );
    expect(result.stdout).toBe("ÿ\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from(bytes).toString('binary') aliases latin1", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from([0x41,0x42]).toString('binary'))"`,
    );
    expect(result.stdout).toBe("AB\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from(bytes).toString('ascii') masks high bit", async () => {
    const env = new Bash({ javascript: true });
    // 193 & 0x7F = 65 = 'A'; same output as 65 = 'A'
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from([65,193]).toString('ascii'))"`,
    );
    expect(result.stdout).toBe("AA\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from(bytes).toString('utf16le') decodes little-endian pairs", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from([0x68,0x00,0x69,0x00]).toString('utf16le'))"`,
    );
    expect(result.stdout).toBe("hi\n");
    expect(result.exitCode).toBe(0);
  });

  // ─── Decode side ─────────────────────────────────────────────────

  it("Buffer.from('aGVsbG8=', 'base64')", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('aGVsbG8=', 'base64').toString())"`,
    );
    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from('aGVsbG8', 'base64') ignores missing padding", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('aGVsbG8', 'base64').toString())"`,
    );
    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from base64 strips whitespace in the middle", async () => {
    const env = new Bash({ javascript: true });
    // space between 'aGVs' and 'bG8=' is skipped; result is "hello"
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('aGVs bG8=', 'base64').toString())"`,
    );
    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from('__4A', 'base64url')", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('__4A', 'base64url').toString('hex'))"`,
    );
    expect(result.stdout).toBe("fffe00\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from('ff00ab', 'hex')", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('ff00ab', 'hex').toString('hex'))"`,
    );
    expect(result.stdout).toBe("ff00ab\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from('ff00ZZab', 'hex') stops at first invalid character", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('ff00ZZab', 'hex').toString('hex'))"`,
    );
    expect(result.stdout).toBe("ff00\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from('abc', 'hex') truncates trailing odd nibble", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('abc', 'hex').toString('hex'))"`,
    );
    expect(result.stdout).toBe("ab\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from('Hello', 'latin1') round-trips", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('Hello', 'latin1').toString('latin1'))"`,
    );
    expect(result.stdout).toBe("Hello\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from high-byte latin1 string encodes low byte of each char", async () => {
    const env = new Bash({ javascript: true });
    // 'ÿþ' — JS unicode escapes for U+00FF, U+00FE
    // latin1 encoding takes low byte of each: [0xFF, 0xFE]
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('\\u00ff\\u00fe', 'latin1').toString('hex'))"`,
    );
    expect(result.stdout).toBe("fffe\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.from('hi', 'utf16le') round-trips", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('hi', 'utf16le').toString('utf16le'))"`,
    );
    expect(result.stdout).toBe("hi\n");
    expect(result.exitCode).toBe(0);
  });

  // ─── Cross-API ───────────────────────────────────────────────────

  it("Buffer.byteLength('aGVsbG8=', 'base64') === 5", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.byteLength('aGVsbG8=', 'base64'))"`,
    );
    expect(result.stdout).toBe("5\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.byteLength('ff00', 'hex') === 2", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.byteLength('ff00', 'hex'))"`,
    );
    expect(result.stdout).toBe("2\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.alloc.write with base64 encoding writes decoded bytes", async () => {
    const env = new Bash({ javascript: true });
    // 'aGVs' decodes to "hel" (3 bytes); length=4 allows up to 4 bytes but only 3 decoded
    const result = await env.exec(
      `js-exec -c "var b = Buffer.alloc(8); var n = b.write('aGVs', 0, 4, 'base64'); console.log(n, b.slice(0, n).toString())"`,
    );
    expect(result.stdout).toBe("3 hel\n");
    expect(result.exitCode).toBe(0);
  });

  // ─── Round-trip regression (assert encoded constant, not just decode(encode(x))) ──

  it("base64 round-trip via asserted constant for 'hello world'", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('hello world').toString('base64'))"`,
    );
    expect(result.stdout).toBe("aGVsbG8gd29ybGQ=\n");
    expect(result.exitCode).toBe(0);
  });

  it("hex round-trip preserves binary bytes via asserted constant", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from([0xde,0xad,0xbe,0xef]).toString('hex'))"`,
    );
    expect(result.stdout).toBe("deadbeef\n");
    expect(result.exitCode).toBe(0);
  });

  // ─── Unknown encoding ─────────────────────────────────────────────

  it("Buffer.from(str, 'utf-7') throws TypeError", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "try { Buffer.from('hi', 'utf-7'); } catch(e) { console.log(e instanceof TypeError, e.message) }"`,
    );
    expect(result.stdout).toBe("true Unknown encoding: utf-7\n");
    expect(result.exitCode).toBe(0);
  });

  it("buf.toString('utf-7') throws TypeError", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "try { Buffer.from('hi').toString('utf-7'); } catch(e) { console.log(e instanceof TypeError, e.message) }"`,
    );
    expect(result.stdout).toBe("true Unknown encoding: utf-7\n");
    expect(result.exitCode).toBe(0);
  });

  // ─── Aliases ─────────────────────────────────────────────────────

  it("'binary' is alias for 'latin1'", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from([0x41,0xff]).toString('binary') === Buffer.from([0x41,0xff]).toString('latin1'))"`,
    );
    expect(result.stdout).toBe("true\n");
    expect(result.exitCode).toBe(0);
  });

  it("'ucs2', 'ucs-2', 'utf-16le' all alias 'utf16le'", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "var b = Buffer.from([0x68,0x00,0x69,0x00]); console.log(b.toString('ucs2'), b.toString('ucs-2'), b.toString('utf-16le'), b.toString('utf16le'))"`,
    );
    expect(result.stdout).toBe("hi hi hi hi\n");
    expect(result.exitCode).toBe(0);
  });

  it("'utf-8' is alias for 'utf8'", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('hello', 'utf-8').toString('utf-8'))"`,
    );
    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);
  });

  // ─── Node-compat edge cases ──────────────────────────────────────

  it("Buffer.from(ArrayBuffer) shares the backing store", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "var ab = new ArrayBuffer(4); var u8 = new Uint8Array(ab); u8[0]=1; var b = Buffer.from(ab); u8[0]=99; console.log(b._data[0], b._data.buffer === ab)"`,
    );
    expect(result.stdout).toBe("99 true\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.prototype.toString clamps negative end to 0", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(JSON.stringify(Buffer.from('abc').toString('utf8', 0, -1)))"`,
    );
    expect(result.stdout).toBe('""\n');
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.prototype.write throws RangeError when length exceeds remaining", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "try { Buffer.alloc(2).write('abc', 0, 3); console.log('no-throw'); } catch (e) { console.log(e.name, e.message); }"`,
    );
    expect(result.stdout).toBe(
      'RangeError The value of "length" is out of range. It must be >= 0 && <= 2. Received 3\n',
    );
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.prototype.write clamps to remaining when length fits buf but not remaining", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "var b = Buffer.alloc(5); var n = b.write('abcde', 3, 5); console.log(n, b.toString('hex'))"`,
    );
    expect(result.stdout).toBe("2 0000006162\n");
    expect(result.exitCode).toBe(0);
  });

  it("Buffer.prototype.write throws RangeError for negative length", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "try { Buffer.alloc(2).write('abc', 0, -1); console.log('no-throw'); } catch (e) { console.log(e.name); }"`,
    );
    expect(result.stdout).toBe("RangeError\n");
    expect(result.exitCode).toBe(0);
  });
});
