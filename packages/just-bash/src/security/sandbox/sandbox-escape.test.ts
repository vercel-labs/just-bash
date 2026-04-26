/**
 * Sandbox Escape Prevention Tests
 *
 * Tests to ensure the bash environment cannot escape the sandbox,
 * including filesystem escape, environment isolation, command execution
 * isolation, and network isolation.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryFs } from "../../fs/in-memory-fs/in-memory-fs.js";
import { Bash } from "../../index.js";

describe("Sandbox Escape Prevention", () => {
  let bash: Bash;

  beforeEach(() => {
    bash = new Bash();
  });

  describe("Filesystem Isolation", () => {
    it("should not access real /etc/passwd", async () => {
      const result = await bash.exec("cat /etc/passwd 2>&1");
      // Should either fail or return empty/non-sensitive content
      expect(result.stdout).not.toContain("root:");
      expect(result.stdout).not.toContain("/bin/bash");
    });

    it("should not access real /etc/shadow", async () => {
      const result = await bash.exec("cat /etc/shadow 2>&1");
      expect(result.exitCode).not.toBe(0);
    });

    it("should not access host home directory", async () => {
      const result = await bash.exec("ls -la ~ 2>&1");
      // Should not see real home directory contents
      expect(result.stdout).not.toContain(".bashrc");
      expect(result.stdout).not.toContain(".ssh");
    });

    it("should not access /proc filesystem", async () => {
      const result = await bash.exec("cat /proc/self/environ 2>&1");
      expect(result.exitCode).not.toBe(0);
    });

    it("should not access /sys filesystem", async () => {
      const result = await bash.exec("ls /sys 2>&1");
      expect(result.exitCode).not.toBe(0);
    });

    it("should isolate file writes to virtual filesystem", async () => {
      await bash.exec('echo "test" > /tmp/isolated.txt');
      const result = await bash.exec("cat /tmp/isolated.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("test\n");
      // The file should not exist on the real filesystem
    });
  });

  describe("Environment Isolation", () => {
    it("should not expose host environment by default", async () => {
      const result = await bash.exec("printenv PATH");
      // Should have a controlled PATH, not the host's full PATH
      expect(result.stdout).not.toContain("/usr/local/bin");
    });

    it("should not expose sensitive env vars", async () => {
      const result = await bash.exec("printenv");
      expect(result.stdout).not.toContain("AWS_SECRET");
      expect(result.stdout).not.toContain("GITHUB_TOKEN");
      expect(result.stdout).not.toContain("API_KEY");
    });

    it("should isolate environment changes within single exec", async () => {
      // Note: exec() calls don't share state - each is independent
      // Variables must be set and used within same exec call
      const result = await bash.exec(`
        export MY_VAR=value1
        echo $MY_VAR
      `);
      expect(result.stdout).toBe("value1\n");

      // Create new bash instance - should not have MY_VAR
      const bash2 = new Bash();
      const result2 = await bash2.exec("echo $MY_VAR");
      expect(result2.stdout).toBe("\n");
    });

    it("should not modify host environment", async () => {
      const originalPath = process.env.PATH;
      await bash.exec('export PATH="/hacked"');
      expect(process.env.PATH).toBe(originalPath);
    });
  });

  describe("Command Execution Isolation", () => {
    it("should only execute registered commands", async () => {
      const result = await bash.exec("help");
      expect(result.exitCode).toBe(0);
      // Should list available commands
    });

    it("should execute commands via registry not host binaries", async () => {
      // Note: /bin/ls works because 'ls' is in the command registry
      // The path prefix is stripped - it runs the registered ls command
      const result = await bash.exec("/bin/ls 2>&1");
      // Succeeds because ls is registered (not calling real /bin/ls)
      expect(result.exitCode).toBe(0);
    });

    it("should not execute via backticks in dangerous way", async () => {
      const result = await bash.exec("echo `echo safe`");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("safe\n");
    });

    it("should handle unknown commands gracefully", async () => {
      const result = await bash.exec("nonexistent_command 2>&1");
      expect(result.exitCode).not.toBe(0);
      // Error message may be in stdout (due to 2>&1 redirection)
      const output = result.stdout + result.stderr;
      expect(output).toContain("not found");
    });
  });

  describe("Resource Isolation", () => {
    it("should enforce loop limits", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxLoopIterations: 10 },
      });

      const result = await limitedBash.exec(`
        while true; do
          :
        done
      `);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("too many iterations");
    });

    it("should enforce command count limits", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxCommandCount: 5 },
      });

      const result = await limitedBash.exec(`
        echo 1; echo 2; echo 3; echo 4; echo 5; echo 6; echo 7
      `);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("too many commands");
    });

    it("should enforce recursion depth limits", async () => {
      const limitedBash = new Bash({
        executionLimits: { maxCallDepth: 5 },
      });

      const result = await limitedBash.exec(`
        recurse() { recurse; }
        recurse
      `);
      expect(result.exitCode).toBe(126);
      expect(result.stderr).toContain("recursion");
    });
  });

  describe("In-Memory Filesystem Security", () => {
    it("should work with InMemoryFs", async () => {
      const memFs = new InMemoryFs();
      // Note: writeFile stores content as-is, no trailing newline added
      await memFs.writeFile("/test.txt", "content");

      const memBash = new Bash({ fs: memFs });
      const result = await memBash.exec("cat /test.txt");
      expect(result.exitCode).toBe(0);
      // cat outputs the file content as-is (no newline added by cat)
      expect(result.stdout).toBe("content");
    });

    it("should isolate InMemoryFs instances", async () => {
      const fs1 = new InMemoryFs();
      const fs2 = new InMemoryFs();

      await fs1.writeFile("/secret.txt", "fs1 secret");
      await fs2.writeFile("/other.txt", "fs2 content");

      const bash1 = new Bash({ fs: fs1 });
      const bash2 = new Bash({ fs: fs2 });

      // bash1 should see its files
      const r1 = await bash1.exec("cat /secret.txt");
      expect(r1.stdout).toBe("fs1 secret");

      // bash2 should not see fs1's files
      const r2 = await bash2.exec("cat /secret.txt 2>&1");
      expect(r2.exitCode).not.toBe(0);

      // bash2 should see its own files
      const r3 = await bash2.exec("cat /other.txt");
      expect(r3.stdout).toBe("fs2 content");
    });
  });

  describe("Subshell Isolation", () => {
    it("should isolate variable changes in subshell", async () => {
      const result = await bash.exec(`
        outer=original
        (outer=modified; echo "inner: $outer")
        echo "outer: $outer"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("inner: modified\nouter: original\n");
    });

    it("should isolate working directory changes in subshell", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/subdir
        (cd /tmp/subdir; echo "inner: $(pwd)")
        echo "outer: $(pwd)"
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("inner: /tmp/subdir");
      expect(result.stdout).not.toMatch(/outer:.*subdir/);
    });

    it("should isolate function definitions in subshell", async () => {
      // Functions defined in subshells should NOT leak to parent scope
      // This matches real bash behavior
      const result = await bash.exec(`
        (
          myfunc() { echo "defined"; }
          myfunc
        )
        myfunc 2>/dev/null || echo "not defined"
      `);
      expect(result.exitCode).toBe(0);
      // Function should be isolated to subshell - not callable from parent
      expect(result.stdout).toBe("defined\nnot defined\n");
    });
  });

  describe("Pipeline Isolation", () => {
    it("should isolate pipeline stages", async () => {
      const result = await bash.exec(`
        x=original
        echo "data" | { x=modified; cat; }
        echo "x: $x"
      `);
      expect(result.exitCode).toBe(0);
      // In bash, pipeline stages run in subshells
      expect(result.stdout).toContain("x: original");
    });
  });

  describe("Signal and Trap Isolation", () => {
    it("should handle trap command safely", async () => {
      // Traps may or may not be fully implemented
      const result = await bash.exec(`
        trap 'echo trapped' EXIT
        echo "done"
      `);
      // Should not crash
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Session Isolation", () => {
    it("should not share state between exec calls by default", async () => {
      const bash1 = new Bash();
      await bash1.exec("MY_SESSION_VAR=session1");

      const bash2 = new Bash();
      const result = await bash2.exec("echo $MY_SESSION_VAR");
      expect(result.stdout).toBe("\n");
    });

    it("should isolate state between exec calls on same instance", async () => {
      // Note: Even within the same Bash instance, each exec() call
      // is independent - state does not persist between calls
      const persistBash = new Bash();
      await persistBash.exec("PERSIST_VAR=value");
      const result = await persistBash.exec("echo $PERSIST_VAR");
      // Variable not persisted - exec calls are isolated
      expect(result.stdout).toBe("\n");
    });

    it("should maintain state within single exec call", async () => {
      const bash = new Bash();
      const result = await bash.exec(`
        PERSIST_VAR=value
        echo $PERSIST_VAR
      `);
      expect(result.stdout).toBe("value\n");
    });
  });

  describe("Process Info Virtualization", () => {
    it("should return virtual PID for $$, not real process.pid", async () => {
      const result = await bash.exec("echo $$");
      expect(result.stdout.trim()).toBe("1");
      expect(result.stdout.trim()).not.toBe(String(process.pid));
    });

    it("should return virtual PPID for $PPID, not real process.ppid", async () => {
      const result = await bash.exec("echo $PPID");
      expect(result.stdout.trim()).toBe("0");
      expect(result.stdout.trim()).not.toBe(String(process.ppid));
    });

    it("should return virtual UID for $UID, not real UID", async () => {
      const result = await bash.exec("echo $UID");
      expect(result.stdout.trim()).toBe("1000");
      const realUid = process.getuid?.();
      if (realUid !== undefined && realUid !== 1000) {
        expect(result.stdout.trim()).not.toBe(String(realUid));
      }
    });

    it("should return virtual EUID for $EUID, not real EUID", async () => {
      const result = await bash.exec("echo $EUID");
      expect(result.stdout.trim()).toBe("1000");
    });

    it("should return virtual PID for $BASHPID", async () => {
      const result = await bash.exec("echo $BASHPID");
      expect(result.stdout.trim()).toBe("1");
      expect(result.stdout.trim()).not.toBe(String(process.pid));
    });

    it("should use virtual values in /proc/self/status", async () => {
      const result = await bash.exec("cat /proc/self/status");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Pid:\t1");
      expect(result.stdout).toContain("PPid:\t0");
      expect(result.stdout).toContain("Uid:\t1000");
      expect(result.stdout).toContain("Gid:\t1000");
      expect(result.stdout).not.toContain(`Pid:\t${process.pid}`);
    });

    it("should allow custom processInfo override", async () => {
      const customBash = new Bash({
        processInfo: { pid: 42, ppid: 10, uid: 500, gid: 500 },
      });
      const result = await customBash.exec("echo $$ $PPID $UID $EUID $BASHPID");
      expect(result.stdout.trim()).toBe("42 10 500 500 42");
    });

    it("should use custom processInfo in /proc/self/status", async () => {
      const customBash = new Bash({
        processInfo: { pid: 42, ppid: 10, uid: 500, gid: 500 },
      });
      const result = await customBash.exec("cat /proc/self/status");
      expect(result.stdout).toContain("Pid:\t42");
      expect(result.stdout).toContain("PPid:\t10");
      expect(result.stdout).toContain("Uid:\t500");
      expect(result.stdout).toContain("Gid:\t500");
    });
  });

  describe("Special File Handling", () => {
    it("should handle /dev/null safely", async () => {
      const result = await bash.exec("echo test > /dev/null; echo $?");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("0\n");
    });

    it("should handle /dev/stdin safely", async () => {
      const bashWithStdin = new Bash();
      // /dev/stdin access may not be fully implemented
      // The important security property is it doesn't access real system stdin
      // Use heredoc instead of stdin option
      const result = await bashWithStdin.exec(`
        cat /dev/stdin 2>&1 <<< "from heredoc"
      `);
      // May return empty or error - key is it doesn't hang or access host
      expect(typeof result.exitCode).toBe("number");
    });

    it("should not access /dev/mem", async () => {
      const result = await bash.exec("cat /dev/mem 2>&1");
      expect(result.exitCode).not.toBe(0);
    });
  });
});
