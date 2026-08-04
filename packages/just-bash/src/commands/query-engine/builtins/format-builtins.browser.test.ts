import { afterEach, describe, expect, it, vi } from "vitest";
import { evalFormatBuiltin } from "./format-builtins.js";

describe("query format builtins in browser mode", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("encodes Unicode as UTF-8 before browser base64 conversion", () => {
    vi.stubGlobal("Buffer", undefined);

    expect(evalFormatBuiltin("✓ café 😀", "@base64")).toEqual([
      "4pyTIGNhZsOpIPCfmIA=",
    ]);
  });

  it("decodes browser base64 bytes using defined UTF-8 replacement", () => {
    vi.stubGlobal("Buffer", undefined);

    expect(evalFormatBuiltin("4pyTIGNhZsOpIPCfmIA=", "@base64d")).toEqual([
      "✓ café 😀",
    ]);
    expect(evalFormatBuiltin("/w==", "@base64d")).toEqual(["�"]);
  });
});
