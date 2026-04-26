import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";

describe("python3 queue runtime desync checks", () => {
  it(
    "isolated python timeout baseline (no shared queue contention)",
    { timeout: 60000 },
    async () => {
      const bash = new Bash({
        python: true,
        executionLimits: { maxPythonTimeoutMs: 5 },
      });

      const result = await bash.exec(
        `python3 -c "import time; print('BASELINE_BEGIN'); time.sleep(0.2); print('BASELINE_END')"`,
      );

      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "\npython3: execution timeout exceeded\npython3: Execution timeout: exceeded 5ms limit\n",
      );
      expect(result.exitCode).toBe(124);
    },
  );

  it(
    "queued timeout request should not leak stdout from an in-flight request",
    { timeout: 60000 },
    async () => {
      const sharedFs = new InMemoryFs();

      const slowBash = new Bash({
        fs: sharedFs,
        python: true,
        executionLimits: { maxPythonTimeoutMs: 30000 },
      });

      const fastTimeoutBash = new Bash({
        fs: sharedFs,
        python: true,
        executionLimits: { maxPythonTimeoutMs: 5 },
      });

      const firstPromise = slowBash.exec(
        `python3 -c "import time; print('FIRST_BEGIN'); time.sleep(0.2); print('FIRST_END')"`,
      );

      // Let the first request occupy the shared per-FS execution queue.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const secondResult = await fastTimeoutBash.exec(
        `python3 -c "print('SECOND_ONLY')"`,
      );

      const firstResult = await firstPromise;

      expect(secondResult.stdout).toBe("");
      expect(secondResult.stderr).toBe(
        "\npython3: execution timeout exceeded\npython3: Execution timeout: exceeded 5ms limit\n",
      );
      expect(secondResult.exitCode).toBe(124);

      expect(firstResult.stdout).toBe("FIRST_BEGIN\nFIRST_END\n");
      expect(firstResult.stderr).toBe("");
      expect(firstResult.exitCode).toBe(0);
    },
  );

  it(
    "timed-out queued request must not execute later and mutate filesystem",
    { timeout: 60000 },
    async () => {
      const sharedFs = new InMemoryFs();

      const blocker = new Bash({
        fs: sharedFs,
        python: true,
        executionLimits: { maxPythonTimeoutMs: 30000 },
      });

      const timed = new Bash({
        fs: sharedFs,
        python: true,
        executionLimits: { maxPythonTimeoutMs: 5 },
      });

      // Ensure clean marker state.
      await blocker.exec("rm -f /tmp/queued-timeout-marker");

      const blockerPromise = blocker.exec(
        `python3 -c "import time; time.sleep(0.2)"`,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));

      const timedResult = await timed.exec(
        `python3 -c "open('/tmp/queued-timeout-marker','w').write('LATE_EXEC')"`,
      );

      expect(timedResult.stdout).toBe("");
      expect(timedResult.stderr).toBe(
        "\npython3: execution timeout exceeded\npython3: Execution timeout: exceeded 5ms limit\n",
      );
      expect(timedResult.exitCode).toBe(124);

      await blockerPromise;
      // Give any (buggy) late execution a chance to run if queue-cancel logic is broken.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const markerCheck = await blocker.exec(
        "[ -f /tmp/queued-timeout-marker ] && echo MARKER_PRESENT || echo MARKER_ABSENT",
      );
      expect(markerCheck.stdout).toBe("MARKER_ABSENT\n");
      expect(markerCheck.stderr).toBe("");
      expect(markerCheck.exitCode).toBe(0);
    },
  );
});
