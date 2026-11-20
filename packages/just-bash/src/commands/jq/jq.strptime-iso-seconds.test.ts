import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq strptime ISO seconds without a literal timezone", () => {
  it("parses an ISO timestamp with a format that does not contain Z", async () => {
    const result = await new Bash().exec(
      `jq -n '"2026-05-03T22:28:02" | strptime("%Y-%m-%dT%H:%M:%S") | mktime'`,
    );
    expect(result.stdout).toBe("1777847282\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("retains the broken-down date components", async () => {
    const result = await new Bash().exec(
      `jq -cn '"2024-02-29T00:01:02" | strptime("%Y-%m-%dT%H:%M:%S")'`,
    );
    expect(result.stdout).toBe("[2024,1,29,0,1,2,4,59]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
