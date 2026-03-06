import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { DefenseInDepthBox } from "../defense-in-depth-box.js";
import { assertExecResultSafe } from "../fuzzing/oracles/assertions.js";
import type { SecurityViolation } from "../types.js";

const fixturesDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "exploit-fixtures",
);

function loadFixture(name: string): string {
  return readFileSync(join(fixturesDir, name), "utf8");
}

async function runAttackWithAndWithoutDefense(options: {
  fixture: string;
  python?: boolean;
}): Promise<{
  baseline: Awaited<ReturnType<Bash["exec"]>>;
  withDefense: Awaited<ReturnType<Bash["exec"]>>;
  violations: SecurityViolation[];
}> {
  const script = loadFixture(options.fixture);

  const baselineEnv = new Bash({
    python: options.python,
    defenseInDepth: false,
  });
  const baseline = await baselineEnv.exec(script);

  DefenseInDepthBox.resetInstance();
  const violations: SecurityViolation[] = [];
  const defenseEnv = new Bash({
    python: options.python,
    defenseInDepth: {
      enabled: true,
      onViolation: (violation) => violations.push(violation),
    },
  });
  const withDefense = await defenseEnv.exec(script);
  DefenseInDepthBox.resetInstance();

  return { baseline, withDefense, violations };
}

describe("Defense-in-depth independence evidence for exploit probes", () => {
  it("awk exploit probes are contained without defense and do not trigger defense violations", async () => {
    const { baseline, withDefense, violations } =
      await runAttackWithAndWithoutDefense({
        fixture: "awk-system-sinks.sh",
      });

    expect(withDefense).toEqual(baseline);
    expect(violations).toEqual([]);
    assertExecResultSafe(baseline);
    assertExecResultSafe(withDefense);
  });

  it("jq/yq exploit probes are contained with and without defense", async () => {
    const { baseline, withDefense } = await runAttackWithAndWithoutDefense({
      fixture: "query-engine-constructor-chain.sh",
    });

    // With pre-captured timers and process.env allowed keys, defense no
    // longer diverges for yq — the query engine's internal env var reads
    // (LOG_TOKENS, LOG_STREAM) go through the allow-list.
    expect(withDefense).toEqual(baseline);
    assertExecResultSafe(baseline);
    assertExecResultSafe(withDefense);
  });

  it("sqlite exploit probes are contained with and without defense", async () => {
    const { baseline, withDefense } = await runAttackWithAndWithoutDefense({
      fixture: "sqlite-load-extension.sh",
    });

    // With pre-captured timers (_setTimeout/_clearTimeout), the sqlite
    // worker timeout path no longer triggers defense violations.
    expect(baseline.stdout).toContain("SQLITE_LOAD_EXTENSION_BLOCKED");
    expect(withDefense).toEqual(baseline);
    assertExecResultSafe(baseline);
    assertExecResultSafe(withDefense);
  });

  it("python exploit probes are contained with and without defense", async () => {
    const { baseline, withDefense } = await runAttackWithAndWithoutDefense({
      fixture: "python-worker-escape.sh",
      python: true,
    });

    // With pre-captured _SharedArrayBuffer and _Atomics in the protocol
    // module, the python worker no longer triggers defense violations.
    expect(baseline.stdout).toContain("PYTHON_MARKER_ABSENT");
    expect(withDefense).toEqual(baseline);
    assertExecResultSafe(baseline);
    assertExecResultSafe(withDefense);
  });
});
