import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Compound commands relay their body's output through their own accumulator,
 * and a scope that leaves on `break`, `exit` or `return` carries it out on the
 * error instead. Both paths have to keep the write order, or a duplication
 * outside them merges stdout-first however well the body recorded it.
 */
describe("fd duplication ordering through control flow", () => {
  it("interleaves a for loop's iterations", async () => {
    const result = await new Bash().exec(
      "for i in 1 2; do echo O$i; echo E$i 1>&2; done 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\nE2\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves a C-style for loop", async () => {
    const result = await new Bash().exec(
      "for ((i=1; i<3; i++)); do echo O$i; echo E$i 1>&2; done 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\nE2\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves a while loop", async () => {
    const result = await new Bash().exec(
      'while [ -z "$d" ]; do echo O1; echo E1 1>&2; echo O2; d=1; done 2>&1',
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves an until loop", async () => {
    const result = await new Bash().exec(
      'until [ -n "$d" ]; do echo O1; echo E1 1>&2; d=1; done 2>&1',
    );
    expect(result.stdout).toBe("O1\nE1\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves an if body", async () => {
    const result = await new Bash().exec(
      "if true; then echo O1; echo E1 1>&2; echo O2; fi 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves an if condition's own output with the body's", async () => {
    const result = await new Bash().exec(
      "if echo C1; echo C2 1>&2; then echo O1; echo E1 1>&2; fi 2>&1",
    );
    expect(result.stdout).toBe("C1\nC2\nO1\nE1\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves a matched case body", async () => {
    const result = await new Bash().exec(
      "case x in x) echo O1; echo E1 1>&2; echo O2;; esac 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves a loop into a file", async () => {
    const env = new Bash();
    await env.exec("for i in 1 2; do echo O$i; echo E$i 1>&2; done > /f 2>&1");
    const f = await env.exec("cat /f");
    expect(f.stdout).toBe("O1\nE1\nO2\nE2\n");
  });

  it("keeps the order of output written before a break", async () => {
    const result = await new Bash().exec(
      "for i in 1 2; do echo O$i; echo E$i 1>&2; echo P$i; " +
        "[ $i = 1 ] && break; done 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nP1\n");
    expect(result.stderr).toBe("");
  });

  it("keeps the order of output written before an exit", async () => {
    const result = await new Bash().exec(
      "{ echo O1; echo E1 1>&2; echo O2; exit 0; } 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("keeps the order of output written before a return", async () => {
    const result = await new Bash().exec(
      "f() { echo O1; echo E1 1>&2; echo O2; return 0; }; f 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("keeps the order of a subshell that exits early", async () => {
    const result = await new Bash().exec(
      "( echo O1; echo E1 1>&2; echo O2; exit 0 ) 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });
});

/**
 * A pipe carries whatever its write end is given. `|&` puts both streams on
 * that end, so the reading stage sees them in the order they were written.
 */
describe("fd duplication ordering through pipelines", () => {
  it("interleaves both streams into a |& pipe", async () => {
    const result = await new Bash().exec(
      "{ echo O1; echo E1 1>&2; echo O2; } |& cat",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves a duplication feeding an ordinary pipe", async () => {
    const result = await new Bash().exec(
      "{ echo O1; echo E1 1>&2; echo O2; } 2>&1 | cat",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("leaves an ordinary pipe carrying stdout alone", async () => {
    const result = await new Bash().exec(
      "{ echo O1; echo E1 1>&2; echo O2; } | cat",
    );
    expect(result.stdout).toBe("O1\nO2\n");
    expect(result.stderr).toBe("E1\n");
  });
});
