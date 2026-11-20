import { afterEach, beforeEach, describe, it } from "vitest";
import {
  cleanupTestDir,
  compareOutputs,
  createTestDir,
  setupFiles,
} from "./fixture-runner.js";

describe("nounset with a whole-word quoted default - GNU Bash Comparison", () => {
  let testDirectory: string;

  beforeEach(async () => {
    testDirectory = await createTestDir();
  });

  afterEach(async () => {
    await cleanupTestDir(testDirectory);
  });

  it("uses the default for a whole-word quoted ${var:-word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_A; echo "${JB_NOUNSET_A:-fallback}"',
    );
  });

  it("uses the default for a whole-word quoted ${var-word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_B; echo "${JB_NOUNSET_B-fallback}"; echo "[${JB_NOUNSET_B-}]"',
    );
  });

  it("assigns and expands a whole-word quoted ${var:=word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_C; echo "${JB_NOUNSET_C:=assigned}"; echo "$JB_NOUNSET_C"',
    );
  });

  it("assigns and expands a whole-word quoted ${var=word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_D; echo "${JB_NOUNSET_D=assigned}"; echo "$JB_NOUNSET_D"',
    );
  });

  it("yields nothing for a whole-word quoted ${var:+word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_E; printf "<%s>\\n" "${JB_NOUNSET_E:+alt}"',
    );
  });

  it("yields nothing for a whole-word quoted ${var+word}", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_F; printf "<%s>\\n" "${JB_NOUNSET_F+alt}"',
    );
  });

  it("keeps honouring set values and the empty/unset distinction", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; JB_NOUNSET_G=value; JB_NOUNSET_H=; echo "${JB_NOUNSET_G:-fallback}"; printf "<%s>\\n" "${JB_NOUNSET_H:-fallback}" "${JB_NOUNSET_H-fallback}" "${JB_NOUNSET_G:+alt}"',
    );
  });

  it("runs the GitHub Actions summary guard both ways", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      [
        "set -euo pipefail",
        "unset GITHUB_STEP_SUMMARY",
        'if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "writing to $GITHUB_STEP_SUMMARY"; else echo "no step summary"; fi',
        "GITHUB_STEP_SUMMARY=summary.md",
        'if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "report" >> "$GITHUB_STEP_SUMMARY"; fi',
        "cat summary.md",
      ].join("\n"),
    );
  });

  it("uses the default for a whole-word quoted array default", async () => {
    const env = await setupFiles(testDirectory, {});
    await compareOutputs(
      env,
      testDirectory,
      'set -u; unset JB_NOUNSET_ARR; echo "${JB_NOUNSET_ARR[@]:-fallback}"; echo "[${JB_NOUNSET_ARR[@]:+alt}]"',
    );
  });
});
