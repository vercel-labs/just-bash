import { afterEach, describe, expect, it, vi } from "vitest";
import {
  bytesFromUint8Array,
  encodeUtf8ToBytes,
  latin1FromBytes,
  utf8ByteLength,
} from "./encoding.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each([false, true])("byte conversion (browser: %s)", (browser) => {
  it("counts UTF-8 bytes without changing surrogate handling", () => {
    const cases = [
      "",
      "ASCII\0\x7f",
      "é水😀\ud800x\udc00",
      Array.from({ length: 65536 }, (_, code) =>
        String.fromCharCode(code),
      ).join(""),
    ].map((input) => ({ input, expected: Buffer.byteLength(input, "utf8") }));
    if (browser) vi.stubGlobal("Buffer", undefined);
    for (const { input, expected } of cases) {
      expect(utf8ByteLength(input)).toBe(expected);
    }
  });

  it("preserves every byte, view offsets, and chunk tails", () => {
    const cases = [0, 1, 8191, 8192, 8193, 16385, 70001].map((size) => {
      const storage = Uint8Array.from(
        { length: size + 42 },
        (_, i) => (i * 131 + 7) & 255,
      );
      const view = storage.subarray(23, size + 23);
      return { view, expected: Buffer.from(view).toString("latin1") };
    });
    if (browser) vi.stubGlobal("Buffer", undefined);
    for (const { view, expected } of cases) {
      const result = latin1FromBytes(bytesFromUint8Array(view));
      expect(result).toBe(expected);
      view.fill(0);
      expect(result).toBe(expected);
    }
  });

  it("encodes ASCII, Unicode, and unpaired surrogates exactly", () => {
    const cases = [
      "",
      "ascii\0\x7f".repeat(10000),
      "é水😀\uD800x\uDC00".repeat(10000),
    ].map((input) => ({
      input,
      expected: Buffer.from(input, "utf8").toString("latin1"),
    }));
    if (browser) vi.stubGlobal("Buffer", undefined);
    for (const { input, expected } of cases) {
      expect(latin1FromBytes(encodeUtf8ToBytes(input))).toBe(expected);
    }
  });

  it("checks limits before both fast and fallback conversions", () => {
    if (browser) vi.stubGlobal("Buffer", undefined);
    for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => encodeUtf8ToBytes("a", limit)).toThrow(RangeError);
      expect(() => bytesFromUint8Array(new Uint8Array(1), limit)).toThrow(
        RangeError,
      );
    }
    expect(() => encodeUtf8ToBytes("abc", 2)).toThrow(RangeError);
    expect(() => encodeUtf8ToBytes("水", 2)).toThrow(RangeError);
    expect(() => bytesFromUint8Array(new Uint8Array(3), 2)).toThrow(RangeError);
    expect(latin1FromBytes(encodeUtf8ToBytes("abc", 3))).toBe("abc");
    expect(latin1FromBytes(encodeUtf8ToBytes("水", 3))).toHaveLength(3);
  });
});

it("bounds browser conversion argument counts", () => {
  vi.stubGlobal("Buffer", undefined);
  const spy = vi.spyOn(String, "fromCharCode");
  bytesFromUint8Array(new Uint8Array(70001));
  expect(spy).toHaveBeenCalled();
  for (const args of spy.mock.calls)
    expect(args.length).toBeLessThanOrEqual(8192);
});
