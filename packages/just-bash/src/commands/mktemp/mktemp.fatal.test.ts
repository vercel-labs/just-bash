import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";
import { ExecutionAbortedError } from "../../interpreter/errors.js";

describe("mktemp fatal filesystem failures", () => {
  it.each([
    "stat",
    "createExclusive",
  ] as const)("does not reclassify %s cancellation", async (method) => {
    const bash = new Bash();
    vi.spyOn(bash.fs, method).mockRejectedValue(new ExecutionAbortedError());
    const result = await bash.exec("mktemp");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).not.toContain("failed to create");
  });
});
