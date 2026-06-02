import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("set builtin", () => {
  describe("set with no args (variable listing)", () => {
    it("should output associative arrays in bash format", async () => {
      const env = new Bash();
      const result = await env.exec(`
        typeset -A __assoc
        __assoc['k e y']='v a l'
        __assoc[a]=b
        set | grep '^__assoc='
      `);
      expect(result.exitCode).toBe(0);
      // Bash format: __assoc=([a]="b" ["k e y"]="v a l" )
      // Keys are sorted, so 'a' comes before 'k e y'
      expect(result.stdout).toBe('__assoc=([a]="b" ["k e y"]="v a l" )\n');
    });

    it("should not show assoc array elements as separate scalars", async () => {
      const env = new Bash();
      const result = await env.exec(`
        typeset -A __assoc
        __assoc[a]=b
        set | grep '^__assoc' | wc -l
      `);
      expect(result.exitCode).toBe(0);
      // Should only be one line, the array output, not multiple lines
      expect(result.stdout.trim()).toBe("1");
    });
  });

  describe("set -u (nounset)", () => {
    it("should error on unset variable when enabled", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        echo $UNDEFINED_VAR
      `);
      expect(result.stderr).toContain("UNDEFINED_VAR: unbound variable");
      expect(result.exitCode).toBe(1);
    });

    it("should not error on set variable", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        MYVAR=hello
        echo $MYVAR
      `);
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should allow empty string as valid value", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        MYVAR=""
        echo "value: $MYVAR"
      `);
      expect(result.stdout).toBe("value: \n");
      expect(result.exitCode).toBe(0);
    });

    it("should be disabled by +u", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        set +u
        echo $UNDEFINED
      `);
      expect(result.stdout).toBe("\n");
      expect(result.exitCode).toBe(0);
    });

    it("should work with -o nounset", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -o nounset
        echo $UNDEFINED
      `);
      expect(result.stderr).toContain("UNDEFINED: unbound variable");
      expect(result.exitCode).toBe(1);
    });

    it("should be disabled with +o nounset", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -o nounset
        set +o nounset
        echo $UNDEFINED
      `);
      expect(result.stdout).toBe("\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("special variables with nounset", () => {
    it("should not error on $? with nounset", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        echo $?
      `);
      expect(result.stdout).toBe("0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not error on $$ with nounset", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        echo $$
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toBe("");
    });

    it("should not error on $# with nounset", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        echo $#
      `);
      expect(result.stdout).toBe("0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not error on $@ with nounset when no args", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        echo "$@"
      `);
      expect(result.stdout).toBe("\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("positional parameters with nounset", () => {
    it("should error on unset positional parameter", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          set -u
          echo $1
        }
        myfunc
      `);
      expect(result.stderr).toContain("1: unbound variable");
      expect(result.exitCode).toBe(1);
    });

    it("should not error on set positional parameter", async () => {
      const env = new Bash();
      const result = await env.exec(`
        myfunc() {
          set -u
          echo $1
        }
        myfunc hello
      `);
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("default value expansion with nounset", () => {
    it("should allow ${var:-default} with unset var", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        echo \${UNSET:-default}
      `);
      expect(result.stdout).toBe("default\n");
      expect(result.exitCode).toBe(0);
    });

    it("should allow ${var:=default} with unset var", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        echo \${UNSET:=default}
        echo $UNSET
      `);
      expect(result.stdout).toBe("default\ndefault\n");
      expect(result.exitCode).toBe(0);
    });

    it("should allow ${var:+value} with unset var", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -u
        echo ":\${UNSET:+alt}:"
      `);
      expect(result.stdout).toBe("::\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("set -e and set -u combined", () => {
    it("should handle both options together", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -eu
        VAR=hello
        echo $VAR
      `);
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should exit on unset var with -eu", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -eu
        echo $UNDEFINED
        echo "never"
      `);
      expect(result.stderr).toContain("UNDEFINED: unbound variable");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).not.toContain("never");
    });
  });

  describe("bundled -o in a short-flag cluster (strict mode)", () => {
    it("should accept `set -euo pipefail`", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -euo pipefail
        echo ok
      `);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("ok\n");
    });

    it("should enable errexit, nounset and pipefail with -euo pipefail", async () => {
      const env = new Bash();
      // nounset must be active: referencing an unset var aborts the script.
      const result = await env.exec(`
        set -euo pipefail
        echo $UNDEFINED
        echo never
      `);
      expect(result.stderr).toContain("UNDEFINED: unbound variable");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).not.toContain("never");
    });

    it("should enable pipefail via the bundled -o (-eo pipefail)", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -eo pipefail
        false | true
        echo never
      `);
      // pipefail makes the pipeline fail; errexit then aborts the script.
      expect(result.exitCode).toBe(1);
      expect(result.stdout).not.toContain("never");
    });

    it("should consume the next word as the -o name regardless of order (-oe pipefail)", async () => {
      const env = new Bash();
      // `-oe pipefail` == `-o pipefail` + `-e`: pipefail enabled, no leftover
      // positional params, and errexit active.
      const result = await env.exec(`
        set -oe pipefail
        echo "args=[$*]"
        false | true
        echo never
      `);
      expect(result.stdout).toContain("args=[]");
      expect(result.stdout).not.toContain("never");
      expect(result.exitCode).toBe(1);
    });

    it("should leave trailing words as positional parameters", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -euo pipefail one two
        echo "$# $1 $2"
      `);
      expect(result.stdout).toBe("2 one two\n");
      expect(result.exitCode).toBe(0);
    });

    it("should disable options with a bundled +o (+euo pipefail)", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -euo pipefail
        set +euo pipefail
        echo "$UNDEFINED_OK"
        echo done
      `);
      // nounset was turned back off, so the unset var is just empty.
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("done");
    });

    it("should reject an invalid bundled -o option name", async () => {
      const env = new Bash();
      const result = await env.exec("set -euo bogusoption");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("bogusoption");
      expect(result.stderr).toContain("invalid option name");
    });

    it("should still enable errexit for `set -oe` when no -o name follows", async () => {
      // bash applies every flag in the cluster even when the bundled `o` has
      // no option-name argument: `set -oe` (no following word) enables errexit
      // *and* prints the option listing. The remaining flags are not abandoned.
      const env = new Bash();
      const result = await env.exec(`
        set -oe
        false
        echo never
      `);
      // errexit is active, so `false` aborts before `echo never`.
      expect(result.stdout).not.toContain("never");
      expect(result.exitCode).toBe(1);
      // The no-name `o` prints the option listing (snapshot taken before `e`
      // is applied, so errexit shows off there).
      expect(result.stdout).toContain("errexit");
    });

    it("should print the listing but apply leading flags for `set -eo`", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -eo
        echo "dash=$-"
      `);
      // The listing is emitted, and errexit (the flag before `o`) is applied.
      expect(result.stdout).toContain("errexit");
      expect(result.stdout).toMatch(/dash=\S*e\S*/);
      expect(result.exitCode).toBe(0);
    });

    it("should enable errexit and nounset for `set -oue` (no -o name)", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -oue
        echo "dash=$-"
      `);
      expect(result.stdout).toMatch(/dash=\S*e\S*/);
      expect(result.stdout).toMatch(/dash=\S*u\S*/);
      expect(result.exitCode).toBe(0);
    });

    it("should not consume a following option token as the -o name (`set -o -x`)", async () => {
      // bash does not treat `-x` as the `-o` option name; it lists options and
      // then processes `-x` as xtrace. `$-` ends up with `x`.
      const env = new Bash();
      const result = await env.exec(`
        set -o -x
        echo "dash=$-"
      `);
      expect(result.stdout).toContain("errexit");
      expect(result.stdout).toMatch(/dash=\S*x\S*/);
      expect(result.exitCode).toBe(0);
    });

    it("should let multiple bundled `o`s consume successive words", async () => {
      // `set -oo pipefail errexit` == `set -o pipefail -o errexit`: each `o`
      // consumes the next word as its long-option name.
      const env = new Bash();
      const result = await env.exec(`
        set -oo pipefail errexit
        echo "args=[$*] dash=$-"
        false | true
        echo after
      `);
      // errexit is on (so `false | true` with pipefail aborts), and no words
      // leaked into positional parameters.
      expect(result.stdout).toContain("args=[]");
      expect(result.stdout).toMatch(/dash=\S*e\S*/);
      expect(result.stdout).not.toContain("after");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("set -e (errexit)", () => {
    it("should exit immediately when command fails", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        echo before
        false
        echo after
      `);
      expect(result.stdout).toBe("before\n");
      expect(result.exitCode).toBe(1);
    });

    it("should continue execution without set -e", async () => {
      const env = new Bash();
      const result = await env.exec(`
        echo before
        false
        echo after
      `);
      expect(result.stdout).toBe("before\nafter\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not exit if command succeeds", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        echo one
        true
        echo two
      `);
      expect(result.stdout).toBe("one\ntwo\n");
      expect(result.exitCode).toBe(0);
    });

    it("should disable errexit with set +e", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        set +e
        echo before
        false
        echo after
      `);
      expect(result.stdout).toBe("before\nafter\n");
      expect(result.exitCode).toBe(0);
    });

    it("should enable errexit with set -o errexit", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -o errexit
        echo before
        false
        echo after
      `);
      expect(result.stdout).toBe("before\n");
      expect(result.exitCode).toBe(1);
    });

    it("should disable errexit with set +o errexit", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -o errexit
        set +o errexit
        echo before
        false
        echo after
      `);
      expect(result.stdout).toBe("before\nafter\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("errexit exceptions", () => {
    it("should not exit on failed command in && short-circuit", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        false && echo "not reached"
        echo after
      `);
      expect(result.stdout).toBe("after\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not exit on failed command in || short-circuit", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        false || echo "fallback"
        echo after
      `);
      expect(result.stdout).toBe("fallback\nafter\n");
      expect(result.exitCode).toBe(0);
    });

    it("should exit if final command in && list fails", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        echo before
        true && false
        echo after
      `);
      expect(result.stdout).toBe("before\n");
      expect(result.exitCode).toBe(1);
    });

    it("should not exit on negated failed command", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        ! false
        echo after
      `);
      expect(result.stdout).toBe("after\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not exit on failed command in if condition", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        if false; then
          echo "then"
        else
          echo "else"
        fi
        echo after
      `);
      expect(result.stdout).toBe("else\nafter\n");
      expect(result.exitCode).toBe(0);
    });

    it("should exit on failed command in if body", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        if true; then
          echo "in body"
          false
          echo "not reached"
        fi
        echo after
      `);
      expect(result.stdout).toBe("in body\n");
      expect(result.exitCode).toBe(1);
    });

    it("should not exit on failed condition that terminates while loop", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        x=0
        while [ $x -lt 3 ]; do
          echo $x
          x=$((x + 1))
        done
        echo after
      `);
      expect(result.stdout).toBe("0\n1\n2\nafter\n");
      expect(result.exitCode).toBe(0);
    });

    it("should exit on failed command in while body", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        x=0
        while [ $x -lt 3 ]; do
          echo $x
          false
          x=$((x + 1))
        done
        echo after
      `);
      expect(result.stdout).toBe("0\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("set -o pipefail", () => {
    it("should return success when all commands succeed", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -o pipefail
        echo hello | cat | cat
        echo "exit: $?"
      `);
      expect(result.stdout).toBe("hello\nexit: 0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return failure when first command fails", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -o pipefail
        false | true
        echo "exit: $?"
      `);
      expect(result.stdout).toBe("exit: 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return failure when middle command fails", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -o pipefail
        echo hello | false | cat
        echo "exit: $?"
      `);
      expect(result.stdout).toBe("exit: 1\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return rightmost failing exit code", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -o pipefail
        exit 2 | exit 3 | true
        echo "exit: $?"
      `);
      expect(result.stdout).toBe("exit: 3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should return last command exit code without pipefail", async () => {
      const env = new Bash();
      const result = await env.exec(`
        false | true
        echo "exit: $?"
      `);
      expect(result.stdout).toBe("exit: 0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should disable pipefail with +o pipefail", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -o pipefail
        set +o pipefail
        false | true
        echo "exit: $?"
      `);
      expect(result.stdout).toBe("exit: 0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should trigger errexit when pipeline fails with pipefail", async () => {
      const env = new Bash();
      const result = await env.exec(`
        set -e
        set -o pipefail
        echo before
        false | true
        echo after
      `);
      expect(result.stdout).toBe("before\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("set error handling", () => {
    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("set --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("usage:");
      expect(result.stdout).toContain("-e");
    });

    it("should error on unknown short option", async () => {
      const env = new Bash();
      const result = await env.exec("set -z");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("-z");
      expect(result.stderr).toContain("invalid option");
    });

    it("should error on unknown long option", async () => {
      const env = new Bash();
      const result = await env.exec("set -o unknownoption");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknownoption");
      expect(result.stderr).toContain("invalid option name");
    });

    it("should list options when -o has no argument", async () => {
      // In bash, `set -o` without argument lists all options
      const env = new Bash();
      const result = await env.exec("set -o");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("errexit");
    });
  });
});
