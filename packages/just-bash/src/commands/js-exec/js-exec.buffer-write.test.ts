import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("Buffer.write character boundaries", () => {
  it.each([
    { value: "é", encoding: "utf8", offset: 0, length: 1, size: 4 },
    { value: "aéz", encoding: "utf-8", offset: 1, length: 2, size: 5 },
    { value: "€", encoding: "utf8", offset: 0, length: 2, size: 4 },
    { value: "😀", encoding: "utf8", offset: 0, length: 3, size: 4 },
    { value: "a😀z", encoding: "utf8", offset: 1, length: 5, size: 6 },
    { value: "é", encoding: "utf8", offset: 0, length: 2, size: 4 },
    { value: "é", encoding: "utf8", offset: 3, length: 4, size: 4 },
    { value: "hi", encoding: "utf16le", offset: 0, length: 1, size: 4 },
    { value: "hi", encoding: "utf-16le", offset: 1, length: 3, size: 5 },
    { value: "😀", encoding: "ucs2", offset: 0, length: 3, size: 4 },
    { value: "hi", encoding: "ucs-2", offset: 3, length: 4, size: 4 },
  ])("matches Node for $encoding writing $value with offset $offset and length $length", async ({
    value,
    encoding,
    offset,
    length,
    size,
  }) => {
    const nativeBuffer = Buffer.alloc(size, 0x7e);
    const written = nativeBuffer.write(
      value,
      offset,
      length,
      encoding as BufferEncoding,
    );
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "var b = Buffer.alloc(${size}, 126); var n = b.write('${value}', ${offset}, ${length}, '${encoding}'); console.log(n, b.toString('hex'))"`,
    );
    expect(result.stdout).toBe(`${written} ${nativeBuffer.toString("hex")}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("Buffer.write range validation", () => {
  it.each([
    ["offset", "4294967296"],
    ["offset", "-4294967296"],
    ["offset", "4294967297"],
    ["offset", "0.5"],
    ["offset", "NaN"],
    ["offset", "Infinity"],
    ["length", "4294967296"],
    ["length", "-4294967296"],
    ["length", "4294967297"],
    ["length", "0.5"],
    ["length", "NaN"],
    ["length", "Infinity"],
  ])("rejects %s %s without changing the buffer", async (argument, value) => {
    const args = argument === "offset" ? value : `0, ${value}`;
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "var b = Buffer.alloc(2, 126); try { b.write('X', ${args}); console.log('no-throw'); } catch (e) { console.log(e.name, b.toString('hex')); }"`,
    );
    expect(result.stdout).toBe("RangeError 7e7e\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    "null",
    "true",
    "{}",
  ])("rejects nonnumeric offsets and lengths: %s", async (value) => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "var b = Buffer.alloc(2, 126); for (var f of [function() { b.write('X', ${value}); }, function() { b.write('X', 0, ${value}); }]) { try { f(); console.log('no-throw'); } catch (e) { console.log(e.name, b.toString('hex')); } }"`,
    );
    expect(result.stdout).toBe("TypeError 7e7e\nTypeError 7e7e\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("Buffer encoding defaults", () => {
  it("uses UTF-8 for empty encodings in from, byteLength, and write overloads", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.from('é', '').toString('hex')); console.log(Buffer.byteLength('é', '')); var b = Buffer.alloc(2); console.log(b.write('é', ''), b.toString('hex')); b = Buffer.alloc(2); console.log(b.write('é', 0, ''), b.toString('hex')); b = Buffer.alloc(2); console.log(b.write('é', 0, 2, ''), b.toString('hex'));"`,
    );
    expect(result.stdout).toBe("c3a9\n2\n2 c3a9\n2 c3a9\n2 c3a9\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("falls back to UTF-8 for unknown byteLength encodings", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "console.log(Buffer.byteLength('é', 'unknown'), Buffer.byteLength('😀', 'UTF-7'), Buffer.byteLength('', 'unknown'));"`,
    );
    expect(result.stdout).toBe("2 4 0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("still rejects unknown encodings in from, toString, and write", async () => {
    const env = new Bash({ javascript: true });
    const result = await env.exec(
      `js-exec -c "for (var f of [function() { Buffer.from('é', 'unknown'); }, function() { Buffer.from('é').toString('unknown'); }, function() { Buffer.alloc(4).write('é', 0, 4, 'unknown'); }]) { try { f(); console.log('no-throw'); } catch (e) { console.log(e.name, e.message); } }"`,
    );
    expect(result.stdout).toBe(
      "TypeError Unknown encoding: unknown\n".repeat(3),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
