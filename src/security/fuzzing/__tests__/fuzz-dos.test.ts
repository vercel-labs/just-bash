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
  awkGrammarCommand,
  awkPollutionCommand,
  bashArithmetic,
  bashCompound,
  bashScript,
  commandPipeline,
  jqGrammarCommand,
  jqPollutionCommand,
  sedGrammarCommand,
  sedPollutionCommand,
  supportedCommand,
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
let lastResult: FuzzResult | null = null;
let lastFailureReason = "";

/**
 * Patterns that indicate execution limits were hit (intended defense behavior).
 */
const EXECUTION_LIMIT_PATTERNS = [
  /too many commands executed/,
  /too many loop iterations/,
  /too many subshells/,
  /too many function calls/,
  /too many variables/,
  /executionLimits/,
];

function hitExecutionLimit(result: FuzzResult): boolean {
  const stderr = result.stderr || "";
  return (
    result.hitLimit || EXECUTION_LIMIT_PATTERNS.some((p) => p.test(stderr))
  );
}

function trackScript(script: string): string {
  lastTestedScript = script;
  return script;
}

function trackResult(result: FuzzResult, failureReason: string): void {
  lastResult = result;
  lastFailureReason = failureReason;
}

function formatError(context: string): string {
  // Keep error messages short - detailed info is in afterEach output
  return `DOS check failed: ${context}`;
}

describe("DOS Detection Fuzzing", () => {
  const runner = new FuzzRunner(config);
  const oracle = new DOSOracle(config);

  // Helper to log failure immediately to file (append-only)
  function logFailure(result: FuzzResult, reason: string): void {
    runner.logFailure(result, reason);
  }

  afterEach((context) => {
    if (context.task.result?.state === "fail") {
      console.error("\n\n########## DOS FUZZ FAILURE ##########");
      console.error(`Script: ${lastTestedScript || "(no script tracked)"}`);
      console.error(`Reason: ${lastFailureReason || "(no reason tracked)"}`);
      if (lastResult) {
        console.error(
          `Result: completed=${lastResult.completed}, timedOut=${lastResult.timedOut}, hitLimit=${lastResult.hitLimit}, exitCode=${lastResult.exitCode}`,
        );
        if (lastResult.stdout) {
          console.error(`Stdout: ${lastResult.stdout.slice(0, 200)}`);
        }
        if (lastResult.stderr) {
          console.error(`Stderr: ${lastResult.stderr.slice(0, 200)}`);
        }
        // Only log REAL failures to file (skip false positives and execution limit hits)
        const isFalsePositive = lastFailureReason?.startsWith("PASSED:");
        const isLimitHit = hitExecutionLimit(lastResult);
        if (!isFalsePositive && !isLimitHit) {
          logFailure(lastResult, lastFailureReason || "Unknown failure");
        }
      } else {
        console.error("Result: (no result tracked)");
      }
      console.error("##########################################\n\n");
    }
    lastTestedScript = "";
    lastResult = null;
    lastFailureReason = "";
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
              formatError("DOS detected but not handled gracefully"),
            ).toBe(true);
          }

          if (result.error && !hitExecutionLimit(result)) {
            const isAcceptableError =
              result.error.message.includes("Maximum call stack") ||
              result.error.message.includes("stack") ||
              result.error.message.includes("limit") ||
              result.error.message.includes("exceeded");
            expect(
              isAcceptableError,
              formatError("Unacceptable error type"),
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
            formatError("Arithmetic attack did not complete"),
          ).toBe(true);
          expect(
            result.timedOut,
            formatError("Arithmetic attack timed out"),
          ).toBe(false);
        });
      }
    });
  });

  describe("Grammar-Based Fuzzing", () => {
    it("should handle random bash scripts without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(bashScript, (script) => {
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, ""); // Always track result

            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason =
                "Script not handled (neither completed, timed out, nor hit limit)";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle random compound commands", async () => {
      await fc.assert(
        fc.asyncProperty(bashCompound, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");

            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason = "Compound command not handled";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle random arithmetic expressions", async () => {
      await fc.assert(
        fc.asyncProperty(bashArithmetic, (expr) => {
          const script = `echo $((${expr})) 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");

            if (!result.completed) {
              const reason = "Arithmetic expression did not complete";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            if (result.timedOut) {
              const reason = "Arithmetic expression timed out";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle supported commands without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(supportedCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");

            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason = "Command not handled";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle command pipelines without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(commandPipeline, (pipeline) => {
          const script = `${pipeline} 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");
            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason = "Pipeline not handled";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle AWK grammar without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(awkGrammarCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");
            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason = "AWK command not handled";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle SED grammar without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(sedGrammarCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");
            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason = "SED command not handled";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle JQ grammar without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(jqGrammarCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");
            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason = "JQ command not handled";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle AWK pollution commands without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(awkPollutionCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");
            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason = "AWK pollution command not handled";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle SED pollution commands without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(sedPollutionCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");
            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason = "SED pollution command not handled";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
        }),
        createFcOptions(config),
      );
    });

    it("should handle JQ pollution commands without hanging", async () => {
      await fc.assert(
        fc.asyncProperty(jqPollutionCommand, (cmd) => {
          const script = `${cmd} 2>&1 || true`;
          trackScript(script);
          return runner.run(script).then((result) => {
            trackResult(result, "");
            const handled =
              result.completed || result.timedOut || hitExecutionLimit(result);
            if (!handled) {
              const reason = "JQ pollution command not handled";
              lastFailureReason = reason;
              logFailure(result, reason);
              return false;
            }
            lastFailureReason = "PASSED: All DOS checks passed";
            return true;
          });
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

        const handled =
          result.completed || result.timedOut || hitExecutionLimit(result);
        expect(
          handled,
          formatError(`Arithmetic depth=${depth} not handled`),
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
          formatError(`Command substitution depth=${depth} not handled`),
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
            formatError(`Brace expansion size=${size} DOS not handled`),
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
        formatError("Should be graceful termination"),
      ).toBe(true);
    });

    it("should correctly identify acceptable time", async () => {
      const script = 'echo "hello"';
      const result = await runner.run(script);

      expect(
        result.completed,
        formatError("Simple script did not complete"),
      ).toBe(true);
      expect(
        oracle.isAcceptableTime(result),
        formatError("Simple script time not acceptable"),
      ).toBe(true);
    });
  });
});
