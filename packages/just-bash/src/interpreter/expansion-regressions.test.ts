import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("arithmetic substitutions and brace ranges", () => {
  it("inherits functions and shell variables without leaking substitution changes", async () => {
    const result = await new Bash().exec(
      'x=2; f() { echo "$x"; }; echo $(( $(f; x=9; f() { echo 8; }; set -f; readonly y=1) + 1 )); f; y=4; echo "$y"; case "$-" in *f*) echo leaked;; esac',
    );
    expect(result).toMatchObject({
      stdout: "3\n2\n4\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("expands ranges beyond 10,000 entries without truncation", async () => {
    const result = await new Bash().exec("printf '%s\\n' {1..20000} | tail -1");
    expect(result).toMatchObject({
      stdout: "20000\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("fails instead of returning a partial range at the configured limit", async () => {
    const result = await new Bash({
      executionLimits: { maxBraceExpansionResults: 3 },
    }).exec("echo {1..4}");
    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: brace expansion result limit exceeded (3)\n",
      exitCode: 126,
    });
  });
});
