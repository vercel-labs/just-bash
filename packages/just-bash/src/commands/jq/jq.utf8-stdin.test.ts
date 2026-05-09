import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// `cat /file | jq` is the canonical byte-pipeline path: cat reads file bytes
// and pipes them as a ByteString. Without decoding, JSON string values
// containing multibyte UTF-8 mojibake.
describe("jq reads UTF-8 from stdin", () => {
  it("preserves multibyte string values in piped JSON", async () => {
    const env = new Bash({
      files: { "/in.json": JSON.stringify({ msg: "한글 / café / 漢字" }) },
    });
    const result = await env.exec("cat /in.json | jq -r '.msg'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("한글 / café / 漢字\n");
  });
});
