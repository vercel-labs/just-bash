import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * `$?` after a command that has no command word.
 *
 * Bash gives a bare assignment status 0 — it does not re-report whatever ran
 * before it. The only thing that can change that is a command substitution
 * performed while expanding the command: an assigned value (`x=$(exit 7)` is
 * 7) or a redirection word (`> /dev/null$(exit 5)` is 5), last one wins. A
 * redirection onto fd 0 overrides all of it with 0, because bash performs
 * such a command's redirections in a forked child.
 *
 * Leaking the previous status here is invisible until something reads it. An
 * `else` branch is the sharp edge: it runs with `$?` set to 1 by the failed
 * condition, so an `else` branch ending in an assignment made the whole `if`
 * report failure, and under `set -e` that killed the script with no output.
 *
 * Every expectation here was verified against real bash before being written.
 */
describe("exit status of commands with no command word", () => {
  describe("bare assignments report success", () => {
    it("should reset $? after a plain assignment", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=1; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? after multiple assignments in one command", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=1 y=2; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? after an array assignment", async () => {
      const env = new Bash();
      const result = await env.exec(`false; arr=(a b); echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? after a subscript assignment", async () => {
      const env = new Bash();
      const result = await env.exec(`false; arr[0]=a; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? after an append assignment", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x+=tail; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should let the assignment read $? before resetting it", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=$?; echo "x=$x status=$?"`);
      expect(result.stdout).toBe("x=1 status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? for every assignment in a row", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=1; echo "first=$?"; false; y=2; echo "second=$?"`,
      );
      expect(result.stdout).toBe("first=0\nsecond=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? for a bare redirection", async () => {
      const env = new Bash();
      const result = await env.exec(`false; > /tmp/out; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? for a command word that expands to nothing", async () => {
      const env = new Bash();
      const result = await env.exec(`false; empty=; $empty; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("command substitutions still set the status", () => {
    it("should report the status of a substitution in the value", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=$(exit 7); echo "status=$?"`);
      expect(result.stdout).toBe("status=7\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report the last substitution when several run", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=$(exit 3) y=$(exit 4); echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=4\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should keep the substitution status across a later plain value", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=$(exit 3) y=plain; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=3\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report a substitution nested in a parameter expansion", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=\${y:=$(exit 9)}; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=9\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report a value substitution when the target has none", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=$(exit 7) > /tmp/out; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=7\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report a substitution used as the command word", async () => {
      const env = new Bash();
      const result = await env.exec(`false; $(exit 42); echo "status=$?"`);
      expect(result.stdout).toBe("status=42\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should not take the status from a process substitution", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=<(echo hi); echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("an else branch ending in an assignment", () => {
    it("should run the whole branch and report success", async () => {
      const env = new Bash();
      const result = await env.exec(
        `if false; then echo then; else x=1; echo "else x=$x"; fi`,
      );
      expect(result.stdout).toBe("else x=1\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report success when the branch is a single assignment", async () => {
      const env = new Bash();
      const result = await env.exec(
        `if false; then :; else x=1; fi; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report success when the branch is only assignments", async () => {
      const env = new Bash();
      const result = await env.exec(
        `if false; then :; else x=1; y=2; fi; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report success for an assignment inside a group", async () => {
      const env = new Bash();
      const result = await env.exec(
        `if false; then :; else { x=1; }; fi; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should not abort the script under set -e", async () => {
      const env = new Bash();
      const result = await env.exec(
        `set -e\nif false; then :; else x=1; echo reached; fi\necho done`,
      );
      expect(result.stdout).toBe("reached\ndone\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should not abort the script when the branch ends in the assignment", async () => {
      const env = new Bash();
      const result = await env.exec(
        `set -e\nif false; then :; else x=1; fi\necho done`,
      );
      expect(result.stdout).toBe("done\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("other constructs that inherit a failed status", () => {
    it("should reset $? for an assignment in a case branch", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; case q in q) x=1;; esac; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? for an assignment in a loop body", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; for i in 1; do x=1; done; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should make a bare return report the assignment's success", async () => {
      const env = new Bash();
      const result = await env.exec(
        `f() { false; x=1; return; }; f; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should make a bare exit report the assignment's success", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=1; exit`);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("substitutions in redirection words count too", () => {
    it("should report a substitution in a bare redirection's target", async () => {
      const env = new Bash();
      const result = await env.exec(
        `true; > /dev/null$(exit 5); echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=5\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should let a target substitution outrank an earlier value one", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; x=$(exit 7) > /dev/null$(exit 5); echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=5\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report the last target when several redirections carry one", async () => {
      const env = new Bash();
      const result = await env.exec(
        `x=$(exit 7) > /dev/null$(exit 5) > /dev/null$(exit 3); echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=3\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should expand assignments before redirections, whatever the order written", async () => {
      const env = new Bash();
      const result = await env.exec(
        `> /dev/null$(exit 5) x=$(exit 7); echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=5\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should report a target substitution on an empty command word", async () => {
      const env = new Bash();
      const result = await env.exec(
        `false; e=; $e > /dev/null$(exit 5); echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=5\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should leave a command that has a command word alone", async () => {
      const env = new Bash();
      const result = await env.exec(
        `true; echo hi > /dev/null$(exit 5); echo "status=$?"`,
      );
      // "hi" went to /dev/null; the command's own status wins over the target's.
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("a redirection onto fd 0 reports success", () => {
    // bash performs a null command's redirections in a forked child when one
    // of them reads stdin, so the substitution status is discarded. bash 3.2
    // predates that fork and keeps the status; these follow bash 5.x, which
    // the comparison fixtures are recorded against.
    it("should discard the value substitution for an input redirection", async () => {
      const env = new Bash();
      const result = await env.exec(
        `x=$(exit 7) < /dev/null; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should discard it for a here-string", async () => {
      const env = new Bash();
      const result = await env.exec(`x=$(exit 7) <<< x; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should discard it for a read-write open on fd 0", async () => {
      const env = new Bash();
      const result = await env.exec(
        `e=; $e <> /dev/null$(exit 5); echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should discard it when fd 0 is closed", async () => {
      const env = new Bash();
      const result = await env.exec(`x=$(exit 7) 0<&-; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should keep the status for an input redirection on another fd", async () => {
      const env = new Bash();
      const result = await env.exec(
        `x=$(exit 7) 3< /dev/null; echo "status=$?"`,
      );
      expect(result.stdout).toBe("status=7\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should keep the status when fd 0 is only the source of a dup", async () => {
      const env = new Bash();
      const result = await env.exec(`x=$(exit 7) 3<&0; echo "status=$?"`);
      expect(result.stdout).toBe("status=7\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should keep the status for an output redirection", async () => {
      const env = new Bash();
      const result = await env.exec(`x=$(exit 7) 1>&2; echo "status=$?"`);
      expect(result.stdout).toBe("status=7\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("PS4 expansion under set -x", () => {
    // The trace prefix is expanded for output only; a substitution in it is
    // not one of the command's own expansions.
    it("should not let a PS4 substitution become a bare assignment's status", async () => {
      const env = new Bash();
      const result = await env.exec(
        `PS4='$(exit 4)+'\nset -x\nfalse\nx=1\ns=$?\nset +x\necho "status=$s"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not let a PS4 substitution outrank the assigned value's", async () => {
      const env = new Bash();
      const result = await env.exec(
        `PS4='$(exit 4)+'\nset -x\nfalse\nx=$(exit 7)\ns=$?\nset +x\necho "status=$s"`,
      );
      expect(result.stdout).toBe("status=7\n");
      expect(result.exitCode).toBe(0);
    });

    it("should not let a PS4 substitution become a bare redirection's status", async () => {
      const env = new Bash();
      const result = await env.exec(
        `PS4='$(exit 4)+'\nset -x\nfalse\n> /dev/null\ns=$?\nset +x\necho "status=$s"`,
      );
      expect(result.stdout).toBe("status=0\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("shapes reported from the field", () => {
    // Contributed on PR #400 by the SLICC integration that hit this in
    // production, where it cost an 18-step bisection. Kept as written, because
    // each one isolates a different reason the bug was hard to see.
    it("should reset $? with no control flow involved at all", async () => {
      const env = new Bash();
      const result = await env.exec(`false; x=1; y=2; echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should reset $? for an assignment ending a subshell", async () => {
      const env = new Bash();
      const result = await env.exec(`( false; x=1 ); echo "status=$?"`);
      expect(result.stdout).toBe("status=0\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should survive a defaults helper whose else ends in an assignment", async () => {
      // The production shape: the assignment is the natural last statement, so
      // its status becomes the function's, and under set -e the script's fate.
      const env = new Bash();
      const result = await env.exec(
        `set -e\ncfg() { if [ -n "$1" ]; then val="$1"; else val="fallback"; fi; }\ncfg ""\necho "val=$val"`,
      );
      expect(result.stdout).toBe("val=fallback\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should agree with the assignment builtins that were never affected", async () => {
      // `local`, `export` and `declare` are real command words, so they always
      // took the normal path and reported their own status. Re-declaring with
      // `local` was the field workaround; this pins that the two paths now
      // agree rather than that one of them is right by accident.
      const env = new Bash();
      const script = (assign: string) =>
        `set -e\nf() { if false; then :; else ${assign}; fi; }\nf\necho ok`;
      for (const assign of ["local v=1", "export E=1", "declare d=1", "v=1"]) {
        const result = await env.exec(script(assign));
        expect(result.stdout, assign).toBe("ok\n");
        expect(result.exitCode, assign).toBe(0);
      }
    });

    it("should behave the same whether or not a statement follows", async () => {
      // Adding any statement after the assignment masked the bug completely,
      // so a script failed or not depending on where the assignment fell.
      const env = new Bash();
      const trailing = await env.exec(
        `set -e\nif false; then :; else x=1; echo "x=$x"; fi\necho done`,
      );
      expect(trailing.stdout).toBe("x=1\ndone\n");
      expect(trailing.exitCode).toBe(0);

      const bare = await env.exec(
        `set -e\nif false; then :; else x=1; fi\necho done`,
      );
      expect(bare.stdout).toBe("done\n");
      expect(bare.exitCode).toBe(0);
    });

    it("should leave a loop followed by an assignment alone", async () => {
      const env = new Bash();
      const result = await env.exec(
        `set -e; while false; do :; done; y=2; echo done`,
      );
      expect(result.stdout).toBe("done\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });
});
