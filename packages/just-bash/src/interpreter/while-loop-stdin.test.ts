import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("while loop stdin with pipeline in body", () => {
  it("simple pipeline in body reads all lines", async () => {
    const bash = new Bash({ files: { "/f": "a\nb\nc\n" } });
    const result = await bash.exec(
      'while IFS= read -r line; do echo "$line" | cat; done < /f',
    );
    expect(result.stdout).toBe("a\nb\nc\n");
    expect(result.exitCode).toBe(0);
  });

  it("multi-stage pipeline in body reads all lines", async () => {
    const bash = new Bash({ files: { "/f": "a\nb\nc\n" } });
    const result = await bash.exec(
      'while IFS= read -r line; do echo "$line" | tr a-z A-Z | cat; done < /f',
    );
    expect(result.stdout).toBe("A\nB\nC\n");
    expect(result.exitCode).toBe(0);
  });

  it("pipeline body does not consume loop stdin", async () => {
    const bash = new Bash({ files: { "/f": "x\ny\nz\n" } });
    const result = await bash.exec(
      "while IFS= read -r line; do echo extra | cat; done < /f",
    );
    expect(result.stdout).toBe("extra\nextra\nextra\n");
    expect(result.exitCode).toBe(0);
  });

  it("without IFS= also works with pipeline in body", async () => {
    const bash = new Bash({ files: { "/f": "a\nb\nc\n" } });
    const result = await bash.exec(
      'while read -r line; do echo "$line" | cat; done < /f',
    );
    expect(result.stdout).toBe("a\nb\nc\n");
    expect(result.exitCode).toBe(0);
  });

  it("nested loops each with a pipeline", async () => {
    const bash = new Bash({
      files: { "/outer": "A\nB\n", "/inner": "1\n2\n" },
    });
    const result = await bash.exec(`
      while IFS= read -r o; do
        while IFS= read -r i; do
          echo "$o:$i" | cat
        done < /inner
      done < /outer
    `);
    expect(result.stdout).toBe("A:1\nA:2\nB:1\nB:2\n");
    expect(result.exitCode).toBe(0);
  });

  it("group command reading extra line advances position", async () => {
    const bash = new Bash({ files: { "/f": "A\nB\nC\nD\n" } });
    const result = await bash.exec(`
      while IFS= read -r line; do
        { IFS= read -r extra; echo "$line+$extra"; } | cat
      done < /f
    `);
    expect(result.stdout).toBe("A+B\nC+D\n");
    expect(result.exitCode).toBe(0);
  });

  it("group with heredoc does not consume loop stdin", async () => {
    const bash = new Bash({ files: { "/f": "1\n2\n" } });
    const result = await bash.exec(`
      while IFS= read -r line; do
        { IFS= read -r x; echo "$line:$x"; } <<'EOF'
hello
EOF
      done < /f
    `);
    expect(result.stdout).toBe("1:hello\n2:hello\n");
    expect(result.exitCode).toBe(0);
  });
});
