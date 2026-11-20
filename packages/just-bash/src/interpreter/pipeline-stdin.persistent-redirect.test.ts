import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * After a persistent `exec < file` (autoconf's configure runs
 * `exec 7<&0 </dev/null`), a pipeline stage must still read the previous
 * stage's output. The persistent fd 0 only supplies stdin to a command that
 * has no other input.
 */

function makeBash(): Bash {
  return new Bash({ files: { "/in.txt": "FILE\n" }, cwd: "/" });
}

describe("pipeline stdin after a persistent exec redirection", () => {
  it("reads the pipe after exec </dev/null", async () => {
    const result = await makeBash().exec("exec </dev/null; printf hi | cat");

    expect(result.stdout).toBe("hi");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps command substitutions that contain a pipeline working", async () => {
    const result = await makeBash().exec(
      'exec 7<&0 </dev/null; x=$(printf "%s\\n" a-b | sed "s/-/_/"); echo "[$x]"',
    );

    expect(result.stdout).toBe("[a_b]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("feeds every stage of a longer pipeline", async () => {
    const result = await makeBash().exec(
      "exec </dev/null; printf 'a\\nb\\n' | tr a-z A-Z | sed 's/^/>/'",
    );

    expect(result.stdout).toBe(">A\n>B\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reads the pipe instead of a file attached with exec <", async () => {
    const result = await makeBash().exec("exec </in.txt; printf hi | cat");

    expect(result.stdout).toBe("hi");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("leaves the persistent file unread by the pipeline", async () => {
    const result = await makeBash().exec(
      "exec </in.txt; printf hi | cat; echo; cat",
    );

    expect(result.stdout).toBe("hi\nFILE\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("still lets an explicit redirection on a stage win over the pipe", async () => {
    const result = await makeBash().exec(
      "exec </dev/null; printf hi | cat < /in.txt",
    );

    expect(result.stdout).toBe("FILE\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("still reads the persistent file for a command outside a pipeline", async () => {
    const result = await makeBash().exec("exec </in.txt; cat");

    expect(result.stdout).toBe("FILE\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("gives the first stage the persistent file, as bash does", async () => {
    const result = await makeBash().exec("exec </in.txt; cat | tr A-Z a-z");

    expect(result.stdout).toBe("file\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
