import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq path compatibility", () => {
  it.each([
    ["path(.a | numbers)", '[\n  "a"\n]\n'],
    ["pick(objects)", '{\n  "a": 1\n}\n'],
  ])("preserves %s", async (filter, output) => {
    const env = new Bash({ files: { "/input.yaml": "a: 1\n" } });
    const result = await env.exec(`yq -o json '${filter}' /input.yaml`);
    expect(result.stdout).toBe(output);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
