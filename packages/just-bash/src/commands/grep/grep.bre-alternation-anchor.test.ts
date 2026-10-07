import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("grep BRE $ before \\|", () => {
  it("anchors $ at the end of an alternative", async () => {
    const env = new Bash({
      files: { "/test.txt": "ab\ncd\nb$x\n" },
    });

    const result = await env.exec("grep 'b$\\|^c' /test.txt");

    expect(result.stdout).toBe("ab\ncd\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("anchors $ in the first of repeated -e patterns", async () => {
    const env = new Bash({
      files: { "/test.txt": "GREP\n" },
    });

    const result = await env.exec(
      "grep -e 'GREP$' -e '-(cannot match)-' /test.txt",
    );

    expect(result.stdout).toBe("GREP\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("anchors $ in a pattern read with -f", async () => {
    const env = new Bash({
      files: {
        "/patterns.txt": "GREP$\nzz\n",
        "/test.txt": "GREP\nGREPx\n",
      },
    });

    const result = await env.exec("grep -f /patterns.txt /test.txt");

    expect(result.stdout).toBe("GREP\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps $ literal in the middle of an alternative", async () => {
    const env = new Bash({
      files: { "/test.txt": "a$b\nab\n" },
    });

    const result = await env.exec("grep 'a$b\\|zz' /test.txt");

    expect(result.stdout).toBe("a$b\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
