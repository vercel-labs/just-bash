import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq update path validation", () => {
  it.each([
    ".[1:3]",
    "(.[0], .[1])",
  ])("rejects unsupported update path %s", async (path) => {
    const result = await new Bash().exec(
      `jq -nc '[1,2,3,4] | try (${path} |= [0]) catch "caught"'`,
    );
    expect(result).toMatchObject({
      stdout: '"caught"\n',
      stderr: "",
      exitCode: 0,
    });
  });

  it("rejects scalar intermediates while allowing null containers", async () => {
    const result = await new Bash().exec(
      `jq -nc '[0, false, "s"] | map(try setpath(["a"]; 1) catch "caught")'`,
    );
    expect(result).toMatchObject({
      stdout: '["caught","caught","caught"]\n',
      stderr: "",
      exitCode: 0,
    });
    expect(
      await new Bash().exec(`jq -nc 'null | setpath(["a",0,"b"]; 5)'`),
    ).toMatchObject({
      stdout: '{"a":[{"b":5}]}\n',
      stderr: "",
      exitCode: 0,
    });
  });
});
