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

let lastFailureReason = "";

describe("Malformed Script Fuzzing", () => {
  const runner = new FuzzRunner(config);
  const oracle = new SandboxOracle();

  async function logFailure(result: FuzzResult, reason: string): Promise<void> {
    await runner.logFailure(result, reason);
  }

  afterEach((context) => {
    if (context.task.result?.state === "fail") {
      console.error(
        `Malformed fuzz failure: ${lastFailureReason.split("\n", 1)[0].slice(0, 160) || "see test failure"}. Records: ${runner.getDiagnosticsPath()}`,
      );
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
        lastFailureReason = "";
        const result = await runner.run(script, label);

        // Script must either complete, timeout, or hit a limit
        const handled = result.completed || result.timedOut || result.hitLimit;
        if (!handled) {
          const reason = `${label}: script neither completed nor timed out`;
          lastFailureReason = reason;
          await logFailure(result, reason);
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
            lastFailureReason = reason;
            await logFailure(result, reason);
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
          lastFailureReason = reason;
          await logFailure(result, reason);
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
