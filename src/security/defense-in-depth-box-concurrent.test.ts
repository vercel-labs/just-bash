/**
 * Concurrent Execution Tests for Defense-in-Depth Box
 *
 * These tests verify that AsyncLocalStorage correctly isolates
 * sandboxed contexts from concurrent non-sandboxed operations.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "./defense-in-depth-box.js";

describe("DefenseInDepthBox concurrent execution", () => {
  beforeEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

  describe("AsyncLocalStorage isolation", () => {
    it("should isolate sandbox context from concurrent operations", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      // Start concurrent operation OUTSIDE sandbox context
      // This should complete successfully since it's not in sandbox context
      const outsidePromise = new Promise<string>((resolve) => {
        // Use setImmediate which runs outside the AsyncLocalStorage context
        setImmediate(() => {
          // This code runs outside sandbox context
          const fn = new Function("return 'outside'");
          resolve(fn());
        });
      });

      // Run sandboxed code - should throw
      let insideError: Error | undefined;
      const insidePromise = handle.run(async () => {
        try {
          new Function("return 1");
          return "should not reach";
        } catch (e) {
          insideError = e as Error;
          return "blocked inside";
        }
      });

      const [outside, inside] = await Promise.all([
        outsidePromise,
        insidePromise,
      ]);

      handle.deactivate();

      expect(outside).toBe("outside");
      expect(inside).toBe("blocked inside");
      expect(insideError).toBeInstanceOf(SecurityViolationError);
    });

    it("should maintain context through async/await chains", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      // Capture context status at various points
      const contextStatus: boolean[] = [];
      const executionIds: (string | undefined)[] = [];

      await handle.run(async () => {
        // Level 1
        contextStatus.push(DefenseInDepthBox.isInSandboxedContext());
        executionIds.push(DefenseInDepthBox.getCurrentExecutionId());
        await Promise.resolve();

        // Level 2 - context should persist after await
        contextStatus.push(DefenseInDepthBox.isInSandboxedContext());

        await (async () => {
          await Promise.resolve();

          // Level 3 - still in context
          contextStatus.push(DefenseInDepthBox.isInSandboxedContext());
          executionIds.push(DefenseInDepthBox.getCurrentExecutionId());
        })();

        // Back to level 1 - still in context
        contextStatus.push(DefenseInDepthBox.isInSandboxedContext());
      });

      handle.deactivate();

      // All should be true (in context)
      expect(contextStatus).toEqual([true, true, true, true]);
      // All execution IDs should match
      expect(executionIds.every((id) => id === handle.executionId)).toBe(true);
    });

    it("should maintain context through Promise.all", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      const contextResults: boolean[] = [];

      await handle.run(async () => {
        const promises = [
          Promise.resolve().then(() => {
            // Still in context after microtask
            contextResults.push(DefenseInDepthBox.isInSandboxedContext());
            return "a";
          }),
          (async () => {
            await Promise.resolve();
            // Still in context
            contextResults.push(DefenseInDepthBox.isInSandboxedContext());
            return "b";
          })(),
          Promise.resolve().then(async () => {
            await Promise.resolve();
            contextResults.push(DefenseInDepthBox.isInSandboxedContext());
            return "c";
          }),
        ];

        const results = await Promise.all(promises);
        return results;
      });

      handle.deactivate();

      // All context checks should be true
      expect(contextResults).toEqual([true, true, true]);
    });

    it("should handle multiple concurrent sandbox contexts independently", async () => {
      const box = DefenseInDepthBox.getInstance(true);

      const handle1 = box.activate();
      const handle2 = box.activate();

      // Capture execution IDs from each context
      let id1: string | undefined;
      let id2: string | undefined;

      // Both handles create independent execution contexts
      const results = await Promise.all([
        handle1.run(async () => {
          id1 = DefenseInDepthBox.getCurrentExecutionId();
          return "context1";
        }),
        handle2.run(async () => {
          id2 = DefenseInDepthBox.getCurrentExecutionId();
          return "context2";
        }),
      ]);

      handle1.deactivate();
      handle2.deactivate();

      expect(results).toEqual(["context1", "context2"]);
      expect(id1).toBe(handle1.executionId);
      expect(id2).toBe(handle2.executionId);
    });

    it("should not leak context to unrelated async operations", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      // Start an operation BEFORE entering sandbox context
      let outsideCheckResult: boolean | undefined;
      const outsideCheck = new Promise<void>((resolve) => {
        setImmediate(() => {
          // This runs in the main context, not the sandbox context
          outsideCheckResult = DefenseInDepthBox.isInSandboxedContext();
          resolve();
        });
      });

      // Now enter sandbox context
      let insideCheckResult: boolean | undefined;
      await handle.run(async () => {
        insideCheckResult = DefenseInDepthBox.isInSandboxedContext();
        // Wait for the outside check to complete
        await outsideCheck;
      });

      handle.deactivate();

      // The outside check should have been false
      expect(outsideCheckResult).toBe(false);
      // The inside check should have been true
      expect(insideCheckResult).toBe(true);
    });
  });

  describe("integration with Bash.exec()", () => {
    it("should isolate multiple concurrent bash.exec() calls", async () => {
      const bash = new Bash({ defenseInDepth: true });

      // Run two bash.exec() concurrently
      const [result1, result2] = await Promise.all([
        bash.exec('echo "first"'),
        bash.exec('echo "second"'),
      ]);

      expect(result1.stdout.trim()).toBe("first");
      expect(result2.stdout.trim()).toBe("second");
      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
    });

    it("should not interfere with normal bash execution", async () => {
      const bash = new Bash({ defenseInDepth: true });

      const result = await bash.exec(`
        x=5
        y=3
        echo $((x + y))
      `);

      expect(result.stdout.trim()).toBe("8");
      expect(result.exitCode).toBe(0);
    });

    it("should allow disabling defense-in-depth", async () => {
      const bash = new Bash({ defenseInDepth: false });

      const result = await bash.exec('echo "no defense"');

      expect(result.stdout.trim()).toBe("no defense");
      expect(result.exitCode).toBe(0);
    });

    it("should work with audit mode", async () => {
      const violations: { type: string }[] = [];
      const bash = new Bash({
        defenseInDepth: {
          enabled: true,
          auditMode: true,
          onViolation: (v) => violations.push({ type: v.type }),
        },
      });

      const result = await bash.exec('echo "audit mode"');

      expect(result.stdout.trim()).toBe("audit mode");
      expect(result.exitCode).toBe(0);
      // Normal bash operations shouldn't trigger violations
      // Violations would only occur if bash tried to use blocked globals
    });
  });

  describe("error recovery", () => {
    it("should restore patches even after errors in sandboxed code", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      // Cause an error inside the sandbox
      let caughtError: Error | undefined;
      try {
        await handle.run(async () => {
          throw new Error("intentional error");
        });
      } catch (e) {
        caughtError = e as Error;
      }

      handle.deactivate();

      expect(caughtError?.message).toBe("intentional error");

      // Patches should be restored
      expect(box.isActive()).toBe(false);
      const fn = new Function("return 42");
      expect(fn()).toBe(42);
    });

    it("should restore patches after security violation", async () => {
      const box = DefenseInDepthBox.getInstance(true);
      const handle = box.activate();

      let caughtError: Error | undefined;
      await handle.run(async () => {
        try {
          new Function("return 1");
        } catch (e) {
          caughtError = e as Error;
        }
      });

      handle.deactivate();

      expect(caughtError).toBeInstanceOf(SecurityViolationError);

      // Patches should be restored
      const fn = new Function("return 42");
      expect(fn()).toBe(42);
    });
  });
});
