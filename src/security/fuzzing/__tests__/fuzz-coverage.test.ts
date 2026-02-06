/**
 * Coverage-Guided Fuzzing Tests
 *
 * Runs grammar-based scripts with feature coverage tracking enabled.
 * Reports which interpreter features are exercised and identifies gaps.
 */

import fc from "fast-check";
import { afterAll, describe, expect, it } from "vitest";
import { createFcOptions, createFuzzConfig } from "../config.js";
import { CoverageTracker } from "../coverage/coverage-tracker.js";
import { coverageBoost } from "../generators/coverage-boost-generator.js";
import {
  flagBatchCommand,
  flagDrivenCommand,
} from "../generators/flag-driven-generator.js";
import {
  awkGrammarCommand,
  bashArithmetic,
  bashCompound,
  bashScript,
  commandPipeline,
  jqGrammarCommand,
  sedGrammarCommand,
  supportedCommand,
} from "../generators/grammar-generator.js";
import { FuzzRunner } from "../runners/fuzz-runner.js";

const numRuns = Number(process.env.FUZZ_RUNS) || 50;
// Scale vitest timeout: ~5ms per run + generous baseline
const testTimeout = Math.max(10_000, numRuns * 5 + 5000);
const config = createFuzzConfig({
  numRuns,
  timeoutMs: 2000,
  enableCoverage: true,
});

describe("Coverage-Guided Fuzzing", () => {
  const runner = new FuzzRunner(config);
  const tracker = new CoverageTracker();

  async function runWithCoverage(
    arb: fc.Arbitrary<string>,
    label: string,
  ): Promise<void> {
    await fc.assert(
      fc.asyncProperty(arb, async (script) => {
        const result = await runner.run(script);
        if (result.coverage) {
          const newFeatures = tracker.recordRun(result.coverage, script);
          if (newFeatures.length > 0 && config.verbose) {
            console.log(`[${label}] New features: ${newFeatures.join(", ")}`);
          }
        }
        // Script should complete or hit a limit - never crash
        expect(result.completed || result.timedOut || result.hitLimit).toBe(
          true,
        );
      }),
      createFcOptions(config),
    );
  }

  it(
    "tracks bash script coverage",
    async () => {
      await runWithCoverage(bashScript, "bashScript");
    },
    testTimeout,
  );

  it(
    "tracks compound command coverage",
    async () => {
      await runWithCoverage(bashCompound, "bashCompound");
    },
    testTimeout,
  );

  it(
    "tracks arithmetic coverage",
    async () => {
      await runWithCoverage(bashArithmetic, "bashArithmetic");
    },
    testTimeout,
  );

  it(
    "tracks supported command coverage",
    async () => {
      await runWithCoverage(supportedCommand, "supportedCommand");
    },
    testTimeout,
  );

  it(
    "tracks command pipeline coverage",
    async () => {
      await runWithCoverage(commandPipeline, "commandPipeline");
    },
    testTimeout,
  );

  it(
    "tracks AWK coverage",
    async () => {
      await runWithCoverage(awkGrammarCommand, "awkGrammar");
    },
    testTimeout,
  );

  it(
    "tracks SED coverage",
    async () => {
      await runWithCoverage(sedGrammarCommand, "sedGrammar");
    },
    testTimeout,
  );

  it(
    "tracks JQ coverage",
    async () => {
      await runWithCoverage(jqGrammarCommand, "jqGrammar");
    },
    testTimeout,
  );

  it(
    "tracks coverage-boost features",
    async () => {
      await runWithCoverage(coverageBoost, "coverageBoost");
    },
    testTimeout,
  );

  it(
    "tracks flag-driven command coverage",
    async () => {
      await runWithCoverage(flagDrivenCommand, "flagDriven");
    },
    testTimeout,
  );

  it(
    "tracks flag batch coverage",
    async () => {
      await runWithCoverage(flagBatchCommand, "flagBatch");
    },
    testTimeout,
  );

  afterAll(() => {
    const report = tracker.report();

    console.log("\n=== Coverage Report ===");
    console.log(
      `Total: ${report.totalCovered}/${report.totalKnown} (${report.totalPercent.toFixed(1)}%)`,
    );
    console.log("");

    for (const cat of report.categories) {
      const bar = cat.percent >= 80 ? "OK" : cat.percent >= 50 ? "WARN" : "LOW";
      console.log(
        `  ${cat.category}: ${cat.covered}/${cat.total} (${cat.percent.toFixed(0)}%) [${bar}]`,
      );
      if (cat.uncovered.length > 0 && cat.uncovered.length <= 10) {
        console.log(`    uncovered: ${cat.uncovered.join(", ")}`);
      }
    }

    console.log(`\nCorpus entries: ${report.corpus.length}`);
    console.log("======================\n");

    // Soft assertion: bash command coverage should be reasonable
    const bashCmdCat = report.categories.find((c) => c.category === "bash:cmd");
    if (bashCmdCat) {
      expect(bashCmdCat.percent).toBeGreaterThanOrEqual(30);
    }

    // Soft assertion: at least some builtin coverage
    const builtinCat = report.categories.find(
      (c) => c.category === "bash:builtin",
    );
    if (builtinCat) {
      expect(builtinCat.covered).toBeGreaterThan(0);
    }
  });
});
