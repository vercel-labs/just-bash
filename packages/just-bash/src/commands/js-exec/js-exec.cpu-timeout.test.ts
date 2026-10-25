import type { RunInput } from "run";
import { describe, expect, it, vi } from "vitest";
import { Bash } from "../../Bash.js";

const runInputs: RunInput[] = [];

// The CPU budget equals the wall-clock limit, so the wall deadline usually
// fires first. Raise run's CPU error directly to reach its mapping.
vi.mock("run", async (importOriginal) => {
  const run = await importOriginal<typeof import("run")>();
  return {
    ...run,
    createRunner: () => ({
      run: async (input: RunInput) => {
        runInputs.push(input);
        throw new run.RunCpuTimeoutError(5000);
      },
    }),
  };
});

describe("js-exec CPU budget", () => {
  it("gives run's CPU budget the wall-clock limit and reports its stop as the timeout", async () => {
    const bash = new Bash({
      javascript: true,
      executionLimits: { maxJsTimeoutMs: 5000 },
    });
    const result = await bash.exec(`js-exec -c "console.log('unreached')"`);

    expect(result).toMatchObject({
      exitCode: 124,
      stderr: "js-exec: Execution timeout: exceeded 5000ms limit\n",
      stdout: "",
    });
    expect(runInputs).toHaveLength(1);
    const limits = runInputs[0].limits;
    expect(limits?.cpuTimeoutMs).toBeGreaterThan(0);
    expect(limits?.cpuTimeoutMs).toBe(limits?.timeoutMs);
  });
});
