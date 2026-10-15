import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { ExecutionLimitError } from "../interpreter/errors.js";

// A command that catches its own execution limit must still end the script,
// as every other command's limit does. Returned as an ordinary exit status, a
// later pipeline stage or an `||` turns the partial result into a success.
describe("execution limits caught by a command", () => {
  const records = "one\ntwo\nthree\n";

  it.each([
    [
      "awk",
      "awk '{ print }' /in",
      { maxAwkIterations: 2 },
      "awk: record limit exceeded (2)\n",
    ],
    [
      "sed",
      "sed ':a;N;$!ba;s/\\n/ /g' /in",
      { maxSedIterations: 2 },
      "sed: sed: command execution exceeded maximum iterations (2)\n",
    ],
    [
      "jq",
      "jq -n '[range(5)]'",
      { maxQueryElements: 2 },
      "jq: query result element limit exceeded (2)\n",
    ],
    [
      "yq",
      "yq -n '[1, 2, 3, 4, 5]'",
      { maxQueryElements: 2 },
      "yq: query result element limit exceeded (2)\n",
    ],
  ])("%s ends the script from inside a pipeline", async (_name, command, limits, stderr) => {
    const bash = new Bash({
      files: { "/in": records },
      executionLimits: limits,
    });
    const result = await bash.exec(`${command} | wc -l; echo after`);
    expect(result.stdout).not.toContain("after");
    expect(result.stderr).toBe(stderr);
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });

  it("does not let || recover from the limit", async () => {
    const bash = new Bash({
      files: { "/in": records },
      executionLimits: { maxAwkIterations: 2 },
    });
    const result = await bash.exec("awk '{ print }' /in || echo recovered");
    expect(result.stdout).toBe("one\ntwo\n");
    expect(result.stderr).toBe("awk: record limit exceeded (2)\n");
    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
  });
});
