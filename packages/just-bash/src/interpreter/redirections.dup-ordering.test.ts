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

  // An fd number reused within one redirection list names two opens in turn.
  // A dup snapshots the open the fd held when it ran, so `1>&3 3>b 2>&3` puts
  // the two streams on different files even though both snapshots list fd 3.
  const body = "{ printf O; printf E 1>&2; }";
  const files = async (env: Bash, ...paths: string[]) => {
    const out: string[] = [];
    for (const path of paths) out.push((await env.exec(`cat ${path}`)).stdout);
    return out;
  };

  it("keeps a reopened fd's streams apart when the first open came from exec", async () => {
    const env = new Bash();
    await env.exec(`exec 3> /a; ${body} 1>&3 3> /b 2>&3`);
    expect(await files(env, "/a", "/b")).toEqual(["O", "E"]);
  });

  it("keeps a reopened fd's streams apart when both opens are in the list", async () => {
    const env = new Bash();
    await env.exec(`${body} 3> /a 1>&3 3> /b 2>&3`);
    expect(await files(env, "/a", "/b")).toEqual(["O", "E"]);
  });

  it("still merges through an alias that survives the reopen", async () => {
    const env = new Bash();
    // fd 4 stays on the first open, so `2>&4` joins `1>&3` there.
    await env.exec(`exec 3> /a; exec 4>&3; ${body} 1>&3 3> /b 2>&4`);
    expect(await files(env, "/a", "/b")).toEqual(["OE", ""]);
  });

  it("merges two dups that reach one exec'd open through a list dup", async () => {
    const env = new Bash();
    await env.exec(`exec 3> /a; ${body} 4>&3 1>&3 2>&4`);
    expect(await files(env, "/a")).toEqual(["OE"]);
  });

  it("merges two dups that reach one list open through a list dup", async () => {
    const env = new Bash();
    await env.exec(`${body} 3> /a 1>&3 4>&3 2>&4`);
    expect(await files(env, "/a")).toEqual(["OE"]);
  });

  it("follows a list dup taken before its source was reopened", async () => {
    const env = new Bash();
    // fd 4 copied the first open; fd 3 then moved to /b, so stdout lands
    // there and stderr on /a.
    await env.exec(`exec 3> /a; ${body} 4>&3 3> /b 1>&3 2>&4`);
    expect(await files(env, "/a", "/b")).toEqual(["E", "O"]);
  });

  it("keeps the streams apart when the fd is re-pointed at another exec'd open", async () => {
    const env = new Bash();
    // Neither open is the list's own, so identity is the alias group, and
    // fd 3 is in both snapshots: only the count of times the list had
    // re-pointed it tells the two apart.
    await env.exec(`exec 3> /a; exec 4> /b; ${body} 1>&3 3>&4 2>&3`);
    expect(await files(env, "/a", "/b")).toEqual(["O", "E"]);
  });

  it("merges through an fd re-pointed at the open the other dup holds", async () => {
    const env = new Bash();
    await env.exec(`exec 3> /a; ${body} 1>&3 3>&1 2>&3`);
    expect(await files(env, "/a")).toEqual(["OE"]);
  });
});

describe("a self-move", () => {
  // `3>&3-` moves fd 3 onto itself, which bash treats as a no-op, so the two
  // dups around it are still on one open.
  it.each([
    ["exec 3> /f; { printf O; printf E 1>&2; } 1>&3 3>&3- 2>&3"],
    ["{ printf O; printf E 1>&2; } 3> /f 1>&3 3>&3- 2>&3"],
  ])("keeps the dups around it on one open: %s", async (script) => {
    const env = new Bash();
    await env.exec(script);
    expect(await env.readFile("/f")).toBe("OE");
  });
});

describe("persistent duplication of a standard fd", () => {
  // `exec > f 2>&1` puts fd 2 on fd 1's open. A later result that carries
  // both streams at once, which a nested shell hands back, is then one
  // descriptor's worth of output and goes onto it in write order.
  it.each([
    ["exec > /f 2>&1"],
    ["exec 3> /f; exec 1>&3 2>&1"],
    ["exec > /f; exec 2>&1"],
    ["exec &> /f"],
    ["exec &>> /f"],
    ["exec >& /f"],
  ])("merges a nested shell's streams after %s", async (setup) => {
    const env = new Bash();
    await env.exec(`${setup}; bash -c 'echo O1; echo E1 1>&2; echo O2'`);
    expect(await env.readFile("/f")).toBe("O1\nE1\nO2\n");
  });

  it("splits them again once fd 2 is reopened", async () => {
    const env = new Bash();
    await env.exec(
      "exec > /f 2>&1; exec 2> /g; bash -c 'echo O1; echo E1 1>&2; echo O2'",
    );
    expect(await env.readFile("/f")).toBe("O1\nO2\n");
    expect(await env.readFile("/g")).toBe("E1\n");
  });
});

/**
 * A dup within a list resolves its source through the entries the list
 * itself opened, so an fd the list has since closed or replaced must drop out
 * of that lookup rather than lend a later dup the open it no longer holds.
 */
describe("fds a redirection list has given up", () => {
  it.each([
    ["closed through an fd variable", "{x}>/a {x}>&- 1>&$x echo hi", "10"],
    ["moved onto a standard fd", "echo hi 3>/a 1>&3- 2>&3", "3"],
  ])("refuses a dup of an fd %s", async (_, script, fd) => {
    const env = new Bash();
    const result = await env.exec(`${script}; echo "rc=$?"`);
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe(`bash: ${fd}: Bad file descriptor\n`);
    expect(await env.readFile("/a")).toBe("");
  });

  it("does not write through an fd reopened as a here-document", async () => {
    const env = new Bash();
    await env.exec("echo hi 3>/a 3<<EOF 1>&3\nx\nEOF");
    expect(await env.readFile("/a")).toBe("");
  });
});

describe("recorded order at the public boundary", () => {
  it("hands the caller the two streams and not the pieces", async () => {
    const result = await new Bash().exec("{ echo O; echo E 1>&2; }");
    expect(result.stdout).toBe("O\n");
    expect(result.stderr).toBe("E\n");
    expect("internalOutputChunks" in result).toBe(false);
  });
});
