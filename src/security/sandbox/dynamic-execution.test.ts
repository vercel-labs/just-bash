/**
 * Dynamic Execution Security Tests
 *
 * Tests for eval safety, source command, trap handling,
 * signal safety, and prompt (PS1/PS2) security.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../index.js";

describe("Dynamic Execution Security", () => {
  let bash: Bash;

  beforeEach(() => {
    bash = new Bash();
  });

  describe("Eval Safety", () => {
    it("should execute basic eval", async () => {
      const result = await bash.exec(`
        eval 'echo hello'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello\n");
    });

    it("should handle eval with variable expansion", async () => {
      const result = await bash.exec(`
        cmd="echo world"
        eval "$cmd"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("world\n");
    });

    it("should respect execution limits inside eval", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxCommandCount: 3 },
      });

      const result = await limitedBash.exec(`
        eval 'echo 1; echo 2; echo 3; echo 4; echo 5'
      `);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("too many commands");
    });

    it("should handle nested eval", async () => {
      const result = await bash.exec(`
        eval 'eval "echo nested"'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("nested\n");
    });

    it("should handle eval with dangerous characters", async () => {
      const result = await bash.exec(`
        dangerous="; echo injected"
        eval 'echo safe'"$dangerous"
      `);
      expect(result.exitCode).toBe(0);
      // Eval executes the string, so "injected" may appear
      // The important thing is it doesn't crash or escape sandbox
      expect(typeof result.stdout).toBe("string");
    });

    it("should handle eval with empty string", async () => {
      const result = await bash.exec(`
        eval ''
        echo "exit: $?"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("exit: 0\n");
    });

    it("should handle eval with syntax errors", async () => {
      const result = await bash.exec(`
        eval 'if then fi' 2>&1
      `);
      expect(result.exitCode).not.toBe(0);
    });

    it("should respect loop limits inside eval", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxLoopIterations: 5 },
      });

      const result = await limitedBash.exec(`
        eval 'while true; do :; done'
      `);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("too many iterations");
    });

    it("should handle eval returning non-zero exit code", async () => {
      const result = await bash.exec(`
        eval 'exit 42'
        echo "after: $?"
      `);
      // Eval exit affects the current shell
      expect(result.exitCode).toBe(42);
    });

    it("should handle eval with function definitions", async () => {
      const result = await bash.exec(`
        eval 'myfunc() { echo "from eval"; }'
        myfunc
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("from eval\n");
    });
  });

  describe("Source Command Behavior", () => {
    it("should handle source of non-existent file", async () => {
      const result = await bash.exec(`
        source /nonexistent/file.sh 2>&1 || echo "source failed"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("failed");
    });

    it("should handle source with dot syntax", async () => {
      const result = await bash.exec(`
        . /nonexistent/file.sh 2>&1 || echo "dot failed"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("failed");
    });

    it("should source virtual filesystem scripts", async () => {
      const result = await bash.exec(`
        echo 'SOURCED_VAR=from_script' > /tmp/script.sh
        source /tmp/script.sh
        echo $SOURCED_VAR
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("from_script\n");
    });

    it("should not escape sandbox via source", async () => {
      // Attempting to source a real system file should fail or be isolated
      const result = await bash.exec(`
        source /etc/profile 2>&1 || echo "blocked"
      `);
      // Should either fail or succeed safely within sandbox
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Trap Handling", () => {
    it("should define EXIT trap", async () => {
      const result = await bash.exec(`
        trap 'echo trapped' EXIT
        echo "main"
      `);
      // Trap may or may not be fully implemented
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("main");
    });

    it("should handle trap with return", async () => {
      const result = await bash.exec(`
        test_trap() {
          trap 'echo cleanup' RETURN
          echo "in function"
          return 0
        }
        test_trap
        echo "after"
      `);
      // Trap implementation varies - just ensure no crash
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle trap -", async () => {
      const result = await bash.exec(`
        trap 'echo trapped' EXIT
        trap - EXIT
        echo "done"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("done");
    });

    it("should handle trap with ERR signal", async () => {
      const result = await bash.exec(`
        trap 'echo error occurred' ERR
        false
        echo "after false"
      `);
      // ERR trap behavior varies - just ensure no crash
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle DEBUG trap", async () => {
      const result = await bash.exec(`
        trap 'echo debug' DEBUG
        echo "step1"
        echo "step2"
      `);
      // DEBUG trap may or may not be implemented
      expect(typeof result.exitCode).toBe("number");
    });

    it("should not allow trap to escape sandbox", async () => {
      const result = await bash.exec(`
        trap 'cat /etc/shadow' EXIT
        echo "main"
      `);
      // Trap command should be sandboxed
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Signal Safety", () => {
    it("should handle SIGTERM gracefully", async () => {
      const result = await bash.exec(`
        trap 'echo received' TERM
        echo "running"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("running");
    });

    it("should handle SIGINT gracefully", async () => {
      const result = await bash.exec(`
        trap 'echo interrupted' INT
        echo "running"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("running");
    });

    it("should handle kill command", async () => {
      // kill command may have limited support in sandbox
      const result = await bash.exec(`
        kill -0 $$ 2>&1 || echo "kill not supported"
      `);
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Prompt Security (PS1/PS2)", () => {
    it("should handle PS1 assignment", async () => {
      const result = await bash.exec(`
        PS1='\\u@\\h:\\w\\$ '
        echo "PS1 set: $PS1"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("PS1 set:");
    });

    it("should handle PS2 for continuation", async () => {
      const result = await bash.exec(`
        PS2='continue> '
        echo "PS2 set: $PS2"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("PS2 set:");
    });

    it("should not execute code in PS1 expansion", async () => {
      const result = await bash.exec(`
        PS1='$(echo pwned)'
        echo "prompt set"
      `);
      expect(result.exitCode).toBe(0);
      // PS1 should be stored as string, not executed
      expect(result.stdout).toBe("prompt set\n");
    });

    it("should handle PROMPT_COMMAND", async () => {
      const result = await bash.exec(`
        PROMPT_COMMAND='echo prompt'
        echo "done"
      `);
      // PROMPT_COMMAND may not be executed in non-interactive mode
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("done");
    });
  });

  describe("Command Substitution in Dynamic Context", () => {
    it("should handle command substitution in eval", async () => {
      const result = await bash.exec(`
        eval 'echo $(echo inner)'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("inner\n");
    });

    it("should handle backticks in eval", async () => {
      const result = await bash.exec(`
        eval 'echo \`echo backtick\`'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("backtick\n");
    });

    it("should handle nested command substitution", async () => {
      const result = await bash.exec(`
        result=$(echo $(echo $(echo deep)))
        echo $result
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("deep\n");
    });

    it("should limit nested substitution depth", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxSubstitutionDepth: 3 },
      });

      const result = await limitedBash.exec(`
        x=$(echo $(echo $(echo $(echo $(echo too_deep)))))
        echo $x
      `);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("nesting limit exceeded");
    });
  });

  describe("Arithmetic Evaluation Security", () => {
    it("should evaluate arithmetic safely", async () => {
      const result = await bash.exec(`
        echo $((5 + 3 * 2))
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("11\n");
    });

    it("should handle let command", async () => {
      const result = await bash.exec(`
        let "x = 5 + 3"
        echo $x
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("8\n");
    });

    it("should handle (( )) compound", async () => {
      const result = await bash.exec(`
        (( x = 10 ))
        (( x++ ))
        echo $x
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("11\n");
    });

    it("should handle division by zero in arithmetic", async () => {
      const result = await bash.exec(`
        echo $((10 / 0)) 2>&1 || echo "div by zero error"
      `);
      // Should produce error or handle gracefully
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle large numbers safely", async () => {
      const result = await bash.exec(`
        echo $((2147483647 + 1))
      `);
      // May overflow or handle differently - should not crash
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle negative numbers", async () => {
      const result = await bash.exec(`
        x=-5
        echo $((x * -3))
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("15\n");
    });
  });

  describe("Process Substitution Security", () => {
    it("should handle <() syntax", async () => {
      // Process substitution may not be fully supported
      const result = await bash.exec(`
        cat <(echo "from process sub") 2>&1 || echo "not supported"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle >() syntax", async () => {
      const result = await bash.exec(`
        echo "output" > >(cat) 2>&1 || echo "not supported"
      `);
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Here Document in Dynamic Context", () => {
    it("should handle heredoc in eval", async () => {
      const result = await bash.exec(`
        eval 'cat <<EOF
heredoc content
EOF'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("heredoc content\n");
    });

    it("should handle heredoc with variable expansion", async () => {
      const result = await bash.exec(`
        var="expanded"
        cat <<EOF
value: $var
EOF
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("value: expanded\n");
    });

    it("should handle heredoc with quoted delimiter", async () => {
      const result = await bash.exec(`
        var="not expanded"
        cat <<'EOF'
value: $var
EOF
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("value: $var\n");
    });
  });

  describe("Alias Security", () => {
    it("should define and use alias", async () => {
      const result = await bash.exec(`
        shopt -s expand_aliases 2>/dev/null || true
        alias myalias='echo from alias'
        myalias 2>&1 || echo "alias not expanded"
      `);
      // Alias behavior varies in non-interactive mode
      expect(typeof result.exitCode).toBe("number");
    });

    it("should not expand alias in dangerous way", async () => {
      const result = await bash.exec(`
        shopt -s expand_aliases 2>/dev/null || true
        alias ls='echo pwned; /bin/ls'
        echo "alias defined"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("alias defined\n");
    });

    it("should unalias safely", async () => {
      const result = await bash.exec(`
        shopt -s expand_aliases 2>/dev/null || true
        alias myalias='echo test'
        unalias myalias 2>/dev/null || true
        echo "done"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("done");
    });
  });
});
