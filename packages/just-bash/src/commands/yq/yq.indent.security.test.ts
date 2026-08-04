import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq indent validation", () => {
  it.each([
    "-1",
    "1.5",
    "Infinity",
    "33",
    "999999999999999999999",
  ])("rejects unsafe indent %s before formatting", async (indent) => {
    const result = await new Bash().exec(
      `printf 'a: 1\\n' | yq -o xml --indent='${indent}' '.'`,
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("invalid indent");
    expect(result.stdout).toBe("");
  });

  it("accepts the upper bound", async () => {
    const result = await new Bash().exec(
      `printf 'a: 1\\n' | yq -o json --indent=32 '.'`,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });
});
