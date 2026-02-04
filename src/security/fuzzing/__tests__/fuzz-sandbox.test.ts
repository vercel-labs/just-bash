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
  awkGrammarCommand,
  awkPollutionCommand,
  bashScript,
  bashStatement,
  commandPipeline,
  jqGrammarCommand,
  jqPollutionCommand,
  pollutionExpansion,
  pollutionScript,
  sedGrammarCommand,
  sedPollutionCommand,
  supportedCommand,
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
let lastResult: FuzzResult | null = null;
let lastFailureReason = "";
// Track the first failure (fast-check shrinking can overwrite with passing scripts)
let firstFailedScript = "";
let firstFailureReason = "";
let firstFailedResult: FuzzResult | null = null;

/**
 * Patterns that indicate execution limits were hit (intended defense behavior).
 * These should NOT be treated as security failures.
 */
const EXECUTION_LIMIT_PATTERNS = [
  /too many commands executed/,
  /too many loop iterations/,
  /too many subshells/,
  /too many function calls/,
  /too many variables/,
  /executionLimits/,
];

function isExecutionLimitError(output: string): boolean {
  return EXECUTION_LIMIT_PATTERNS.some((p) => p.test(output));
}

function trackScript(script: string): string {
  lastTestedScript = script;
  return script;
}

function formatError(context: string): string {
  // Keep error messages short - detailed info is in afterEach output
  return `Security check failed: ${context}`;
}

