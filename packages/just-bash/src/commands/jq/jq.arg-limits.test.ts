import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const DEEP = `${"[".repeat(1500)}${"]".repeat(1500)}`;

describe("jq JSON-valued arguments over a limit", () => {
  it.each([
    ["--argjson", `jq -n --argjson x '${DEEP}' 1`],
    ["--jsonargs", `jq -n --jsonargs 1 '${DEEP}'`],
    [
      "--slurpfile",
      `printf '%s' '${DEEP}' > d.json && jq -n --slurpfile x d.json 1`,
    ],
  ])("reports %s over the depth limit as the limit, as for an input", async (_option, command) => {
    const env = new Bash();
    const result = await env.exec(command);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("jq: query depth limit exceeded (1000)\n");
    expect(result.exitCode).toBe(126);
  });

  it("reports a --slurpfile file over the element limit as the limit", async () => {
    const env = new Bash({ executionLimits: { maxQueryElements: 3 } });
    const result = await env.exec(
      "printf '[1,2,3,4,5]' > e.json && jq -n --slurpfile x e.json 1",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("jq: query input element limit exceeded (3)\n");
    expect(result.exitCode).toBe(126);
  });
});
