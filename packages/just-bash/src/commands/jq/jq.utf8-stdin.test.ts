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

  it("preserves multibyte string values when file input is redirected", async () => {
    const env = new Bash({
      files: {
        "/places.json": JSON.stringify({ name: "Florida — Miami" }),
      },
    });

    const result = await env.exec("jq '.name' /places.json > /out.json");
    expect(result.exitCode).toBe(0);

    const out = await env.fs.readFile("/out.json", "utf8");
    expect(out).toBe('"Florida — Miami"\n');
  });
});
