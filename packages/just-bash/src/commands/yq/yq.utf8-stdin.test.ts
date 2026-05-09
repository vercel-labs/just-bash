import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("yq reads UTF-8 from stdin", () => {
  it("preserves multibyte string values in piped YAML", async () => {
    const env = new Bash({
      files: { "/in.yaml": "msg: 한글 / café / 漢字\n" },
    });
    const result = await env.exec("cat /in.yaml | yq '.msg'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("한글 / café / 漢字");
  });
});
