import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { ExecutionLimitError } from "../interpreter/errors.js";

// These commands must propagate execution limits instead of returning statuses
// that a later pipeline stage or `||` could hide.
describe("execution limits caught by a command", () => {
  const records = "one\ntwo\nthree\n";

  it.each([
    [
      "awk",
      "awk '{ print }' /in",
      { maxAwkIterations: 2 },
      "awk: record limit exceeded (2)\n",
      "",
    ],
    [
      "sed",
      "sed ':a;N;$!ba;s/\\n/ /g' /in",
      { maxSedIterations: 2 },
      "sed: sed: command execution exceeded maximum iterations (2)\n",
      "",
    ],
    [
      "jq",
      "jq -n '[range(5)]'",
      { maxQueryElements: 2 },
      "jq: query result element limit exceeded (2)\n",
      "",
    ],
    [
      "yq",
      "yq -n '[1, 2, 3, 4, 5]'",
      { maxQueryElements: 2 },
      "yq: query result element limit exceeded (2)\n",
      "",
    ],
  ])("%s ends the script from inside a pipeline", async (_name, command, limits, stderr, stdout) => {
    const bash = new Bash({
      files: { "/in": records },
      executionLimits: limits,
    });
    const result = await bash.exec(`${command} | wc -l; echo after`);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe(stderr);
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("preserves earlier output but discards AWK's partial output", async () => {
    const bash = new Bash({
      files: { "/in": records },
      executionLimits: { maxAwkIterations: 2 },
    });
    const result = await bash.exec(
      "printf 'before\\n'; awk '{ print }' /in | wc -l; echo after",
    );
    expect(result.stdout).toBe("before\n");
    expect(result.stderr).toBe("awk: record limit exceeded (2)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("does not expose AWK output beyond the output limit", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 10 } });
    const result = await bash.exec(
      `awk 'BEGIN { print "12345678901234567890" }' | wc -l; echo after`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "awk: awk: output size limit exceeded (10 bytes)\n",
    );
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it.each([
    [
      "tokens",
      ". | .",
      { maxQueryTokens: 4 },
      "query token limit exceeded (4)",
    ],
    [
      "depth",
      "(((.)))",
      { maxQueryDepth: 2 },
      "query parse depth limit exceeded (2)",
    ],
  ])("does not mask the jq parser %s limit in a pipeline", async (_name, filter, limits, message) => {
    const bash = new Bash({ executionLimits: limits });
    const result = await bash.exec(`jq -n '${filter}' | wc -l; echo after`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`jq: ${message}\n`);
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("preserves a shell loop's partial output in a pipeline", async () => {
    const bash = new Bash({ executionLimits: { maxLoopIterations: 2 } });
    const result = await bash.exec(
      'for i in one two three; do echo "$i"; done | wc -l; echo after',
    );
    expect(result.stdout).toBe("one\ntwo\n");
    expect(result.stderr).toContain("too many iterations (2)");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("does not let || recover from the limit", async () => {
    const bash = new Bash({
      files: { "/in": records },
      executionLimits: { maxAwkIterations: 2 },
    });
    const result = await bash.exec("awk '{ print }' /in || echo recovered");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("awk: record limit exceeded (2)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });
});
