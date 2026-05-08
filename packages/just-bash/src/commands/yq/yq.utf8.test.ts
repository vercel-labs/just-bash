import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq utf8 path assignment", () => {
  const KOREAN = "한글 테스트 문구입니다.";
  const ACCENTED = "café déjà vu";
  const CJK = "漢字テスト";

  it("preserves UTF-8 string bytes for file input during path assignment", async () => {
    const env = new Bash({
      files: {
        "/workflow.yaml": `nodes:\n  - id: target\n    type: llm\n    max_tokens: 8192\n    system_prompt: \"<g>${KOREAN} / ${ACCENTED} / ${CJK}</g>\"\n`,
      },
    });

    const result = await env.exec(
      "yq '(.nodes[] | select(.id == \"target\")).max_tokens = 16384' /workflow.yaml > /out.yaml && mv /out.yaml /workflow.yaml",
    );

    expect(result.exitCode).toBe(0);

    const after = await env.fs.readFile("/workflow.yaml", "utf8");
    expect(after).toContain(KOREAN);
    expect(after).toContain(ACCENTED);
    expect(after).toContain(CJK);
  });

  it("preserves UTF-8 string bytes for stdin input during path assignment", async () => {
    const env = new Bash({
      files: {
        "/workflow.yaml": `nodes:\n  - id: target\n    type: llm\n    max_tokens: 8192\n    system_prompt: \"<g>${KOREAN} / ${ACCENTED} / ${CJK}</g>\"\n`,
      },
    });

    const result = await env.exec(
      "cat /workflow.yaml | yq '(.nodes[] | select(.id == \"target\")).max_tokens = 16384' > /out.yaml",
    );

    expect(result.exitCode).toBe(0);

    const after = await env.fs.readFile("/out.yaml", "utf8");
    expect(after).toContain(KOREAN);
    expect(after).toContain(ACCENTED);
    expect(after).toContain(CJK);
  });
});
