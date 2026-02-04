/**
 * DOS Detection Fuzzing Tests
 *
 * Property-based tests for detecting denial-of-service vulnerabilities.
 * Uses grammar-based generation for comprehensive syntax exploration.
 */

import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { createFcOptions, createFuzzConfig } from "../config.js";
import { ARITHMETIC_ATTACKS, DOS_ATTACKS } from "../corpus/known-attacks.js";
import {
  bashArithmetic,
  bashCompound,
  bashScript,
} from "../generators/grammar-generator.js";
import { DOSOracle } from "../oracles/dos-oracle.js";
import type { FuzzResult } from "../runners/fuzz-runner.js";
import { FuzzRunner } from "../runners/fuzz-runner.js";

const numRuns = Number(process.env.FUZZ_RUNS) || 50;
const config = createFuzzConfig({
  numRuns,
  timeoutMs: 2000,
  scriptLogFile: "fuzz-dos.log",
  failureLogFile: "fuzz-dos-failures.log",
});

let lastTestedScript = "";

function trackScript(script: string): string {
  lastTestedScript = script;
  return script;
}

function formatError(
  script: string,
  result: FuzzResult,
  context?: string,
): string {
  const lines = [
    "=== FUZZ TEST FAILURE ===",
    context ? `Context: ${context}` : "",
    `Script:\n${script}`,
    "---",
    `Completed: ${result.completed}`,
    `Timed out: ${result.timedOut}`,
    `Hit limit: ${result.hitLimit}`,
    `Duration: ${result.durationMs}ms`,
    `Exit code: ${result.exitCode}`,
    result.stdout ? `Stdout: ${result.stdout.slice(0, 200)}` : "",
    result.stderr ? `Stderr: ${result.stderr.slice(0, 200)}` : "",
    result.error ? `Error: ${result.error.message}` : "",
    "=========================",
  ];
  return lines.filter(Boolean).join("\n");
}

describe("DOS Detection Fuzzing", () => {
  const runner = new FuzzRunner(config);
  const oracle = new DOSOracle(config);

  afterEach((context) => {
    if (context.task.result?.state === "fail" && lastTestedScript) {
      console.error("\n=== LAST TESTED SCRIPT (on failure/timeout) ===");
      console.error(lastTestedScript);
      console.error("================================================\n");
    }
    lastTestedScript = "";
  });

  describe("Known Attack Corpus", () => {
    describe("DOS Attacks", () => {
      for (const attack of DOS_ATTACKS) {
        it(`should handle gracefully: ${attack.name}`, async () => {
          const result = await runner.run(attack.script);
          const oracleResult = oracle.check(result);

          if (oracleResult.dosDetected) {
            expect(
              oracleResult.handledGracefully || result.timedOut,
              formatError(
                attack.script,
                result,
                "DOS detected but not handled gracefully",
              ),
            ).toBe(true);
          }

          if (result.error && !result.hitLimit) {
            const isAcceptableError =
              result.error.message.includes("Maximum call stack") ||
              result.error.message.includes("stack") ||
              result.error.message.includes("limit") ||
              result.error.message.includes("exceeded");
            expect(
              isAcceptableError,
              formatError(attack.script, result, "Unacceptable error type"),
            ).toBe(true);
          }
        });
      }
    });

    describe("Arithmetic Attacks", () => {
      for (const attack of ARITHMETIC_ATTACKS) {
        it(`should handle: ${attack.name}`, async () => {
          const result = await runner.run(attack.script);
          expect(
            result.completed,
            formatError(
              attack.script,
              result,
              "Arithmetic attack did not complete",
            ),
          ).toBe(true);
          expect(
            result.timedOut,
            formatError(attack.script, result, "Arithmetic attack timed out"),
          ).toBe(false);
        });
      }
    });
  });

  describe("Grammar-Based Fuzzing", () => {
    it("should handle random bash scripts without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(bashScript, async (script) => {
          trackScript(script);
          const result = await runner.run(script);

          // Should complete or be terminated gracefully
          const handled =
            result.completed || result.timedOut || result.hitLimit;
          expect(
            handled,
            formatError(script, result, "Script not handled"),
          ).toBe(true);
        }),
        createFcOptions(config),
      );
    });

    it("should handle random compound commands", async () => {
      await fc.assert(
        fc.asyncProperty(bashCompound, async (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          trackScript(script);
          const result = await runner.run(script);

          const handled =
            result.completed || result.timedOut || result.hitLimit;
          expect(
            handled,
            formatError(script, result, "Compound command not handled"),
          ).toBe(true);
        }),
        createFcOptions(config),
      );
    });

    it("should handle random arithmetic expressions", async () => {
      await fc.assert(
        fc.asyncProperty(bashArithmetic, async (expr) => {
          const script = `echo $((${expr})) 2>&1 || true`;
          trackScript(script);
          const result = await runner.run(script);

          expect(
            result.completed,
            formatError(
              script,
              result,
              "Arithmetic expression did not complete",
            ),
          ).toBe(true);
          expect(
            result.timedOut,
            formatError(script, result, "Arithmetic expression timed out"),
          ).toBe(false);
        }),
        createFcOptions(config),
      );
    });
  });

  describe("Specific DOS Vectors", () => {
    it("should handle deep arithmetic nesting", async () => {
      for (const depth of [1, 5, 10, 15, 20]) {
        const nested = `${"$((1+".repeat(depth)}1${"))".repeat(depth)}`;
        const script = `echo ${nested}`;
        const result = await runner.run(script);

        const handled = result.completed || result.timedOut || result.hitLimit;
        expect(
          handled,
          formatError(script, result, `Arithmetic depth=${depth} not handled`),
        ).toBe(true);
      }
    });

    it("should handle nested command substitution", async () => {
      for (const depth of [1, 5, 10, 15]) {
        let cmd = "echo 1";
        for (let i = 0; i < depth; i++) {
          cmd = `echo $(${cmd})`;
        }
        const result = await runner.run(cmd);

        expect(
          result.completed || result.hitLimit || result.timedOut,
          formatError(
            cmd,
            result,
            `Command substitution depth=${depth} not handled`,
          ),
        ).toBe(true);
      }
    });

    it("should handle brace expansion", async () => {
      for (const size of [2, 5, 10, 15, 20]) {
        const script = `echo {1..${size}}{1..${size}} | wc -w`;
        const result = await runner.run(script);
        const oracleResult = oracle.check(result);

        if (oracleResult.dosDetected) {
          expect(
            oracleResult.handledGracefully || result.timedOut,
            formatError(
              script,
              result,
              `Brace expansion size=${size} DOS not handled`,
            ),
          ).toBe(true);
        }
      }
    });
  });

  describe("Oracle Validation", () => {
    it("should correctly identify graceful termination", async () => {
      const script = "while :; do :; done";
      const result = await runner.run(script);

      expect(
        oracle.isGracefulTermination(result),
        formatError(script, result, "Should be graceful termination"),
      ).toBe(true);
    });

    it("should correctly identify acceptable time", async () => {
      const script = 'echo "hello"';
      const result = await runner.run(script);

      expect(
        result.completed,
        formatError(script, result, "Simple script did not complete"),
      ).toBe(true);
      expect(
        oracle.isAcceptableTime(result),
        formatError(script, result, "Simple script time not acceptable"),
      ).toBe(true);
    });
  });
});
