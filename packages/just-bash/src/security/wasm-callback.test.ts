import { describe, expect, it } from "vitest";
import { sanitizeUnknownError, wrapWasmCallback } from "./wasm-callback.js";

describe("wrapWasmCallback", () => {
  it("passes through callback return values", () => {
    const callback = wrapWasmCallback(
      "python3-worker",
      "print",
      (text: string) => text.toUpperCase(),
    );

    expect(callback("ok")).toBe("OK");
  });

  it("throws sanitized callback errors", () => {
    const callback = wrapWasmCallback("python3-worker", "printErr", () => {
      throw new Error(
        "boom at /Users/attacker/private.txt via node:internal/modules/cjs/loader:1234",
      );
    });

    expect(() => callback()).toThrow(
      "python3-worker printErr callback failed: boom at <path> via <internal>:1234",
    );
  });

  it("sanitizes unknown thrown values", () => {
    expect(
      sanitizeUnknownError(
        "bad at /Users/attacker/home with node:internal/test",
      ),
    ).toBe("bad at <path> with <internal>");
  });
});
