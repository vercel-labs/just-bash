import { beforeAll, describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

function makeRows(count: number): string {
  const rows: string[] = [];
  for (let index = 0; index < count; index++) {
    rows.push(
      JSON.stringify({ id: index, name: `name-${index}`, value: index * 3 }),
    );
  }
  return rows.join("\n");
}

const ROWS = makeRows(99000);

function bashWithDeadline(maxExecutionTimeMs: number): Bash {
  return new Bash({
    files: { "/work/rows.jsonl": ROWS },
    cwd: "/work",
    executionLimits: { maxExecutionTimeMs },
  });
}

describe("execution deadline inside data-command row loops", () => {
  it.each([
    ["grep", `grep -c 'name-1' /work/rows.jsonl`],
    ["jq", `jq -s 'map(.value) | add' /work/rows.jsonl`],
    [
      "awk",
      `awk '{ total += length($0) } END { print total }' /work/rows.jsonl`,
    ],
    ["sed", `sed 's/name/NAME/g' /work/rows.jsonl`],
  ])(
    "stops %s once the deadline passes",
    async (_name, script) => {
      const started = Date.now();
      const result = await bashWithDeadline(25).exec(script);
      const elapsed = Date.now() - started;

      expect(result.exitCode).toBe(124);
      expect(result.stderr).toContain("execution deadline");
      expect(elapsed).toBeLessThan(2000);
    },
    60000,
  );

  it.each([
    ["grep", `grep -c 'name-1' /work/rows.jsonl`],
    ["jq", `jq -s 'map(.value) | add' /work/rows.jsonl`],
    [
      "awk",
      `awk '{ total += length($0) } END { print total }' /work/rows.jsonl`,
    ],
    ["sed", `sed 's/name/NAME/g' /work/rows.jsonl`],
  ])(
    "leaves %s unaffected when the deadline is generous",
    async (_name, script) => {
      const result = await bashWithDeadline(600000).exec(script);

      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    },
    60000,
  );

  // No input file: loading ROWS alone can outlast a 25ms deadline, which would
  // trip the statement-level check before evaluation starts.
  const HEAVY_REDUCE = `reduce range(0; 300000) as $i (0; . + ($i | tostring | length))`;
  const queryBash = () =>
    new Bash({ executionLimits: { maxExecutionTimeMs: 25 } });

  // Cold module loading alone can spend the 25ms before evaluation starts.
  beforeAll(async () => {
    await new Bash().exec("jq -n 1; yq -n 1");
  });

  it.each([
    ["jq", `jq -n '${HEAVY_REDUCE}'`],
    ["yq", `yq -n '${HEAVY_REDUCE}'`],
  ])(
    "stops %s query evaluation once the deadline passes",
    async (_name, script) => {
      const result = await queryBash().exec(script);

      expect(result.exitCode).toBe(124);
      expect(result.stderr).toContain(
        "query evaluation exceeded execution deadline",
      );
    },
    60000,
  );

  it.each([
    ["try/catch", `jq -n 'try (${HEAVY_REDUCE}) catch "swallowed"'`],
    ["?", `jq -n '(${HEAVY_REDUCE})?'`],
  ])(
    "does not let jq %s suppress the deadline",
    async (_name, script) => {
      const result = await queryBash().exec(script);

      expect(result.exitCode).toBe(124);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "query evaluation exceeded execution deadline",
      );
    },
    60000,
  );
});
