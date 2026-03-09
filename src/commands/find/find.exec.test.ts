import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("find -exec", () => {
  describe("-exec command {} ;", () => {
    it("should execute command for each found file", async () => {
      const env = new Bash({
        files: {
          "/dir/a.txt": "content a",
          "/dir/b.txt": "content b",
        },
      });
      const result = await env.exec('find /dir -name "*.txt" -exec cat {} \\;');
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("content acontent b");
      expect(result.stderr).toBe("");
    });

    it("should execute echo for each file", async () => {
      const env = new Bash({
        files: {
          "/dir/file1.txt": "",
          "/dir/file2.txt": "",
        },
      });
      const result = await env.exec(
        'find /dir -name "*.txt" -exec echo Found: {} \\;',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(
        "Found: /dir/file1.txt\nFound: /dir/file2.txt\n",
      );
      expect(result.stderr).toBe("");
    });

    it("should handle multiple {} replacements", async () => {
      const env = new Bash({
        files: { "/dir/test.txt": "" },
      });
      const result = await env.exec(
        'find /dir -name "test.txt" -exec echo {} is {} \\;',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("/dir/test.txt is /dir/test.txt\n");
      expect(result.stderr).toBe("");
    });

    it("should propagate command exit codes", async () => {
      const env = new Bash({
        files: { "/dir/file.txt": "" },
      });
      const result = await env.exec(
        'find /dir -name "file.txt" -exec cat /nonexistent \\;',
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("No such file");
    });
  });

  describe("-exec command {} +", () => {
    it("should execute command once with all files", async () => {
      const env = new Bash({
        files: {
          "/dir/a.txt": "",
          "/dir/b.txt": "",
          "/dir/c.txt": "",
        },
      });
      const result = await env.exec('find /dir -name "*.txt" -exec echo {} +');
      expect(result.exitCode).toBe(0);
      // All files should be in a single echo output
      expect(result.stdout).toBe("/dir/a.txt /dir/b.txt /dir/c.txt\n");
      expect(result.stderr).toBe("");
    });

    it("should work with ls command in batch mode", async () => {
      const env = new Bash({
        files: {
          "/dir/file1.txt": "content1",
          "/dir/file2.txt": "content2",
        },
      });
      const result = await env.exec("find /dir -type f -exec ls {} +");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("/dir/file1.txt\n\n/dir/file2.txt\n");
      expect(result.stderr).toBe("");
    });
  });

  describe("error handling", () => {
    it("should error on missing terminator", async () => {
      const env = new Bash({
        files: { "/dir/file.txt": "" },
      });
      const result = await env.exec(
        'find /dir -name "*.txt" -exec echo {} foo',
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("-exec");
    });

    it("should not print files when -exec is used", async () => {
      const env = new Bash({
        files: {
          "/dir/a.txt": "",
          "/dir/b.txt": "",
        },
      });
      const result = await env.exec(
        'find /dir -name "*.txt" -exec echo found \\;',
      );
      expect(result.exitCode).toBe(0);
      // Should only contain "found" messages, not the file paths from default print
      expect(result.stdout).toBe("found\nfound\n");
    });

    it("should handle no matching files", async () => {
      const env = new Bash({
        files: { "/dir/file.txt": "" },
      });
      const result = await env.exec(
        'find /dir -name "*.log" -exec echo {} \\;',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("");
    });
  });

  describe("combined with other predicates", () => {
    it("should work with -type f", async () => {
      const env = new Bash({
        files: {
          "/dir/file.txt": "content",
          "/dir/subdir/nested.txt": "",
        },
      });
      const result = await env.exec(
        'find /dir -type f -name "*.txt" -exec cat {} \\;',
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("content");
      expect(result.stderr).toBe("");
    });

    it("should work with -maxdepth", async () => {
      const env = new Bash({
        files: {
          "/dir/file.txt": "top",
          "/dir/sub/file.txt": "nested",
        },
      });
      const result = await env.exec(
        "find /dir -maxdepth 1 -type f -exec cat {} \\;",
      );
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("top");
    });
  });

  describe("filename shell injection (bug)", () => {
    it("$() in a filename must not be evaluated as a command substitution", async () => {
      // find.ts wrapped paths in double-quotes without escaping content:
      //   const cmd = cmdWithFiles.map((p) => `"${p}"`).join(" ");
      // Double-quotes do not suppress $() expansion, so a filename containing
      // "$(cmd)" causes cmd to run. Use the FS API to plant the literal name;
      // then check whether the injected mkdir side-effect directory was created.
      // Correct behaviour: /tmp/DOLLAR_HACKED must not exist after the find.
      const bash = new Bash({
        files: {
          "/tmp/evil/$(mkdir -p /tmp/DOLLAR_HACKED)": "",
        },
      });
      const result = await bash.exec(`
        find /tmp/evil -exec echo {} \\;
        if [ -d /tmp/DOLLAR_HACKED ]; then echo INJECTION_SUCCEEDED; else echo INJECTION_BLOCKED; fi
      `);
      expect(result.stdout).toContain("INJECTION_BLOCKED");
      expect(result.stdout).not.toContain("INJECTION_SUCCEEDED");
    });

    it("backtick in a filename must not be evaluated as a command substitution", async () => {
      // Same root cause as $() above, using backtick syntax instead.
      // Write the file via the FS API so the name contains literal unescaped
      // backticks – exactly what an attacker could plant on a real filesystem.
      // find.ts assembled: "echo" "/tmp/bt/`mkdir -p /tmp/BACKTICK_HACKED`"
      // Inside double-quotes unescaped backticks are evaluated → mkdir runs.
      // Correct behaviour: /tmp/BACKTICK_HACKED must not exist after the find.
      const bash = new Bash({
        files: {
          "/tmp/bt/`mkdir -p /tmp/BACKTICK_HACKED`": "",
        },
      });
      const result = await bash.exec(`
        find /tmp/bt -exec echo {} \\;
        if [ -d /tmp/BACKTICK_HACKED ]; then echo INJECTION_SUCCEEDED; else echo INJECTION_BLOCKED; fi
      `);
      expect(result.stdout).toContain("INJECTION_BLOCKED");
      expect(result.stdout).not.toContain("INJECTION_SUCCEEDED");
    });
  });
});
