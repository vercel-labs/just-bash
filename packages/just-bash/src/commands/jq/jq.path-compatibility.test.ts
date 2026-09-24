import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq existing path filters", () => {
  it.each([
    ["path(objects)", "[]\n"],
    ["pick(if true then . else empty end)", '{"a":1}\n'],
    [
      "try pick(.a.b | select(. == null)) catch .",
      '"Cannot index number with string \\"b\\""\n',
    ],
  ])("preserves %s", async (filter, stdout) => {
    const env = new Bash({ files: { "/input.json": '{"a":1}' } });
    const result = await env.exec(`jq -c '${filter}' /input.json`);
    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reads prototype-related own argument keys without accessing the prototype", async () => {
    const env = new Bash();
    const result = await env.exec(
      `jq -nc --arg __proto__ keep '$ARGS.named | path(.["__proto__"] | select(. == "keep"))'`,
    );
    expect(result.stdout).toBe('["__proto__"]\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(Object.hasOwn(Object.prototype, "keep")).toBe(false);
  });
});
