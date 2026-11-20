import { afterEach, describe, expect, it, vi } from "vitest";
import { fromBuffer } from "./encoding.js";

// Browser service workers have no `Buffer`, so fromBuffer falls back to
// String.fromCharCode over chunks. Passing too many bytes as arguments throws
// "Maximum call stack size exceeded"; the effective limit depends on available
// stack, so the chunk size must stay well below it.
const MAX_ARGS = 8192;

// Sizes straddling the chunk boundary, including a 64KB `cat`-sized payload.
const SIZES = [
  0,
  1,
  MAX_ARGS - 1,
  MAX_ARGS,
  MAX_ARGS + 1,
  2 * MAX_ARGS + 1,
  65536,
  70001,
];

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  // Cover the full byte range, including values above 0x7f.
  for (let i = 0; i < length; i++) out[i] = (i * 131 + 7) & 0xff;
  return out;
}

function reference(data: Uint8Array, encoding: "base64" | "binary" | "latin1") {
  return Buffer.from(data).toString(encoding);
}

describe("fromBuffer without Buffer (browser fallback)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  for (const encoding of ["base64", "binary", "latin1"] as const) {
    it(`${encoding} matches Node output across chunk boundaries`, () => {
      const cases = SIZES.map((size) => {
        const data = bytes(size);
        return { size, data, expected: reference(data, encoding) };
      });
      vi.stubGlobal("Buffer", undefined);
      for (const { size, data, expected } of cases) {
        expect(fromBuffer(data, encoding), `size ${size}`).toBe(expected);
      }
    });

    it(`${encoding} never passes more than ${MAX_ARGS} arguments to String.fromCharCode`, () => {
      const data = bytes(70001);
      vi.stubGlobal("Buffer", undefined);
      const spy = vi.spyOn(String, "fromCharCode");
      fromBuffer(data, encoding);
      expect(spy).toHaveBeenCalled();
      const widest = Math.max(...spy.mock.calls.map((args) => args.length));
      expect(widest).toBeLessThanOrEqual(MAX_ARGS);
    });
  }
});
