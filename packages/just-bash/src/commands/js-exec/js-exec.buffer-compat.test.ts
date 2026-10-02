import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

async function expectNodeOutput(source: string) {
  const expected = execFileSync(process.execPath, ["-e", source], {
    encoding: "utf8",
  });
  const env = new Bash({ javascript: true, files: { "/test.js": source } });
  const result = await env.exec("js-exec /test.js");
  expect(result.stdout).toBe(expected);
  expect(result.stderr).toBe("");
  expect(result.exitCode).toBe(0);
}

describe("Buffer UTF-8 decoding compatibility", () => {
  it("matches Node for malformed sequences and valid Unicode boundaries", async () => {
    const cases = [
      [],
      [0],
      [0x7f],
      [0xc2, 0x80],
      [0xdf, 0xbf],
      [0xe0, 0xa0, 0x80],
      [0xed, 0x9f, 0xbf],
      [0xee, 0x80, 0x80],
      [0xef, 0xbf, 0xbf],
      [0xf0, 0x90, 0x80, 0x80],
      [0xf4, 0x8f, 0xbf, 0xbf],
      // Overlong, surrogate, out-of-range, and invalid leading bytes.
      [0xc0, 0x80],
      [0xc1, 0xbf],
      [0xe0, 0x80, 0x80],
      [0xed, 0xa0, 0x80],
      [0xed, 0xbf, 0xbf],
      [0xf0, 0x80, 0x80, 0x80],
      [0xf4, 0x90, 0x80, 0x80],
      [0xf5, 0x80, 0x80, 0x80],
      [0xff],
      // Truncated prefixes and malformed continuations at each position.
      [0xc2],
      [0xe2],
      [0xe2, 0x82],
      [0xf0],
      [0xf0, 0x9f],
      [0xf0, 0x9f, 0x98],
      [0xc2, 0x41],
      [0xe2, 0x41, 0x80],
      [0xe2, 0x82, 0x41],
      [0xf0, 0x41, 0x80, 0x80],
      [0xf0, 0x9f, 0x41, 0x80],
      [0xf0, 0x9f, 0x98, 0x41],
      [0xe2, 0x82, 0xc2, 0xa2],
      [0xf0, 0x9f, 0xe2, 0x82, 0xac],
    ];
    for (let byte = 0; byte < 256; byte++) cases.push([byte]);
    // Cover all second-byte combinations, including restriction boundaries.
    for (const lead of [0xc0, 0xc2, 0xdf, 0xe0, 0xed, 0xf0, 0xf4, 0xf5]) {
      for (let next = 0; next < 256; next++) {
        cases.push([lead, next, 0x80, 0x80, 0x61]);
      }
    }
    await expectNodeOutput(`
      var cases = ${JSON.stringify(cases)};
      console.log(JSON.stringify(cases.map(function(bytes) {
        return Buffer.from(bytes).toString('utf8');
      })));
    `);
  });

  it("matches Node for every range cutting multibyte characters", async () => {
    await expectNodeOutput(`
      var b = Buffer.from('aé€😀z');
      var output = [];
      for (var start = 0; start <= b.length; start++) {
        for (var end = start; end <= b.length; end++) {
          output.push(b.toString('utf8', start, end));
        }
      }
      console.log(JSON.stringify(output));
    `);
  });

  it("also replaces malformed sequences in the shared StringDecoder decoder", async () => {
    await expectNodeOutput(`
      var StringDecoder = require('string_decoder').StringDecoder;
      var cases = [[128], [192, 128], [237, 160, 128], [244, 144, 128, 128],
        [226, 130, 65], [240, 159, 152, 65], [226, 130], [240, 159, 152]];
      console.log(JSON.stringify(cases.map(function(bytes) {
        return new StringDecoder('utf8').end(Buffer.from(bytes));
      })));
    `);
  });
});

describe("Buffer ArrayBuffer view compatibility", () => {
  it("copies and truncates numeric typed-array elements rather than backing bytes", async () => {
    await expectNodeOutput(`
      var types = [Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array,
        Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array];
      console.log(JSON.stringify(types.map(function(Type) {
        var input = new Type([0, 0x1234, -1, 257, 3.75, NaN, Infinity]);
        var view = input.subarray(1, 6);
        var b = Buffer.from(view);
        input[1] = 9;
        var copied = b.toString('hex');
        b.write('X', 0);
        return [Type.name, copied, b.toString('hex'), input[1],
          Buffer.byteLength(view), Buffer.byteLength(view, 'invalid')];
      })));
    `);
  });

  it("keeps DataView conversion empty and reports view byte lengths", async () => {
    await expectNodeOutput(`
      var ab = new ArrayBuffer(12);
      var view = new DataView(ab, 3, 5);
      view.setUint8(0, 52);
      console.log(Buffer.from(view).toString('hex'), Buffer.byteLength(view),
        Buffer.byteLength(ab), Buffer.byteLength(new Uint16Array(ab, 4, 2)));
    `);
  });

  it("shares an ArrayBuffer range in both directions", async () => {
    await expectNodeOutput(`
      var ab = new ArrayBuffer(6);
      var input = new Uint8Array(ab);
      input.set([1, 2, 3, 4, 5, 6]);
      var b = Buffer.from(ab, 2, 3);
      input[2] = 99;
      console.log(b.toString('hex'));
      b.write('X', 1);
      console.log(Buffer.from(input).toString('hex'), Buffer.byteLength(b));
    `);
  });

  it("supports SharedArrayBuffer when the guest runtime provides it", async () => {
    const source = `
      if (typeof SharedArrayBuffer === 'undefined') console.log('unavailable');
      else {
        var ab = new SharedArrayBuffer(6);
        var input = new Uint8Array(ab);
        input.set([1, 2, 3, 4, 5, 6]);
        var b = Buffer.from(ab, 2, 3);
        input[2] = 99;
        console.log(b.toString('hex'));
        b.write('X', 1);
        console.log(Buffer.from(input).toString('hex'), Buffer.byteLength(ab));
      }
    `;
    const env = new Bash({ javascript: true, files: { "/test.js": source } });
    const result = await env.exec("js-exec /test.js");
    const native = execFileSync(process.execPath, ["-e", source], {
      encoding: "utf8",
    });
    expect(["unavailable\n", native]).toContain(result.stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("Buffer.toString encoding compatibility", () => {
  it("rejects null and empty encodings except for empty output ranges", async () => {
    await expectNodeOutput(`
      var output = [];
      for (var encoding of [undefined, null, '', 'unknown', 'UTF-8']) {
        for (var args of [[encoding], [encoding, 0, 0], [encoding, 2],
          [encoding, 1, 0], [encoding, 0, -1]]) {
          for (var b of [Buffer.from('é'), Buffer.alloc(0)]) {
            try { output.push(b.toString.apply(b, args)); }
            catch (e) { output.push([e.name, e.message]); }
          }
        }
      }
      console.log(JSON.stringify(output));
    `);
  });

  it("retains UTF-8 defaults in from, byteLength, and write", async () => {
    await expectNodeOutput(`
      var output = [];
      for (var encoding of [undefined, null, '']) {
        var b = Buffer.alloc(2);
        output.push([Buffer.from('é', encoding).toString('hex'),
          Buffer.byteLength('é', encoding), b.write('é', 0, 2, encoding),
          b.toString('hex')]);
      }
      console.log(JSON.stringify(output));
    `);
  });
});
