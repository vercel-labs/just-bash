import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";

// Hands back both streams with no recorded order, as a custom command does.
const both = defineCommand("both", async () => ({
  stdout: "O\n",
  stderr: "E\n",
  exitCode: 0,
}));

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

  it.each([
    "for i in 1; do both; echo X; done 2>&1",
    "i=0; while [ $i -lt 1 ]; do both; echo X; i=1; done 2>&1",
    "if true; then both; echo X; fi 2>&1",
    "case a in a) both; echo X;; esac 2>&1",
    "{ both; echo X; } 2>&1",
  ])("orders a command without a recorded order as one statement: %s", async (script) => {
    const result = await new Bash({ customCommands: [both] }).exec(script);
    expect(result.stdout).toBe("O\nE\nX\n");
    expect(result.stderr).toBe("");
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

  // `eval` and `source` run a script of their own, whose accumulated output
  // is prepended to a control-flow error on its way out. The order goes with
  // it, so the scope that catches the error can still merge along it.
  it.each([
    ["exit", "{ eval 'echo O1; echo E1 1>&2; echo O2; exit'; } 2>&1"],
    [
      "return",
      "f() { eval 'echo O1; echo E1 1>&2; echo O2; return'; }; f 2>&1",
    ],
    [
      "break",
      "for i in 1; do eval 'echo O1; echo E1 1>&2; echo O2; break'; done 2>&1",
    ],
    [
      "continue",
      "for i in 1; do eval 'echo O1; echo E1 1>&2; echo O2; continue'; done 2>&1",
    ],
  ])("keeps the order of an eval script that leaves on %s", async (_, script) => {
    const result = await new Bash().exec(script);
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("keeps the order of a list that errexit ends", async () => {
    const result = await new Bash().exec(
      "set -e; { echo O1 && echo E1 1>&2 && echo O2 && false; } 2>&1 | cat",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });
});

/**
 * A sourced file, an executable script, and a nested shell each turn the
 * control-flow error that ends them into an ordinary result, and an errexit
 * that ends a script is folded into its output the same way. Each of those
 * conversions has to keep the order the error carried out.
 */
describe("fd duplication ordering across script boundaries", () => {
  const BODY = "echo O1\necho E1 1>&2\necho O2\n";
  const run = (script: string) =>
    new Bash({
      files: {
        "/returns": `${BODY}return 0\n`,
        "/exits": `#!/bin/bash\n${BODY}exit 0\n`,
      },
    }).exec(`chmod +x /exits; ${script}`);

  it.each([
    ["a sourced file that returns", ". /returns 2>&1"],
    ["a sourced file that returns, in a group", "{ . /returns; } 2>&1"],
    [
      "a sourced file that returns, in a function",
      "f() { . /returns; }; f 2>&1",
    ],
    ["an executable script that exits", "/exits 2>&1"],
    ["an executable script that exits, in a group", "{ /exits; } 2>&1"],
    [
      "a nested shell that exits",
      "bash -c 'echo O1; echo E1 1>&2; echo O2; exit' 2>&1",
    ],
    [
      "a nested shell that exits into a |& pipe",
      "bash -c 'echo O1; echo E1 1>&2; echo O2; exit' |& cat",
    ],
    [
      "a nested shell that errexit ends",
      "bash -c 'set -e; echo O1 && echo E1 1>&2 && echo O2 && false' 2>&1",
    ],
    [
      "an eval script that errexit ends",
      "eval 'set -e; echo O1 && echo E1 1>&2 && echo O2 && false' 2>&1",
    ],
  ])("keeps the order of %s", async (_, script) => {
    const result = await run(script);
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

  // A stage that leaves on `exit` or errexit becomes that stage's result
  // rather than ending the script, and the result keeps the order the stage
  // wrote in.
  it.each([
    ["exit", "{ echo O1; echo E1 1>&2; echo O2; exit; } |& cat"],
    [
      "exit with a status",
      "{ echo O1; echo E1 1>&2; echo O2; exit 3; } |& cat",
    ],
    [
      "errexit",
      "set -e; { echo O1; echo E1 1>&2; echo O2; false; echo P; } |& cat",
    ],
    [
      "exit into an ordinary pipe after a duplication",
      "{ echo O1; echo E1 1>&2; echo O2; exit; } 2>&1 | cat",
    ],
  ])("keeps the order of a stage that leaves on %s", async (_, script) => {
    const result = await new Bash().exec(script);
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });
});
