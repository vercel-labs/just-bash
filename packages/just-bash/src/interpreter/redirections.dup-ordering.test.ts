import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";

/**
 * A duplication operator points both fds at one descriptor, so what it carries
 * is the two streams in the order they were written -- `{ echo a; echo b 1>&2;
 * echo c; } 2>&1` is `a b c` in bash, not `a c b`.
 *
 * The interpreter accumulates stdout and stderr as separate strings, which
 * discards that ordering, so merging them meant appending all of stderr after
 * all of stdout. `ExecutionOutputAccumulator` already appends in the order the
 * statements produced their output, so the sequence is recorded alongside the
 * two strings and the merge follows it.
 *
 * Only statement-level ordering is recoverable this way. A single command hands
 * back two already-separated strings, so `cmd 2>&1` still falls back to
 * stdout-then-stderr for that command's own output.
 */
describe("fd duplication output ordering", () => {
  it("interleaves a group's streams in write order", async () => {
    const result = await new Bash().exec(
      "{ echo O1; echo E1 1>&2; echo O2; echo E2 1>&2; } 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\nE2\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves into a file when both fds share it", async () => {
    const env = new Bash();
    await env.exec("{ echo O1; echo E1 1>&2; echo O2; } > /f 2>&1");
    const f = await env.exec("cat /f");
    expect(f.stdout).toBe("O1\nE1\nO2\n");
  });

  it("interleaves into a file the other fd opened", async () => {
    const env = new Bash();
    await env.exec("{ echo O1; echo E1 1>&2; echo O2; } 2> /f 1>&2");
    const f = await env.exec("cat /f");
    expect(f.stdout).toBe("O1\nE1\nO2\n");
  });

  it("interleaves onto stderr for 1>&2", async () => {
    const result = await new Bash().exec(
      "( echo O1; echo E1 1>&2; echo O2 ) 1>&2",
    );
    expect(result.stderr).toBe("O1\nE1\nO2\n");
    expect(result.stdout).toBe("");
  });

  it("orders custom commands' streams by statement", async () => {
    const out = defineCommand("out", async (args) => ({
      stdout: `${args[0]}\n`,
      stderr: "",
      exitCode: 0,
    }));
    const err = defineCommand("err", async (args) => ({
      stdout: "",
      stderr: `${args[0]}\n`,
      exitCode: 0,
    }));
    const result = await new Bash({ customCommands: [out, err] }).exec(
      "{ out A; err B; out C; } 2>&1",
    );
    expect(result.stdout).toBe("A\nB\nC\n");
  });

  it("keeps the streams separate when nothing duplicates them", async () => {
    const result = await new Bash().exec("echo O1; echo E1 1>&2; echo O2");
    expect(result.stdout).toBe("O1\nO2\n");
    expect(result.stderr).toBe("E1\n");
  });

  it("still merges a single command's own streams stdout-first", async () => {
    const both = defineCommand("both", async () => ({
      stdout: "OUT\n",
      stderr: "ERR\n",
      exitCode: 0,
    }));
    const result = await new Bash({ customCommands: [both] }).exec("both 2>&1");
    expect(result.stdout).toBe("OUT\nERR\n");
  });

  it("leaves two independent redirects to one path clobbering", async () => {
    const env = new Bash();
    await env.exec("{ echo O1; echo E1 1>&2; } > /f 2> /f");
    const f = await env.exec("cat /f");
    expect(f.stdout).toBe("E1\n");
  });

  it("interleaves into a file both fds were opened onto at once", async () => {
    const env = new Bash();
    await env.exec("{ echo O1; echo E1 1>&2; echo O2; } &> /f");
    const f = await env.exec("cat /f");
    expect(f.stdout).toBe("O1\nE1\nO2\n");
  });

  it("interleaves when appending", async () => {
    const env = new Bash();
    await env.exec("echo P > /f");
    await env.exec("{ echo O1; echo E1 1>&2; echo O2; } >> /f 2>&1");
    const f = await env.exec("cat /f");
    expect(f.stdout).toBe("P\nO1\nE1\nO2\n");
  });
});

/**
 * A scope's own redirection layer rebuilds the result it relays, so ordering
 * has to survive that rebuild or an inner scope flattens before an outer
 * `2>&1` ever sees it.
 */
describe("fd duplication ordering through nested scopes", () => {
  it("keeps an inner group's order for an outer duplication", async () => {
    const result = await new Bash().exec(
      "{ { echo O1; echo E1 1>&2; echo O2; }; } 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("keeps the order of two sibling groups", async () => {
    const result = await new Bash().exec(
      "{ { echo O1; echo E1 1>&2; }; { echo O2; echo E2 1>&2; }; } 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\nE2\n");
    expect(result.stderr).toBe("");
  });

  it("keeps a subshell's order for an outer duplication", async () => {
    const result = await new Bash().exec(
      "{ ( echo O1; echo E1 1>&2; echo O2 ); } 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("keeps a function body's order at the call site", async () => {
    const result = await new Bash().exec(
      "f() { echo O1; echo E1 1>&2; echo O2; }; f 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("keeps a function body's order for a redirection on its definition", async () => {
    const result = await new Bash().exec(
      "f() { echo O1; echo E1 1>&2; echo O2; } 2>&1; f",
    );
    expect(result.stdout).toBe("O1\nE1\nO2\n");
    expect(result.stderr).toBe("");
  });

  it("keeps the order across repeated calls to one function", async () => {
    const result = await new Bash().exec(
      "f() { echo O1; echo E1 1>&2; }; { f; f; } 2>&1",
    );
    expect(result.stdout).toBe("O1\nE1\nO1\nE1\n");
    expect(result.stderr).toBe("");
  });

  it("interleaves a nested group into a file", async () => {
    const env = new Bash();
    await env.exec("{ { echo O1; echo E1 1>&2; echo O2; }; } > /f 2>&1");
    const f = await env.exec("cat /f");
    expect(f.stdout).toBe("O1\nE1\nO2\n");
  });
});

/**
 * Two fds are one descriptor when one open put them both there, which is what
 * a duplication does. Naming the same path twice opens it twice, and an fd
 * that still names an older open of that path is not the open the redirection
 * beside it just made.
 */
describe("fd duplication descriptor identity", () => {
  it("does not merge an inherited open with a fresh open of one path", async () => {
    const env = new Bash();
    await env.exec(
      "exec 3> /f; exec 1>&3; { echo O1; echo E1 1>&2; echo O2; } > /f 2>&3",
    );
    const f = await env.exec("cat /f");
    // `> /f` and fd 3 are two opens, so the two streams stay independent.
    // Bash writes each at its own descriptor's offset and ends with
    // "E1\nO2\n"; a delivery here writes whole strings from position 0, which
    // is the same approximation `> f 2> f` above is pinned on.
    expect(f.stdout).toBe("O1\nO2\nE1\n");
  });

  it("merges a duplication of a descriptor opened by exec", async () => {
    const env = new Bash();
    await env.exec("exec 3> /f; { echo O1; echo E1 1>&2; echo O2; } >&3 2>&3");
    const f = await env.exec("cat /f");
    expect(f.stdout).toBe("O1\nE1\nO2\n");
  });
});
