import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

const KOREAN = "한글 테스트 문구입니다.";
const ACCENTED = "café crème brûlée";
const CJK = "漢字かな交じり文";
const EMOJI = "🚀✨";

function toBinaryStringFromUtf8(input: string): string {
  return Buffer.from(input, "utf8").toString("latin1");
}

function expectUtf8Preserved(output: string): void {
  expect(output).toContain(KOREAN);
  expect(output).toContain(ACCENTED);
  expect(output).toContain(CJK);
  expect(output).toContain(EMOJI);
}

describe("html-to-markdown utf8", () => {
  const html = `<h1>${KOREAN}</h1><p>${ACCENTED}</p><p>${CJK}</p><p>${EMOJI}</p>`;
  const binaryHtml = toBinaryStringFromUtf8(html);

  it("preserves UTF-8 bytes when HTML comes from stdin", async () => {
    const env = new Bash({ files: { "/stdin.html": binaryHtml } });

    const result = await env.exec("cat /stdin.html | html-to-markdown");

    expect(result.exitCode).toBe(0);
    expectUtf8Preserved(result.stdout);
  });

  it("preserves UTF-8 bytes when HTML comes from file input", async () => {
    const env = new Bash({ files: { "/input.html": binaryHtml } });

    const result = await env.exec("html-to-markdown /input.html");

    expect(result.exitCode).toBe(0);
    expectUtf8Preserved(result.stdout);
  });
});
