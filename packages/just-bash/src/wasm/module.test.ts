import { describe, expect, it } from "vitest";
import { limitModule } from "./module.js";

const header = [0, 97, 115, 109, 1, 0, 0, 0];
const memoryExport = [7, 10, 1, 6, 109, 101, 109, 111, 114, 121, 2, 0];

describe("WASM allocation bounds", () => {
  it("adds a maximum before instantiation to a memory with no declared limit", async () => {
    const original = new Uint8Array([
      ...header,
      5,
      3,
      1,
      0,
      1,
      ...memoryExport,
    ]);
    const bounded = limitModule(original, 2 * 65536, 10);
    const { instance } = await WebAssembly.instantiate(bounded);
    const memory = instance.exports.memory as WebAssembly.Memory;
    expect(memory.buffer.byteLength).toBe(65536);
    expect(memory.grow(1)).toBe(1);
    expect(() => memory.grow(1)).toThrow(RangeError);
  });

  it("preserves a module's stricter declared maximum", async () => {
    const original = new Uint8Array([
      ...header,
      5,
      4,
      1,
      1,
      1,
      1,
      ...memoryExport,
    ]);
    const { instance } = await WebAssembly.instantiate(
      limitModule(original, 8 * 65536, 10),
    );
    expect(() =>
      (instance.exports.memory as WebAssembly.Memory).grow(1),
    ).toThrow(RangeError);
  });

  it("bounds tables as well as linear memory", async () => {
    const table = [4, 4, 1, 0x70, 0, 1];
    const exports = [7, 9, 1, 5, 116, 97, 98, 108, 101, 1, 0];
    const original = new Uint8Array([
      ...header,
      ...table,
      5,
      3,
      1,
      0,
      1,
      ...exports,
    ]);
    const { instance } = await WebAssembly.instantiate(
      limitModule(original, 65536, 2),
    );
    const value = instance.exports.table as WebAssembly.Table;
    expect(value.grow(1)).toBe(1);
    expect(() => value.grow(1)).toThrow(RangeError);
  });

  it.each([
    ["large initial memory", [5, 3, 1, 0, 3]],
    ["shared memory", [5, 4, 1, 3, 1, 2]],
    ["multiple memories", [5, 5, 2, 0, 1, 0, 1]],
    ["memory64", [5, 3, 1, 4, 1]],
    ["automatic start", [5, 3, 1, 0, 1, 8, 1, 0]],
    ["truncated section", [5, 6, 1, 0, 1]],
  ])("rejects %s", (_label, sections) => {
    expect(() =>
      limitModule(new Uint8Array([...header, ...sections]), 2 * 65536, 10),
    ).toThrow();
  });
});
