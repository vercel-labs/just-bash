import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * Expansion of the command name in a simple command.
 *
 * Bash expands the command word like any other word: brace expansion, word
 * splitting and globbing. The first field is the command, and the other
 * fields come before the arguments. A word that expands to no fields drops
 * out, so the next word is the command. An empty field, such as '' or a
 * quoted empty "$x", is a command name that is not found.
 *
 * Every expectation here comes from GNU bash 5.2.37.
 */
async function run(script: string, files?: Record<string, string>) {
  const env = new Bash(files ? { files, cwd: "/work" } : undefined);
  return env.exec(script);
}

function expectResult(
  result: { stdout: string; stderr: string; exitCode: number },
  stdout: string,
  stderr = "",
  exitCode = 0,
) {
  expect(result.stdout).toBe(stdout);
  expect(result.stderr).toBe(stderr);
  expect(result.exitCode).toBe(exitCode);
}

describe("command name expansion", () => {
  describe("word splitting", () => {
    it("splits an unquoted variable into a command and its arguments", async () => {
      expectResult(
        await run('CC="echo cc -O2"; $CC -c x.c'),
        "cc -O2 -c x.c\n",
      );
    });

    it("splits a variable with no other words", async () => {
      expectResult(await run('X="echo a b"; $X'), "a b\n");
    });

    it("splits $* into a command and its arguments", async () => {
      expectResult(await run("set -- echo a b; $*"), "a b\n");
    });

    it('runs "$@" as a command with its arguments', async () => {
      expectResult(await run('t() { shift; "$@"; }; t 5 echo a b'), "a b\n");
    });

    it('runs "${a[@]}" as a command with its arguments', async () => {
      expectResult(await run('a=(echo x y); "${a[@]}"'), "x y\n");
    });

    it("splits a command substitution in the command name", async () => {
      expectResult(await run("$(echo echo sub) arg"), "sub arg\n");
      expectResult(await run("`echo echo bq` arg"), "bq arg\n");
    });

    it("splits on IFS and drops leading and trailing blanks", async () => {
      expectResult(await run('IFS=:; x="echo:a:b"; $x'), "a b\n");
      expectResult(await run('x="  echo   a  "; $x b'), "a b\n");
    });

    it("passes the extra fields to a function", async () => {
      expectResult(
        await run('f() { echo "f:$#:$*"; }; x="f 1 2"; $x 3'),
        "f:3:1 2 3\n",
      );
    });

    it("keeps prefix assignments and redirections", async () => {
      expectResult(
        await run('x="printenv FOO"; FOO=bar $x; echo "[$FOO]"'),
        "bar\n[]\n",
      );
      expectResult(await run('x="echo   a"; $x > out.txt; cat out.txt'), "a\n");
    });

    it("keeps a quoted name as one word", async () => {
      expectResult(
        await run('x="echo a b"; "$x"; echo "rc=$?"'),
        "rc=127\n",
        "bash: echo a b: command not found\n",
      );
      expectResult(
        await run('set -- "echo one" two; "$@"; echo "rc=$?"'),
        "rc=127\n",
        "bash: echo one: command not found\n",
      );
    });
  });

  describe("names with no fields", () => {
    it("runs the next word when the name expands to no fields", async () => {
      expectResult(await run('set --; "$@" echo hi'), "hi\n");
      expectResult(
        await run('a=(); "${a[@]}" echo empty-array'),
        "empty-array\n",
      );
      expectResult(await run("x=; $x echo hi"), "hi\n");
    });

    it("treats a name with no fields and no arguments as a no-op", async () => {
      expectResult(await run('set --; "$@"; echo "rc=$?"'), "rc=0\n");
      expectResult(await run('x=; false; $x; echo "rc=$?"'), "rc=0\n");
    });

    it("reports the status of a command substitution in the name", async () => {
      expectResult(await run('$(exit 42); echo "rc=$?"'), "rc=42\n");
    });

    it("does not find an empty field as a command", async () => {
      expectResult(
        await run("x=; $x '' foo; echo \"rc=$?\""),
        "rc=127\n",
        "bash: : command not found\n",
      );
      expectResult(
        await run('x=; "$x"; echo "rc=$?"'),
        "rc=127\n",
        "bash: : command not found\n",
      );
    });
  });

  describe("brace expansion and globbing", () => {
    const files = { "/work/echo": "", "/work/echo-x": "" };

    it("applies brace expansion to the name", async () => {
      expectResult(await run("{echo,a} b"), "a b\n");
      expectResult(await run("{echo,a,b}"), "a b\n");
    });

    it("globs the name and runs the first match", async () => {
      expectResult(await run("ech? hi", files), "hi\n");
      expectResult(await run("ech* hi", files), "echo-x hi\n");
      expectResult(await run('x="ech*"; $x hi', files), "echo-x hi\n");
    });

    it("does not glob a quoted name or a name under set -f", async () => {
      expectResult(
        await run('x="ech*"; "$x" hi; echo "rc=$?"', files),
        "rc=127\n",
        "bash: ech*: command not found\n",
      );
      expectResult(
        await run("set -f; x='ech*'; $x hi; echo \"rc=$?\"", files),
        "rc=127\n",
        "bash: ech*: command not found\n",
      );
    });

    it("keeps a name with no match as a literal word", async () => {
      expectResult(
        await run('nomatch* hi; echo "rc=$?"', files),
        "rc=127\n",
        "bash: nomatch*: command not found\n",
      );
    });

    it("drops a name with no match under nullglob", async () => {
      expectResult(
        await run('shopt -s nullglob; nomatch* hi; echo "rc=$?"', files),
        "rc=127\n",
        "bash: hi: command not found\n",
      );
    });

    it("runs [ under nullglob and failglob", async () => {
      expectResult(
        await run("shopt -s nullglob; [ 1 = 1 ] && echo yes", files),
        "yes\n",
      );
      expectResult(
        await run("shopt -s failglob; [ 1 = 1 ] && echo yes", files),
        "yes\n",
      );
    });
  });
});
