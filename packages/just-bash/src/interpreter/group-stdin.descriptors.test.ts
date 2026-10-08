import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Which descriptor routes count as a command's own stdin.
 *
 * A persistent `exec <` replaces fd 0 for every later command, so builtins
 * must keep treating it as owned even when it is empty. An input redirection
 * on another descriptor (`2< file`) opens that descriptor and leaves stdin
 * alone. An empty fd-0 redirection is EOF, not the enclosing stdin, while a
 * saved copy of stdin (`exec 3<&0`) read back with `<&3` is still the
 * inherited stream.
 *
 * Every expectation below was checked against GNU bash 3.2.57.
 */

const READ_X = "'read x; echo \"x=[$x]\"'";

function makeBash(): Bash {
  return new Bash({
    files: {
      "/loop.txt": "L1\nL2\nL3\n",
      "/outer.txt": "outer\n",
      "/fd2.txt": "fd2\n",
      "/empty.txt": "",
    },
    cwd: "/",
  });
}

describe("an empty persistent `exec <` still owns fd 0 for builtins", () => {
  it("`eval` reads EOF, not the enclosing stdin", async () => {
    const result = await makeBash().exec(
      "{ exec < /empty.txt; eval 'cat'; } < /outer.txt",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("`read` inside `eval` sees EOF", async () => {
    const result = await makeBash().exec(
      `{ exec < /empty.txt; eval ${READ_X}; } < /loop.txt`,
    );
    expect(result.stdout).toBe("x=[]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("`command eval` reads EOF, not the enclosing stdin", async () => {
    const result = await makeBash().exec(
      "{ exec < /empty.txt; command eval 'cat'; } < /outer.txt",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("an input redirection on another descriptor leaves stdin alone", () => {
  it("`cat 2< file` reads stdin, not the file", async () => {
    const result = await makeBash().exec("{ cat 2< /fd2.txt; } < /outer.txt");
    expect(result.stdout).toBe("outer\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("`cat 2<<< word` reads stdin, not the here-string", async () => {
    const result = await makeBash().exec("{ cat 2<<< fd2; } < /outer.txt");
    expect(result.stdout).toBe("outer\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("`eval … 2< file` shares the shell's stdin position", async () => {
    const result = await makeBash().exec(
      `{ eval ${READ_X} 2< /fd2.txt; read y; echo "y=[$y]"; } < /loop.txt`,
    );
    expect(result.stdout).toBe("x=[L1]\ny=[L2]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("an empty fd-0 redirection means EOF for external commands", () => {
  it("`cat < empty` inside a redirected group prints nothing", async () => {
    const result = await makeBash().exec("{ cat < /empty.txt; } < /outer.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("a saved copy of the inherited stdin is not a replacement", () => {
  it("`exec 3<&0; cat <&3` in a group reads the piped stdin", async () => {
    const result = await makeBash().exec(
      "printf 'hello\\n' | { exec 3<&0; cat <&3; }",
    );
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("`0<&3` restores the saved stdin after `< empty`", async () => {
    const result = await makeBash().exec(
      "printf 'hello\\n' | { cat < /empty.txt 0<&3; } 3<&0",
    );
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
