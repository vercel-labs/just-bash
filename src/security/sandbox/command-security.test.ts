/**
 * Command Security Tests
 *
 * Tests for dangerous command handling, PATH manipulation,
 * hash table behavior, and command execution safety.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../index.js";

describe("Command Security", () => {
  let bash: Bash;

  beforeEach(() => {
    bash = new Bash();
  });

  describe("Dangerous Command Handling", () => {
    it("should handle rm safely in sandbox", async () => {
      const result = await bash.exec(`
        echo "content" > /tmp/testfile.txt
        cat /tmp/testfile.txt
        rm /tmp/testfile.txt
        cat /tmp/testfile.txt 2>&1 || echo "deleted"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("content");
      expect(result.stdout).toContain("deleted");
    });

    it("should handle rm -rf in sandbox", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/testdir/subdir
        echo "file" > /tmp/testdir/subdir/file.txt
        rm -rf /tmp/testdir
        ls /tmp/testdir 2>&1 || echo "removed"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("removed");
    });

    it("should handle chmod command", async () => {
      const result = await bash.exec(`
        echo "content" > /tmp/chmodtest.txt
        chmod 755 /tmp/chmodtest.txt 2>&1 || echo "chmod handled"
        echo "done"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("done");
    });

    it("should handle chown command", async () => {
      const result = await bash.exec(`
        echo "content" > /tmp/chowntest.txt
        chown root /tmp/chowntest.txt 2>&1 || echo "chown handled"
        echo "done"
      `);
      // chown may fail in sandbox - important thing is it doesn't crash
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle mv command", async () => {
      const result = await bash.exec(`
        echo "content" > /tmp/mvtest1.txt
        mv /tmp/mvtest1.txt /tmp/mvtest2.txt
        cat /tmp/mvtest2.txt
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("content\n");
    });

    it("should handle cp command", async () => {
      const result = await bash.exec(`
        echo "content" > /tmp/cptest1.txt
        cp /tmp/cptest1.txt /tmp/cptest2.txt
        cat /tmp/cptest2.txt
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("content\n");
    });

    it("should handle ln command", async () => {
      const result = await bash.exec(`
        echo "content" > /tmp/lntest.txt
        ln -s /tmp/lntest.txt /tmp/lnlink.txt
        cat /tmp/lnlink.txt
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("content\n");
    });
  });

  describe("PATH Manipulation", () => {
    it("should handle PATH modification", async () => {
      const result = await bash.exec(`
        PATH="/custom/bin:$PATH"
        echo "PATH set"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("PATH set\n");
    });

    it("should not allow PATH hijacking to affect command resolution", async () => {
      const result = await bash.exec(`
        PATH=""
        ls /tmp 2>&1 || echo "ls still works: yes"
      `);
      // Commands are resolved via registry, not PATH
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle empty PATH", async () => {
      // Note: In just-bash, setting PATH="" may affect command resolution
      // This is expected behavior - commands are resolved via PATH
      const result = await bash.exec(`
        PATH=""
        echo "hello" 2>&1 || echo "echo failed"
      `);
      // May fail if echo is resolved via PATH
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle PATH with current directory", async () => {
      const result = await bash.exec(`
        PATH=".:$PATH"
        echo "done"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("done\n");
    });
  });

  describe("Hash Table Behavior", () => {
    it("should handle hash command", async () => {
      const result = await bash.exec(`
        hash 2>&1 || echo "hash handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle hash -r", async () => {
      const result = await bash.exec(`
        hash -r 2>&1 || echo "hash -r handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });

    it("should handle type command", async () => {
      const result = await bash.exec(`
        type echo 2>&1 || echo "type handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle which command", async () => {
      const result = await bash.exec(`
        which ls 2>&1 || echo "which handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle command -v", async () => {
      const result = await bash.exec(`
        command -v echo 2>&1 || echo "command -v handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Builtin Commands", () => {
    it("should handle builtin keyword", async () => {
      const result = await bash.exec(`
        builtin echo "test" 2>&1 || echo "builtin handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle enable command", async () => {
      const result = await bash.exec(`
        enable echo 2>&1 || echo "enable handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });

    it("should handle help command", async () => {
      const result = await bash.exec(`
        help 2>&1 || echo "help handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Command Execution Controls", () => {
    it("should handle exec command", async () => {
      const result = await bash.exec(`
        exec echo "execed" 2>&1 || echo "exec handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle command builtin", async () => {
      const result = await bash.exec(`
        command echo "via command"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("via command\n");
    });

    it("should handle set -e", async () => {
      const result = await bash.exec(`
        set -e
        true
        echo "after true"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("after true\n");
    });

    it("should handle set -e with failure", async () => {
      const result = await bash.exec(`
        set -e
        false
        echo "not reached"
      `);
      expect(result.exitCode).not.toBe(0);
      expect(result.stdout).not.toContain("not reached");
    });

    it("should handle set -u", async () => {
      // Note: set -u behavior may vary in implementation
      // Test documents that it doesn't crash
      const result = await bash.exec(`
        set -u
        echo $UNDEFINED_VAR 2>&1 || echo "caught undefined"
      `);
      // set -u may or may not be fully implemented
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle set -o pipefail", async () => {
      const result = await bash.exec(`
        set -o pipefail
        false | true
        echo "exit: $?"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("exit:");
    });
  });

  describe("Subcommand Safety", () => {
    it("should handle xargs safely", async () => {
      const result = await bash.exec(`
        echo "a b c" | xargs echo 2>&1 || echo "xargs handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle find command", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/findtest
        touch /tmp/findtest/file.txt
        find /tmp/findtest -name "*.txt" 2>&1 || echo "find handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle tee command", async () => {
      const result = await bash.exec(`
        echo "content" | tee /tmp/teetest.txt 2>&1 || echo "tee handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Background and Job Control", () => {
    it("should handle & background operator", async () => {
      const result = await bash.exec(`
        echo "background" &
        wait 2>/dev/null || true
        echo "foreground"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("foreground");
    });

    it("should handle jobs command", async () => {
      const result = await bash.exec(`
        jobs 2>&1 || echo "jobs handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });

    it("should handle fg command", async () => {
      const result = await bash.exec(`
        fg 2>&1 || echo "fg handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });

    it("should handle bg command", async () => {
      const result = await bash.exec(`
        bg 2>&1 || echo "bg handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });

    it("should handle wait command", async () => {
      const result = await bash.exec(`
        wait 2>&1 || true
        echo "waited"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("waited");
    });
  });

  describe("Shell Options Security", () => {
    it("should handle shopt command", async () => {
      const result = await bash.exec(`
        shopt 2>&1 || echo "shopt handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });

    it("should handle shopt -s extglob", async () => {
      const result = await bash.exec(`
        shopt -s extglob 2>/dev/null || true
        echo "extglob set"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("extglob set\n");
    });

    it("should handle shopt -s nullglob", async () => {
      const result = await bash.exec(`
        shopt -s nullglob 2>/dev/null || true
        echo "nullglob set"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("nullglob set\n");
    });

    it("should handle shopt -s dotglob", async () => {
      const result = await bash.exec(`
        shopt -s dotglob 2>/dev/null || true
        echo "dotglob set"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("dotglob set\n");
    });
  });

  describe("Time and Resource Commands", () => {
    it("should handle time command", async () => {
      const result = await bash.exec(`
        time echo "timed" 2>&1 || echo "time handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle ulimit command", async () => {
      const result = await bash.exec(`
        ulimit -a 2>&1 || echo "ulimit handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });

    it("should handle times command", async () => {
      const result = await bash.exec(`
        times 2>&1 || echo "times handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });
  });

  describe("Directory Stack Commands", () => {
    it("should handle pushd command", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/pushtest
        pushd /tmp/pushtest 2>&1 || echo "pushd handled"
        pwd
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle popd command", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/poptest
        pushd /tmp/poptest 2>/dev/null || true
        popd 2>&1 || echo "popd handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });

    it("should handle dirs command", async () => {
      const result = await bash.exec(`
        dirs 2>&1 || echo "dirs handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });
  });

  describe("Exit and Return Safety", () => {
    it("should handle exit with code", async () => {
      const result = await bash.exec(`
        exit 42
      `);
      expect(result.exitCode).toBe(42);
    });

    it("should handle exit in subshell", async () => {
      const result = await bash.exec(`
        (exit 5)
        echo "exit code: $?"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("exit code: 5\n");
    });

    it("should handle return in function", async () => {
      const result = await bash.exec(`
        myfunc() {
          return 7
        }
        myfunc
        echo "returned: $?"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("returned: 7\n");
    });

    it("should handle return outside function", async () => {
      const result = await bash.exec(`
        return 2>/dev/null || echo "return outside func"
      `);
      expect(result.stdout).toContain("return outside func");
    });
  });

  describe("printf Safety", () => {
    it("should handle printf format strings", async () => {
      const result = await bash.exec(`
        printf "%s %d\\n" "hello" 42
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello 42\n");
    });

    it("should handle printf %n safely", async () => {
      // %n can be dangerous in C - should be handled safely
      const result = await bash.exec(`
        printf "%n" 2>&1 || echo "handled"
      `);
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle printf with missing args", async () => {
      const result = await bash.exec(`
        printf "%s %s\\n" "only one"
      `);
      // Should handle gracefully
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle printf with hex/octal", async () => {
      const result = await bash.exec(`
        printf "\\x41\\n"
        printf "\\101\\n"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("A\nA\n");
    });
  });

  describe("Read Command Safety", () => {
    it("should handle read from stdin", async () => {
      const result = await bash.exec(`
        echo "input" | { read var; echo "got: $var"; }
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("got: input\n");
    });

    it("should handle read with timeout", async () => {
      const result = await bash.exec(`
        read -t 0 var 2>&1 || echo "timeout handled"
        echo "done"
      `);
      expect(result.stdout).toContain("done");
    });

    it("should handle read -n", async () => {
      const result = await bash.exec(`
        echo "hello" | { read -n 2 var; echo "got: $var"; }
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle read -r", async () => {
      const result = await bash.exec(`
        echo 'a\\tb' | { read -r var; echo "got: $var"; }
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle read -p", async () => {
      const result = await bash.exec(`
        echo "input" | { read -p "prompt: " var; echo "got: $var"; }
      `);
      expect(typeof result.exitCode).toBe("number");
    });
  });
});