describe("Sandbox Escape Fuzzing", () => {
  const runner = new FuzzRunner(config);
  const oracle = new SandboxOracle();

  function checkNoNativeCode(
    result: FuzzResult,
    script: string,
    context: string,
  ): void {
    lastResult = result;

    // Execution limits being hit is intended defense behavior, not a failure
    const stderr = result.stderr || "";
    if (isExecutionLimitError(stderr)) {
      lastFailureReason = ""; // Clear - this is expected
      return; // Pass - defense worked as intended
    }

    const stdout = result.stdout || "";
    const stdoutHasNative = oracle.containsNativeCode(stdout);
    const stderrHasNative = oracle.containsNativeCode(stderr);

    if (stdoutHasNative) {
      lastFailureReason = `NATIVE CODE in stdout: ${stdout.slice(0, 300)}`;
      // Capture first failure before expect fails
      if (!firstFailedScript) {
        firstFailedScript = script;
        firstFailureReason = lastFailureReason;
        firstFailedResult = result;
      }
      // Log failure immediately to file (append-only)
      runner.logFailure(result, lastFailureReason);
      expect(false, formatError(`${context} - stdout has native code`)).toBe(
        true,
      );
    }

    if (stderrHasNative) {
      lastFailureReason = `NATIVE CODE in stderr: ${stderr.slice(0, 300)}`;
      // Capture first failure before expect fails
      if (!firstFailedScript) {
        firstFailedScript = script;
        firstFailureReason = lastFailureReason;
        firstFailedResult = result;
      }
      // Log failure immediately to file (append-only)
      runner.logFailure(result, lastFailureReason);
      expect(false, formatError(`${context} - stderr has native code`)).toBe(
        true,
      );
    }

    // All checks passed
    lastFailureReason = "";
  }

  async function runAndCheck(script: string, context: string): Promise<true> {
    trackScript(script);
    lastFailureReason = "Script execution in progress...";
    lastResult = null;

    try {
      const result = await runner.run(script);
      lastResult = result;

      // Execution limits being hit (with error) is expected defense behavior
      if (isExecutionLimitError(result.stderr || "")) {
        lastFailureReason = "PASSED: Execution limit hit (expected defense)";
        return true;
      }

      // Timeouts are NOT expected - they indicate the defense didn't work
      if (result.timedOut) {
        lastFailureReason = `TIMEOUT: Script took too long (>${config.timeoutMs}ms). Defense limits should have stopped it sooner.`;
        // Capture first failure before throwing
        if (!firstFailedScript) {
          firstFailedScript = script;
          firstFailureReason = lastFailureReason;
          firstFailedResult = result;
        }
        // Log failure immediately to file (append-only)
        runner.logFailure(result, lastFailureReason);
        throw new Error(lastFailureReason);
      }

      lastFailureReason = "Checking for native code...";
      checkNoNativeCode(result, script, context);
      // Track that we passed all checks (helps debug false positives)
      lastFailureReason = "PASSED: All security checks passed";
      // Debug: confirm we're returning true
      // console.log("runAndCheck returning true for:", script.slice(0, 50));
      return true; // Explicit return for fast-check
    } catch (e) {
      const err = e as Error;
      if (
        !lastFailureReason.startsWith("TIMEOUT:") &&
        !lastFailureReason.startsWith("NATIVE CODE")
      ) {
        lastFailureReason = `Exception: ${err.message}\n${err.stack?.slice(0, 500) || ""}`;
      }
      // Capture first failure (fast-check shrinking may overwrite with passing scripts)
      if (!firstFailedScript) {
        firstFailedScript = script;
        firstFailureReason = lastFailureReason;
        firstFailedResult = lastResult;
      }
      // Log failure immediately to file (append-only)
      if (lastResult) {
        runner.logFailure(lastResult, lastFailureReason);
      }
      throw e;
    }
  }

  afterEach((context) => {
    if (context.task.result?.state === "fail") {
      // Prefer first failure info (fast-check shrinking can overwrite with passing scripts)
      const failedScript = firstFailedScript || lastTestedScript;
      const failureReason = firstFailureReason || lastFailureReason;
      const failedResult = firstFailedResult || lastResult;

      // Use a distinctive header so we can tell this is from afterEach
      console.error("\n\n########## FUZZ FAILURE DETAILS ##########");
      console.error(`Script: ${failedScript || "(no script tracked)"}`);
      console.error(`Reason: ${failureReason || "(no reason tracked)"}`);
      if (failedResult) {
        console.error(
          `Result: completed=${failedResult.completed}, timedOut=${failedResult.timedOut}, exitCode=${failedResult.exitCode}`,
        );
        if (failedResult.stdout)
          console.error(`Stdout: ${failedResult.stdout.slice(0, 200)}`);
        if (failedResult.stderr)
          console.error(`Stderr: ${failedResult.stderr.slice(0, 200)}`);
        // Only log REAL failures to file (skip false positives and execution limit hits)
        const isFalsePositive = failureReason?.startsWith("PASSED:");
        const isLimitHit = isExecutionLimitError(failedResult.stderr || "");
        if (!isFalsePositive && !isLimitHit) {
          runner.logFailure(failedResult, failureReason || "Unknown failure");
        }
      } else {
        console.error("Result: (no result tracked)");
      }
      console.error("##########################################\n\n");
    }
    // Reset all tracking for next test
    lastTestedScript = "";
    lastResult = null;
    lastFailureReason = "";
    firstFailedScript = "";
    firstFailureReason = "";
    firstFailedResult = null;
  });

  describe("Known Attack Corpus", () => {
    describe("Sandbox Escapes", () => {
      for (const attack of SANDBOX_ESCAPES) {
        it(`should block: ${attack.name}`, async () => {
          const result = await runner.run(attack.script);
          expect(
            oracle.containsSensitiveData(result.stdout || ""),
            formatError("Sensitive data leaked in stdout"),
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
            formatError("Pollution attack exposed native code in stdout"),
          ).toBe(false);
          expect(
            oracle.containsNativeCode(result.stderr || ""),
            formatError("Pollution attack exposed native code in stderr"),
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
            formatError("Injection attack did not complete"),
          ).toBe(true);
          expect(
            oracle.containsSensitiveData(result.stdout || ""),
            formatError("Injection attack leaked sensitive data"),
          ).toBe(false);
        });
      }
    });
  });

  describe("Grammar-Based Fuzzing", () => {
    it("should handle random bash scripts safely", async () => {
      await fc.assert(
        fc.asyncProperty(bashScript, (script) =>
          runAndCheck(script, "Random script exposed native code"),
        ),
        createFcOptions(config),
      );
    });

    it("should handle random bash statements safely", async () => {
      await fc.assert(
        fc.asyncProperty(bashStatement, (stmt) => {
          const script = `${stmt} 2>&1 || true`;
          return runAndCheck(script, "Random statement exposed native code");
        }),
        createFcOptions(config),
      );
    });

    it("should handle pollution scripts safely", async () => {
      await fc.assert(
        fc.asyncProperty(pollutionScript, (script) =>
          runAndCheck(script, "Pollution script exposed native code"),
        ),
        createFcOptions(config),
      );
    });

    it("should handle pollution expansions safely", async () => {
      await fc.assert(
        fc.asyncProperty(pollutionExpansion, (expansion) => {
          const script = `echo ${expansion} 2>&1 || true`;
          return runAndCheck(script, "Pollution expansion exposed native code");
        }),
        createFcOptions(config),
      );
    });

    it("should handle supported commands safely", async () => {
      await fc.assert(
        fc.asyncProperty(supportedCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          return runAndCheck(script, "Command exposed native code");
        }),
        createFcOptions(config),
      );
    });

    it("should handle command pipelines safely", async () => {
      await fc.assert(
        fc.asyncProperty(commandPipeline, (pipeline) => {
          const script = `${pipeline} 2>&1 || true`;
          return runAndCheck(script, "Pipeline exposed native code");
        }),
        createFcOptions(config),
      );
    });

    it("should handle AWK grammar safely", async () => {
      await fc.assert(
        fc.asyncProperty(awkGrammarCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          return runAndCheck(script, "AWK command exposed native code");
        }),
        createFcOptions(config),
      );
    });

    it("should handle SED grammar safely", async () => {
      await fc.assert(
        fc.asyncProperty(sedGrammarCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          return runAndCheck(script, "SED command exposed native code");
        }),
        createFcOptions(config),
      );
    });

    it("should handle JQ grammar safely", async () => {
      await fc.assert(
        fc.asyncProperty(jqGrammarCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          return runAndCheck(script, "JQ command exposed native code");
        }),
        createFcOptions(config),
      );
    });

    it("should handle AWK pollution commands safely", async () => {
      await fc.assert(
        fc.asyncProperty(awkPollutionCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          return runAndCheck(
            script,
            "AWK pollution command exposed native code",
          );
        }),
        createFcOptions(config),
      );
    });

    it("should handle SED pollution commands safely", async () => {
      await fc.assert(
        fc.asyncProperty(sedPollutionCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          return runAndCheck(
            script,
            "SED pollution command exposed native code",
          );
        }),
        createFcOptions(config),
      );
    });

    it("should handle JQ pollution commands safely", async () => {
      await fc.assert(
        fc.asyncProperty(jqPollutionCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          return runAndCheck(
            script,
            "JQ pollution command exposed native code",
          );
        }),
        createFcOptions(config),
      );
    });
  });
});
