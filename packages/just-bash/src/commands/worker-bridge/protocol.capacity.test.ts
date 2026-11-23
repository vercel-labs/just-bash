import { describe, expect, it } from "vitest";
import { resolveLimits } from "../../limits.js";
import { createSharedBuffer, ProtocolBuffer } from "./protocol.js";

describe("Python bridge capacity configuration", () => {
  it.each([
    "normal",
    "hardened",
  ] as const)("retains an 8 MiB default in the %s profile", (profile) => {
    expect(resolveLimits(undefined, profile).maxPythonBridgeBytes).toBe(
      8 * 1024 * 1024,
    );
    expect(resolveLimits({}, profile).maxPythonBridgeBytes).toBe(
      8 * 1024 * 1024,
    );
  });

  it("resolves an explicit capacity", () => {
    expect(
      resolveLimits({ maxPythonBridgeBytes: 1025 }).maxPythonBridgeBytes,
    ).toBe(1025);
  });

  it.each([
    0,
    23,
    -1,
    24.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    0x80000000,
  ])("rejects invalid capacity %s before allocating a worker buffer", (capacity) => {
    expect(() => resolveLimits({ maxPythonBridgeBytes: capacity })).toThrow(
      RangeError,
    );
    expect(() => createSharedBuffer(capacity)).toThrow(RangeError);
  });
});

describe("ProtocolBuffer capacity", () => {
  it.each([
    24,
    25,
    1025,
    8 * 1024 * 1024 + 1,
  ])("uses the shared buffer's exact %s-byte capacity on both sides", (capacity) => {
    const buffer = createSharedBuffer(capacity);
    expect(buffer.byteLength).toBe(32 + 4096 + capacity);
    const worker = new ProtocolBuffer(buffer);
    const host = new ProtocolBuffer(buffer);
    const data = new Uint8Array(capacity).fill(97);

    worker.setData(data);
    expect(Buffer.from(host.getData()).equals(Buffer.from(data))).toBe(true);
    host.setResult(data);
    expect(Buffer.from(worker.getResult()).equals(Buffer.from(data))).toBe(
      true,
    );
    expect(() => worker.setData(new Uint8Array(capacity + 1))).toThrow(
      `Data too large: ${capacity + 1} > ${capacity}`,
    );
    expect(() => host.setResult(new Uint8Array(capacity + 1))).toThrow(
      `Result too large: ${capacity + 1} > ${capacity}`,
    );
  });

  it("can encode a stat reply at the minimum capacity", () => {
    const buffer = new ProtocolBuffer(createSharedBuffer(24));
    const stat = {
      isFile: true,
      isDirectory: false,
      isSymbolicLink: false,
      mode: 0o644,
      size: 1025,
      mtime: new Date(0),
    };
    buffer.encodeStat(stat);
    expect(buffer.decodeStat()).toEqual(stat);
  });

  it("preserves the default buffer layout", () => {
    expect(createSharedBuffer().byteLength).toBe(32 + 4096 + 8 * 1024 * 1024);
  });
});
