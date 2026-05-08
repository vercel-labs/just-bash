import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq utf8 path assignment", () => {
  const KOREAN = "한글 테스트 문구입니다.";

  it("preserves UTF-8 string bytes when assigning to nested array path", async () => {
    const env = new Bash({
      files: {
        "/workflow.json": JSON.stringify(
          {
            nodes: [
              {
                type: "llm",
                max_tokens: 8192,
                system_prompt: `<g>${KOREAN}</g>`,
              },
            ],
          },
          null,
          2,
        ),
      },
    });

    const result = await env.exec(
      "jq '.nodes[0].max_tokens = 16384' /workflow.json > /out.json && mv /out.json /workflow.json",
    );

    expect(result.exitCode).toBe(0);

    const after = await env.fs.readFile("/workflow.json", "utf8");
    expect(after).toContain(KOREAN);
  });

  it("preserves UTF-8 string bytes when assigning through selected path", async () => {
    const env = new Bash({
      files: {
        "/workflow.json": JSON.stringify(
          {
            nodes: [
              {
                id: "target",
                type: "llm",
                max_tokens: 8192,
                system_prompt: `<g>${KOREAN}</g>`,
              },
            ],
          },
          null,
          2,
        ),
      },
    });

    const result = await env.exec(
      "jq '(.nodes[] | select(.id == \"target\")).max_tokens = 16384' /workflow.json > /out.json && mv /out.json /workflow.json",
    );

    expect(result.exitCode).toBe(0);

    const after = await env.fs.readFile("/workflow.json", "utf8");
    expect(after).toContain(KOREAN);
  });
});
