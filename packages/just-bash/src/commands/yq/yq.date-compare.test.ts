import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// TOML dates are Date objects with no own keys; they must compare by value.
const TOML = [
  "a = 1979-05-27T07:32:00Z",
  "b = 2001-01-01T00:00:00Z",
  "c = 1979-05-27T07:32:00Z",
  "",
].join("\n");

describe("yq comparing TOML dates", () => {
  it.each([
    [".a == .b", "false"],
    [".a == .c", "true"],
    ["[.a, .b, .a] | unique | length", "2"],
    ["[.a, .b] - [.a] | length", "1"],
  ])("%s", async (filter, expected) => {
    const env = new Bash({ files: { "/d.toml": TOML } });
    const result = await env.exec(`yq -p toml -o json '${filter}' /d.toml`);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
