import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("cut -f on lines without the delimiter", () => {
  it("prints a line without the delimiter whole", async () => {
    const env = new Bash();
    const result = await env.exec("printf 'a:b\\nc\\n' | cut -d: -f2");
    expect(result.stdout).toBe("b\nc\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints such a line whole whichever fields are selected", async () => {
    const env = new Bash();
    const result = await env.exec(
      "printf 'a:b:c\\nplain\\n' | cut -d: -f1; " +
        "printf 'a:b:c\\nplain\\n' | cut -d: -f2-; " +
        "printf 'a:b:c\\nplain\\n' | cut -d: -f1,3",
    );
    expect(result.stdout).toBe("a\nplain\nb:c\nplain\na:c\nplain\n");
    expect(result.stderr).toBe("");
  });

  it("keeps empty lines without the delimiter", async () => {
    const env = new Bash();
    const result = await env.exec("printf 'a:b\\n\\nc:d\\n' | cut -d: -f2");
    expect(result.stdout).toBe("b\n\nd\n");
  });

  it("applies to the default tab delimiter", async () => {
    const env = new Bash();
    const result = await env.exec("printf 'a\\tb\\nplain\\n' | cut -f2");
    expect(result.stdout).toBe("b\nplain\n");
  });

  it("reads the same from a file", async () => {
    const env = new Bash({ files: { "/in.txt": "a:b\nc\n" } });
    const result = await env.exec("cut -d: -f2 /in.txt");
    expect(result.stdout).toBe("b\nc\n");
  });

  it("still suppresses such lines with -s", async () => {
    const env = new Bash();
    const result = await env.exec(
      "printf 'a:b\\nc\\n' | cut -s -d: -f2; " +
        "printf 'a:b\\nc\\n' | cut --only-delimited -d: -f2",
    );
    expect(result.stdout).toBe("b\nb\n");
    expect(result.stderr).toBe("");
  });
});
