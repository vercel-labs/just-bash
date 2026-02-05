/**
 * Malformed Script Fuzzing Tests
 *
 * Tests that intentionally broken scripts never crash the interpreter.
 * They should always complete (possibly with parse errors), hit limits, or timeout.
 * No native code should leak through parse error paths.
 */

import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { createFcOptions, createFuzzConfig } from "../config.js";
import {
  byteInjectedScript,
  degenerateScript,
  invalidOperator,
  malformedScript,
  missingKeyword,
  mutatedCompound,
  truncatedScript,
  unclosedParen,
  unclosedQuote,
} from "../generators/malformed-generator.js";
import { SandboxOracle } from "../oracles/sandbox-oracle.js";
import type { FuzzResult } from "../runners/fuzz-runner.js";
import { FuzzRunner } from "../runners/fuzz-runner.js";

const numRuns = Number(process.env.FUZZ_RUNS) || 50;
// Scale vitest timeout: ~5ms per run + generous baseline
const testTimeout = Math.max(10_000, numRuns * 5 + 5000);
const config = createFuzzConfig({
  numRuns,
  timeoutMs: 2000,
  scriptLogFile: "fuzz-malformed.log",
  failureLogFile: "fuzz-malformed-failures.log",
});

let lastTestedScript = "";
let lastResult: FuzzResult | null = null;
let lastFailureReason = "";

function trackScript(script: string): string {
  lastTestedScript = script;
  return script;
}

function trackResult(result: FuzzResult, reason: string): void {
  lastResult = result;
  lastFailureReason = reason;
}

describe("Malformed Script Fuzzing", () => {
  const runner = new FuzzRunner(config);
  const oracle = new SandboxOracle();

  function logFailure(result: FuzzResult, reason: string): void {
    runner.logFailure(result, reason);
  }

  afterEach((context) => {
    if (context.task.result?.state === "fail") {
      console.error("\n=== Malformed Fuzz Test Failure ===");
      console.error(`Script: ${lastTestedScript}`);
      console.error(`Reason: ${lastFailureReason}`);
      if (lastResult) {
        console.error(`Completed: ${lastResult.completed}`);
        console.error(`Timed out: ${lastResult.timedOut}`);
        console.error(`Hit limit: ${lastResult.hitLimit}`);
        console.error(`Exit code: ${lastResult.exitCode}`);
        console.error(`Duration: ${lastResult.durationMs}ms`);
        if (lastResult.error) {
          console.error(`Error: ${lastResult.error.message}`);
        }
        if (lastResult.stderr) {
          console.error(`Stderr: ${lastResult.stderr.slice(0, 200)}`);
        }
      }
      console.error("===================================\n");
    }
  });

  /**
   * Core assertion: malformed scripts must never produce unhandled crashes.
   * They should complete (with errors), hit limits, or timeout.
   */
  async function assertGracefulHandling(
    arb: fc.Arbitrary<string>,
    label: string,
  ): Promise<void> {
    await fc.assert(
      fc.asyncProperty(arb, async (script) => {
        trackScript(script);
        const result = await runner.run(script);
        trackResult(result, "");

        // Script must either complete, timeout, or hit a limit
        const handled = result.completed || result.timedOut || result.hitLimit;
        if (!handled) {
          const reason = `${label}: script neither completed nor timed out`;
          trackResult(result, reason);
          logFailure(result, reason);
          expect(handled, reason).toBe(true);
        }

        // No unhandled JS errors (RangeError from stack overflow is ok)
        if (result.error) {
          const msg = result.error.message;
          const acceptable =
            msg.includes("stack") ||
            msg.includes("limit") ||
            msg.includes("exceeded") ||
            msg.includes("maximum") ||
            msg.includes("Maximum call stack");
          if (!acceptable) {
            const reason = `${label}: unexpected error: ${msg}`;
            trackResult(result, reason);
            logFailure(result, reason);
            expect(acceptable, reason).toBe(true);
          }
        }

        // No native code leaks
        const stdout = result.stdout || "";
        const stderr = result.stderr || "";
        if (
          oracle.containsNativeCode(stdout) ||
          oracle.containsNativeCode(stderr)
        ) {
          const reason = `${label}: native code leak detected`;
          trackResult(result, reason);
          logFailure(result, reason);
          expect(false, reason).toBe(true);
        }
      }),
      createFcOptions(config),
    );
  }

  describe("combined malformed", () => {
    it(
      "handles all malformed script types gracefully",
      async () => {
        await assertGracefulHandling(malformedScript, "malformed");
      },
      testTimeout,
    );
  });

  describe("individual categories", () => {
    it(
      "handles truncated scripts",
      async () => {
        await assertGracefulHandling(truncatedScript, "truncated");
      },
      testTimeout,
    );

    it(
      "handles unclosed quotes",
      async () => {
        await assertGracefulHandling(unclosedQuote, "unclosedQuote");
      },
      testTimeout,
    );

    it(
      "handles unclosed parens",
      async () => {
        await assertGracefulHandling(unclosedParen, "unclosedParen");
      },
      testTimeout,
    );

    it(
      "handles missing keywords",
      async () => {
        await assertGracefulHandling(missingKeyword, "missingKeyword");
      },
      testTimeout,
    );

    it(
      "handles invalid operators",
      async () => {
        await assertGracefulHandling(invalidOperator, "invalidOperator");
      },
      testTimeout,
    );

    it(
      "handles byte-injected scripts",
      async () => {
        await assertGracefulHandling(byteInjectedScript, "byteInjected");
      },
      testTimeout,
    );

    it(
      "handles degenerate scripts",
      async () => {
        await assertGracefulHandling(degenerateScript, "degenerate");
      },
      testTimeout,
    );

    it(
      "handles mutated compound commands",
      async () => {
        await assertGracefulHandling(mutatedCompound, "mutatedCompound");
      },
      testTimeout,
    );
  });
});
