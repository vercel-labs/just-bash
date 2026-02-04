/**
 * Sandbox Escape Fuzzing Tests
 *
 * Property-based tests for detecting sandbox escape vulnerabilities.
 * Uses grammar-based generation for comprehensive syntax exploration.
 */

import fc from "fast-check";
import { afterEach, describe, expect, it } from "vitest";
import { createFcOptions, createFuzzConfig } from "../config.js";
import {
  INJECTION_ATTACKS,
  POLLUTION_ATTACKS,
  SANDBOX_ESCAPES,
} from "../corpus/known-attacks.js";
import {
  bashScript,
  bashStatement,
  pollutionExpansion,
  pollutionScript,
} from "../generators/grammar-generator.js";
import { SandboxOracle } from "../oracles/sandbox-oracle.js";
import type { FuzzResult } from "../runners/fuzz-runner.js";
import { FuzzRunner } from "../runners/fuzz-runner.js";

const numRuns = Number(process.env.FUZZ_RUNS) || 50;
const config = createFuzzConfig({
  numRuns,
  scriptLogFile: "fuzz-sandbox.log",
  failureLogFile: "fuzz-sandbox-failures.log",
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
    result.stdout ? `Stdout: ${result.stdout.slice(0, 500)}` : "",
    result.stderr ? `Stderr: ${result.stderr.slice(0, 200)}` : "",
    result.error ? `Error: ${result.error.message}` : "",
    "=========================",
  ];
  return lines.filter(Boolean).join("\n");
}

describe("Sandbox Escape Fuzzing", () => {
  const runner = new FuzzRunner(config);
  const oracle = new SandboxOracle();

  afterEach((context) => {
    if (context.task.result?.state === "fail" && lastTestedScript) {
      console.error("\n=== LAST TESTED SCRIPT (on failure/timeout) ===");
      console.error(lastTestedScript);
      console.error("================================================\n");
    }
    lastTestedScript = "";
  });

  describe("Known Attack Corpus", () => {
    describe("Sandbox Escapes", () => {
      for (const attack of SANDBOX_ESCAPES) {
        it(`should block: ${attack.name}`, async () => {
          const result = await runner.run(attack.script);
          expect(
            oracle.containsSensitiveData(result.stdout || ""),
            formatError(
              attack.script,
              result,
              "Sensitive data leaked in stdout",
            ),
          ).toBe(false);
        });
      }
    });

    describe("Pollution Attacks", () => {
      for (const attack of POLLUTION_ATTACKS) {
        it(`should handle safely: ${attack.name}`, async () => {
          const result = await runner.run(attack.script);
          expect(
            oracle.containsNativeCode(result.stdout || ""),
            formatError(
              attack.script,
              result,
              "Pollution attack exposed native code in stdout",
            ),
          ).toBe(false);
          expect(
            oracle.containsNativeCode(result.stderr || ""),
            formatError(
              attack.script,
              result,
              "Pollution attack exposed native code in stderr",
            ),
          ).toBe(false);
        });
      }
    });

    describe("Injection Attacks", () => {
      for (const attack of INJECTION_ATTACKS) {
        it(`should handle safely: ${attack.name}`, async () => {
          const result = await runner.run(attack.script);
          expect(
            result.completed,
            formatError(
              attack.script,
              result,
              "Injection attack did not complete",
            ),
          ).toBe(true);
          expect(
            oracle.containsSensitiveData(result.stdout || ""),
            formatError(
              attack.script,
              result,
              "Injection attack leaked sensitive data",
            ),
          ).toBe(false);
        });
      }
    });
  });

  describe("Grammar-Based Fuzzing", () => {
    it("should handle random bash scripts safely", async () => {
      await fc.assert(
        fc.asyncProperty(bashScript, async (script) => {
          trackScript(script);
          const result = await runner.run(script);
          // Random scripts might output shell variables (e.g., from `declare`),
          // which is fine in the sandboxed env. Focus on JS native code exposure.
          expect(
            oracle.containsNativeCode(result.stdout || ""),
            formatError(script, result, "Random script exposed native code"),
          ).toBe(false);
        }),
        createFcOptions(config),
      );
    });

    it("should handle random bash statements safely", async () => {
      await fc.assert(
        fc.asyncProperty(bashStatement, async (stmt) => {
          const script = `${stmt} 2>&1 || true`;
          trackScript(script);
          const result = await runner.run(script);
          // Focus on JS native code exposure, not shell variable output
          expect(
            oracle.containsNativeCode(result.stdout || ""),
            formatError(script, result, "Random statement exposed native code"),
          ).toBe(false);
        }),
        createFcOptions(config),
      );
    });

    it("should handle pollution scripts safely", async () => {
      await fc.assert(
        fc.asyncProperty(pollutionScript, async (script) => {
          trackScript(script);
          const result = await runner.run(script);
          expect(
            oracle.containsNativeCode(result.stdout || ""),
            formatError(script, result, "Pollution script exposed native code"),
          ).toBe(false);
        }),
        createFcOptions(config),
      );
    });

    it("should handle pollution expansions safely", async () => {
      await fc.assert(
        fc.asyncProperty(pollutionExpansion, async (expansion) => {
          const script = `echo ${expansion} 2>&1 || true`;
          trackScript(script);
          const result = await runner.run(script);
          expect(
            oracle.containsNativeCode(result.stdout || ""),
            formatError(
              script,
              result,
              "Pollution expansion exposed native code",
            ),
          ).toBe(false);
        }),
        createFcOptions(config),
      );
    });
  });
});
