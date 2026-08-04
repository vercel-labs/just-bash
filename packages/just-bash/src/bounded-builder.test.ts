import { describe, expect, it } from "vitest";
import {
  BoundedByteBuilder,
  BoundedStringBuilder,
  boundedJoin,
  boundedRepeat,
  checkedAdd,
  checkedMultiply,
} from "./bounded-builder.js";
import { ExecutionLimitError } from "./interpreter/errors.js";

describe("bounded construction", () => {
  it("rejects invalid capacities before accepting data", () => {
    expect(() => new BoundedStringBuilder(Number.NaN, "test")).toThrow(
      ExecutionLimitError,
    );
    expect(() => new BoundedByteBuilder(-1, "test")).toThrow(
      ExecutionLimitError,
    );
  });

  it("counts UTF-8 before appending", () => {
    const builder = new BoundedStringBuilder(4, "test");
    builder.append("é").append("é");

    expect(builder.byteLength).toBe(4);
    expect(builder.build()).toBe("éé");
    expect(() => builder.append("x")).toThrow(ExecutionLimitError);
  });

  it("rejects repeat before materializing it", () => {
    const builder = new BoundedStringBuilder(8, "test");

    expect(() => builder.repeat("é", 5)).toThrow(ExecutionLimitError);
    expect(builder.byteLength).toBe(0);
    expect(builder.build()).toBe("");
  });

  it("can reserve capacity for framing emitted by the caller", () => {
    const builder = new BoundedStringBuilder(4, "test", undefined, 1);
    builder.append("abc");

    expect(builder.byteLength).toBe(3);
    expect(builder.remainingBytes).toBe(0);
    expect(() => builder.append("d")).toThrow(ExecutionLimitError);
  });

  it("assembles byte chunks within the configured bound", () => {
    const builder = new BoundedByteBuilder(4, "test");
    builder.append(Uint8Array.of(1, 2)).append(Uint8Array.of(3, 4));

    expect(builder.build()).toEqual(Uint8Array.of(1, 2, 3, 4));
    expect(() => builder.append(Uint8Array.of(5))).toThrow(ExecutionLimitError);
  });

  it("rejects unsafe arithmetic before construction", () => {
    expect(() => checkedAdd(Number.MAX_SAFE_INTEGER, 1, "test")).toThrow(
      ExecutionLimitError,
    );
    expect(() => checkedMultiply(Number.MAX_SAFE_INTEGER, 2, "test")).toThrow(
      ExecutionLimitError,
    );
    expect(checkedMultiply(7, 6, "test")).toBe(42);
  });

  it("provides guarded repeat and join helpers", () => {
    expect(boundedRepeat("é", 2, 4, "test")).toBe("éé");
    expect(() => boundedRepeat("é", 3, 4, "test")).toThrow(ExecutionLimitError);
    expect(boundedJoin(["a", "é"], ",", 4, "test")).toBe("a,é");
    expect(() => boundedJoin(["a", "é"], ",", 3, "test")).toThrow(
      ExecutionLimitError,
    );
  });
});
