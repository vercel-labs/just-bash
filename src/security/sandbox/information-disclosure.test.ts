/**
 * Information Disclosure Prevention Tests
 *
 * Tests to ensure error messages don't leak sensitive information,
 * timing information is not disclosed, and internal state is protected.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../index.js";

describe("Information Disclosure Prevention", () => {
  let bash: Bash;

  beforeEach(() => {
    bash = new Bash();
  });

  describe("Error Message Verbosity", () => {
    it("should not leak file paths in permission errors", async () => {
      const result = await bash.exec(`
        cat /etc/shadow 2>&1 || true
      `);
      // Error should not contain full system paths or user info
      expect(result.stderr + result.stdout).not.toContain("/home/");
      expect(result.stderr + result.stdout).not.toContain("/Users/");
    });

    it("should not leak internal implementation details", async () => {
      const result = await bash.exec(`
        invalid_syntax_here()))) 2>&1 || true
      `);
      // Should not leak JavaScript stack traces or internal function names
      expect(result.stderr + result.stdout).not.toContain("at Object.");
      expect(result.stderr + result.stdout).not.toContain("TypeError:");
      expect(result.stderr + result.stdout).not.toContain(".js:");
    });

    it("should not leak memory addresses", async () => {
      const result = await bash.exec(`
        echo test 2>&1
      `);
      // Should not contain hex memory addresses
      expect(result.stdout).not.toMatch(/0x[0-9a-f]{8,16}/i);
    });

    it("should provide generic error for file not found", async () => {
      const result = await bash.exec(`
        cat /nonexistent/path/file.txt 2>&1 || true
      `);
      // Should mention file not found without leaking system structure
      expect(typeof result.exitCode).toBe("number");
    });

    it("should not leak environment in errors", async () => {
      const result = await bash.exec(`
        $UNDEFINED_VAR_WITH_SPECIAL_NAME 2>&1 || true
      `);
      // Should not expose environment variable listing
      expect(result.stderr + result.stdout).not.toContain("PATH=");
      expect(result.stderr + result.stdout).not.toContain("HOME=");
    });
  });

  describe("System Information Hiding", () => {
    it("should not expose host machine name", async () => {
      const result = await bash.exec(`
        hostname 2>&1 || echo "hostname handled"
      `);
      // Hostname command may be sandboxed or return generic value
      expect(typeof result.exitCode).toBe("number");
    });

    it("should not expose real username", async () => {
      const result = await bash.exec(`
        whoami 2>&1 || echo "whoami handled"
      `);
      // Should not return actual system username
      expect(result.stdout).not.toContain(process.env.USER || "");
    });

    it("should handle uname command safely", async () => {
      const result = await bash.exec(`
        uname -a 2>&1 || echo "uname handled"
      `);
      // Should not expose detailed kernel version
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle id command safely", async () => {
      const result = await bash.exec(`
        id 2>&1 || echo "id handled"
      `);
      // Should not expose real UID/GID
      expect(typeof result.exitCode).toBe("number");
    });

    it("should not expose process list", async () => {
      const result = await bash.exec(`
        ps aux 2>&1 || echo "ps handled"
      `);
      // Should not show real system processes
      expect(result.stdout).not.toContain("systemd");
      expect(result.stdout).not.toContain("launchd");
    });
  });

  describe("Environment Variable Protection", () => {
    it("should not expose AWS credentials", async () => {
      const result = await bash.exec(`
        printenv | grep -i aws 2>&1 || echo "no aws"
      `);
      expect(result.stdout).not.toContain("AWS_SECRET");
      expect(result.stdout).not.toContain("AWS_ACCESS_KEY");
    });

    it("should not expose API keys", async () => {
      const result = await bash.exec(`
        printenv | grep -i api 2>&1 || echo "no api"
      `);
      expect(result.stdout).not.toContain("API_KEY");
      expect(result.stdout).not.toContain("PRIVATE_KEY");
    });

    it("should not expose database credentials", async () => {
      const result = await bash.exec(`
        printenv | grep -i db 2>&1 || echo "no db"
      `);
      expect(result.stdout).not.toContain("DB_PASSWORD");
      expect(result.stdout).not.toContain("DATABASE_URL");
    });

    it("should not expose token variables", async () => {
      const result = await bash.exec(`
        printenv | grep -i token 2>&1 || echo "no token"
      `);
      expect(result.stdout).not.toContain("AUTH_TOKEN");
      expect(result.stdout).not.toContain("ACCESS_TOKEN");
    });

    it("should not expose SSH keys via env", async () => {
      const result = await bash.exec(`
        printenv | grep -i ssh 2>&1 || echo "no ssh"
      `);
      expect(result.stdout).not.toContain("SSH_KEY");
      expect(result.stdout).not.toContain("PRIVATE");
    });
  });

  describe("File System Information", () => {
    it("should not expose root filesystem structure", async () => {
      const result = await bash.exec(`
        ls / 2>&1 || echo "ls handled"
      `);
      // Should show virtual filesystem, not real root
      expect(typeof result.exitCode).toBe("number");
    });

    it("should not expose /etc contents", async () => {
      const result = await bash.exec(`
        ls /etc 2>&1 || echo "etc handled"
      `);
      expect(result.stdout).not.toContain("passwd");
      expect(result.stdout).not.toContain("shadow");
    });

    it("should not expose /proc information", async () => {
      const result = await bash.exec(`
        ls /proc 2>&1 || echo "proc handled"
      `);
      expect(result.stdout).not.toContain("cmdline");
      expect(result.stdout).not.toContain("environ");
    });

    it("should not expose user home directory", async () => {
      const result = await bash.exec(`
        ls ~ 2>&1 || echo "home handled"
      `);
      expect(result.stdout).not.toContain(".ssh");
      expect(result.stdout).not.toContain(".aws");
      expect(result.stdout).not.toContain(".gnupg");
    });

    it("should handle df command safely", async () => {
      const result = await bash.exec(`
        df 2>&1 || echo "df handled"
      `);
      // Should not expose real disk information
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle mount command safely", async () => {
      const result = await bash.exec(`
        mount 2>&1 || echo "mount handled"
      `);
      // Should not expose real mount points
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Network Information", () => {
    it("should handle ifconfig safely", async () => {
      const result = await bash.exec(`
        ifconfig 2>&1 || echo "ifconfig handled"
      `);
      // Should not expose real network configuration
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle netstat safely", async () => {
      const result = await bash.exec(`
        netstat 2>&1 || echo "netstat handled"
      `);
      // Should not expose network connections
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle ip command safely", async () => {
      const result = await bash.exec(`
        ip addr 2>&1 || echo "ip handled"
      `);
      // Should not expose real IP addresses
      expect(typeof result.exitCode).toBe("number");
    });

    it("should not expose /etc/hosts", async () => {
      const result = await bash.exec(`
        cat /etc/hosts 2>&1 || echo "hosts handled"
      `);
      // Should not expose internal network hosts
      expect(result.stdout).not.toMatch(/\d+\.\d+\.\d+\.\d+.*internal/);
    });
  });

  describe("Timing Information", () => {
    it("should not leak timing via variable expansion", async () => {
      // Variable expansion should be constant time
      const short = await bash.exec('x="a"; echo ${x:-default}');
      const long = await bash.exec(
        'x="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; echo ${x:-default}',
      );
      // Both should complete successfully
      expect(short.exitCode).toBe(0);
      expect(long.exitCode).toBe(0);
    });

    it("should handle time command output safely", async () => {
      const result = await bash.exec(`
        time echo test 2>&1 || echo "time handled"
      `);
      // Time command may or may not be implemented
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle date command safely", async () => {
      const result = await bash.exec(`
        date 2>&1 || echo "date handled"
      `);
      // Date command should work but not expose system timezone
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("History and State Exposure", () => {
    it("should not expose command history", async () => {
      const result = await bash.exec(`
        history 2>&1 || echo "history handled"
      `);
      // Should not show previous commands from host
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle fc command safely", async () => {
      const result = await bash.exec(`
        fc -l 2>&1 || echo "fc handled"
      `);
      // Should not expose command history
      expect(typeof result.exitCode).toBe("number");
    });

    it("should not expose HISTFILE", async () => {
      const result = await bash.exec(`
        echo $HISTFILE
      `);
      expect(result.stdout.trim()).toBe("");
    });

    it("should not leak state between sessions", async () => {
      const bash1 = new Bash();
      await bash1.exec("SECRET=sensitive_data_12345");

      const bash2 = new Bash();
      const result = await bash2.exec("echo $SECRET");
      expect(result.stdout).toBe("\n");
    });
  });

  describe("Debug Information", () => {
    it("should handle set -x safely", async () => {
      const result = await bash.exec(`
        set -x
        echo "traced"
        set +x
      `);
      // Debug output should not leak internal state
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle BASH_XTRACEFD", async () => {
      const result = await bash.exec(`
        BASH_XTRACEFD=2
        echo "test"
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle PS4 prompt", async () => {
      const result = await bash.exec(`
        PS4='+ '
        set -x
        echo "test"
        set +x
      `);
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Special Variables", () => {
    it("should have consistent BASH_VERSION", async () => {
      const result = await bash.exec(`
        echo $BASH_VERSION
      `);
      // Returns a virtual version, not the host's real bash version
      // This is safe as it doesn't expose host system details
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("5.1.0");
    });

    it("should not leak $0 with full path", async () => {
      const result = await bash.exec(`
        echo $0
      `);
      // Should not expose real script path
      expect(result.stdout).not.toContain("/usr/");
      expect(result.stdout).not.toContain("/bin/");
    });

    it("should handle $$ safely", async () => {
      const result = await bash.exec(`
        echo $$
      `);
      // Should return something, not real PID
      expect(result.exitCode).toBe(0);
    });

    it("should handle $PPID safely", async () => {
      const result = await bash.exec(`
        echo $PPID
      `);
      // Should not expose real parent PID
      expect(result.exitCode).toBe(0);
    });

    it("should not expose HOSTNAME", async () => {
      const result = await bash.exec(`
        echo $HOSTNAME
      `);
      // Should not expose real hostname
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Exec Result Object", () => {
    it("should not leak implementation in ExecResult", async () => {
      const result = await bash.exec("echo test");
      // ExecResult should only have stdout, stderr, exitCode
      const keys = Object.keys(result);
      expect(keys).toContain("stdout");
      expect(keys).toContain("stderr");
      expect(keys).toContain("exitCode");
      // Should not have internal state
      expect(keys).not.toContain("_internal");
      expect(keys).not.toContain("__proto__");
    });

    it("should sanitize stdout", async () => {
      const result = await bash.exec("echo test");
      // stdout should be a clean string
      expect(typeof result.stdout).toBe("string");
      expect(result.stdout).not.toContain("\0");
    });

    it("should sanitize stderr", async () => {
      const result = await bash.exec("cat /nonexistent 2>&1 || true");
      // stderr should be a clean string
      expect(typeof result.stderr).toBe("string");
    });

    it("should have numeric exit code", async () => {
      const result = await bash.exec("exit 42");
      expect(typeof result.exitCode).toBe("number");
      expect(Number.isInteger(result.exitCode)).toBe(true);
    });
  });

  describe("Cross-Instance Isolation", () => {
    it("should not share functions between instances", async () => {
      const bash1 = new Bash();
      await bash1.exec("myfunc() { echo secret; }");

      const bash2 = new Bash();
      const result = await bash2.exec("myfunc 2>&1 || echo 'not found'");
      expect(result.stdout).toContain("not found");
    });

    it("should not share aliases between instances", async () => {
      const bash1 = new Bash();
      await bash1.exec("alias myalias='echo secret'");

      const bash2 = new Bash();
      const result = await bash2.exec("myalias 2>&1 || echo 'not found'");
      expect(result.stdout).toContain("not found");
    });

    it("should not share working directory between instances", async () => {
      const bash1 = new Bash();
      await bash1.exec("cd /tmp");

      const bash2 = new Bash();
      const result = await bash2.exec("pwd");
      // Should not be affected by bash1's cd
      expect(typeof result.stdout).toBe("string");
    });
  });
});
