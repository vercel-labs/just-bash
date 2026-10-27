import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq attached indent arguments", () => {
  it.each([
    "-I=0",
    "-I0",
    "-I 0",
    "--indent=0",
  ])("accepts %s", async (option) => {
    const result = await new Bash().exec(
      `printf '{"value":7}' | yq -p json -o json ${option} '.'`,
    );
    expect(result.stdout).toBe('{"value":7}\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("applies an attached nonzero indent", async () => {
    const result = await new Bash().exec(
      `printf '{"value":7}' | yq -p json -o json -I=4 '.'`,
    );
    expect(result.stdout).toBe('{\n    "value": 7\n}\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps validation for invalid attached indent values", async () => {
    const result = await new Bash().exec("yq -n -I=1.5 '.'");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "yq: invalid indent '1.5' (expected integer 0..32)\n",
    );
    expect(result.exitCode).toBe(2);
  });
});
