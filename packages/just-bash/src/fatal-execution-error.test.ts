import { describe, expect, it } from "vitest";
import { rethrowFatalExecutionError } from "./fatal-execution-error.js";
import {
  ExecutionAbortedError,
  ExecutionLimitError,
} from "./interpreter/errors.js";
import { SecurityViolationError } from "./security/defense-in-depth-box.js";

describe("rethrowFatalExecutionError", () => {
  it("rethrows safety failures unchanged", () => {
    const limit = new ExecutionLimitError("test", "iterations");
    const aborted = new ExecutionAbortedError();
    const violation = new SecurityViolationError("test", {
      type: "eval",
      message: "test",
      path: "globalThis.eval",
      timestamp: Date.now(),
      executionId: "test",
    });

    expect(() => rethrowFatalExecutionError(limit)).toThrow(limit);
    expect(() => rethrowFatalExecutionError(aborted)).toThrow(aborted);
    expect(() => rethrowFatalExecutionError(violation)).toThrow(violation);
  });

  it("allows ordinary command errors to be handled", () => {
    expect(() =>
      rethrowFatalExecutionError(new Error("ordinary")),
    ).not.toThrow();
  });
});
