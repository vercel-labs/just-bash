import { describe, expect, it } from "vitest";
import { ExecutionLimitError } from "../errors.js";
import {
  splitByIfsForExpansion,
  splitByIfsForExpansionEx,
  splitByIfsForRead,
} from "./ifs.js";

describe("bounded IFS splitting", () => {
  it("fails before expansion output exceeds the element budget", () => {
    expect(() => splitByIfsForExpansion("a b c", " ", 2)).toThrow(
      ExecutionLimitError,
    );
    expect(splitByIfsForExpansion("a b c", " ", 3)).toEqual(["a", "b", "c"]);
  });

  it("bounds empty fields created by non-whitespace delimiters", () => {
    expect(() => splitByIfsForExpansionEx("a::::b", ":", 3)).toThrow(
      /array element limit exceeded \(3\)/,
    );
  });

  it("bounds both read results and their auxiliary start offsets", () => {
    expect(() => splitByIfsForRead("a::b", ":", 2)).toThrow(
      ExecutionLimitError,
    );
    expect(splitByIfsForRead("a::b", ":", 3)).toEqual({
      words: ["a", "", "b"],
      wordStarts: [0, 2, 3],
    });
  });

  it("rejects a singleton result when the configured budget is zero", () => {
    expect(() => splitByIfsForExpansion("value", "", 0)).toThrow(
      ExecutionLimitError,
    );
    expect(() => splitByIfsForRead("value", "", 0)).toThrow(
      ExecutionLimitError,
    );
  });
});
