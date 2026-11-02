import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";

async function run(script: string) {
  return new Bash().exec(script);
}

describe("indentation after a backslash-newline continuation", () => {
  it("keeps the spaces that separate the words around the continuation", async () => {
    const result = await run('printf "[%s]\\n" a\\\n    b');

    expect(result.stdout).toBe("[a]\n[b]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps the indentation of every continued line", async () => {
    const result = await run(
      "awk_files() { printf '<%s>' \"$@\"; echo; }\n" +
        "  awk_files ./pngconf.h ./scripts/pnglibconf.dfa\\\n" +
        "      ./pngusr.dfa\\\n" +
        "      ./last",
    );

    expect(result.stdout).toBe(
      "<./pngconf.h><./scripts/pnglibconf.dfa><./pngusr.dfa><./last>\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("still strips the indentation of the line after the continued command", async () => {
    const result = await run(
      "if true; then\n    echo one \\\n        two\n    echo three\nfi",
    );

    expect(result.stdout).toBe("one two\nthree\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not treat an escaped backslash at the end of a line as a continuation", async () => {
    const result = await run("echo one \\\\\n    echo two");

    expect(result.stdout).toBe("one \\\ntwo\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not treat a trailing backslash in a comment as a continuation", async () => {
    const result = await run("echo hi # note \\\n    echo next");

    expect(result.stdout).toBe("hi\nnext\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps the indentation of a continued line inside a heredoc body", async () => {
    const result = await run("cat <<EOF\n  a \\\n    b\nEOF");

    expect(result.stdout).toBe("  a     b\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
