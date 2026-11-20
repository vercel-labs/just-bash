import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq quoted JSON boundaries", () => {
  it.each([
    0, 1, 2, 3, 16, 1024,
  ])("preserves concatenated values with %i backslashes before a quote", async (slashes) => {
    const text = `${"\\".repeat(slashes)}"}][{ café 😀`;
    const values = [{ [text]: [text] }, [text], text, { tail: true }];
    const json = values.map((value) => JSON.stringify(value));
    const env = new Bash({ files: { "/input": json.join("") } });
    const result = await env.exec("jq -c . /input");
    expect(result).toMatchObject({
      stdout: `${json.join("\n")}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  it("keeps literal controls inside strings separate from structural brackets", async () => {
    const env = new Bash({
      files: {
        "/input": '{"text":"escaped\\"}{\n\tend"}["next\\\\"]"last\nline"',
      },
    });
    expect(await env.exec("jq -c . /input")).toMatchObject({
      stdout: '{"text":"escaped\\"}{\\n\\tend"}\n["next\\\\"]\n"last\\nline"\n',
      stderr: "",
      exitCode: 0,
    });
  });

  it("applies nesting limits to structure rather than bracket characters in strings", async () => {
    const env = new Bash({
      files: { "/input": '{"text":"[[[[[[[","nested":["]]]]]]]"]}' },
      executionLimits: { maxQueryDepth: 2 },
    });
    expect(await env.exec("jq -c .text /input")).toMatchObject({
      stdout: '"[[[[[[["\n',
      stderr: "",
      exitCode: 0,
    });
    expect(await env.exec("echo '[[[]]]' | jq .")).toMatchObject({
      stdout: "",
      stderr: "jq: query depth limit exceeded (2)\n",
      exitCode: 126,
    });
  });
});
