import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("awk UTF-8 input decoding", () => {
  const KOREAN = "한글";
  const ACCENTED = "café";
  const CJK = "東京";

  function asLatin1BinaryUtf8(input: string): string {
    return Buffer.from(input, "utf8").toString("latin1");
  }

  it("preserves UTF-8 characters from stdin when extracting fields", async () => {
    const env = new Bash({
      files: {
        "/stdin-source.txt": asLatin1BinaryUtf8(`${KOREAN} ${ACCENTED} ${CJK}\n`),
      },
    });
    const result = await env.exec("cat /stdin-source.txt | awk '{print $1, $2, $3}'");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${KOREAN} ${ACCENTED} ${CJK}\n`);
  });

  it("preserves UTF-8 characters from file input when extracting first field", async () => {
    const env = new Bash({
      files: {
        "/utf8.txt": asLatin1BinaryUtf8(`${KOREAN} ${ACCENTED}\n${CJK} data\n`),
      },
    });

    const result = await env.exec("awk '{print $1}' /utf8.txt");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${KOREAN}\n${CJK}\n`);
  });

  it("preserves UTF-8 characters for getline < file", async () => {
    const env = new Bash({
      files: {
        "/main.txt": "trigger\n",
        "/ext.txt": asLatin1BinaryUtf8(`${KOREAN}\n`),
      },
    });

    const result = await env.exec(`awk '{ getline ext < "/ext.txt"; print ext }' /main.txt`);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${KOREAN}\n`);
  });
});
