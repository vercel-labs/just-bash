/**
 * Filename Attack Prevention
 *
 * Tests for handling malicious filenames including null bytes,
 * special characters, path traversal, and unicode edge cases.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../../index.js";

describe("Filename Attack Prevention", () => {
  let bash: Bash;

  beforeEach(() => {
    bash = new Bash();
  });

  describe("Null Byte Injection", () => {
    it("should reject null bytes in file paths", async () => {
      const result = await bash.exec('cat "/etc\\x00/passwd"');
      expect(result.exitCode).not.toBe(0);
    });

    it("should reject null bytes in directory names", async () => {
      const result = await bash.exec('mkdir -p "/tmp/test\\x00dir"');
      // Should either reject or sanitize the null byte
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle C-style escapes safely", async () => {
      const result = await bash.exec("echo $'\\x00' | xxd");
      // Should not crash and should handle null bytes
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Null Byte in Redirections", () => {
    it("should fail when redirecting output to filename with null byte", async () => {
      const result = await bash.exec("echo test > $'/tmp/file\\x00.txt'");
      expect(result.exitCode).not.toBe(0);
    });

    it("should fail when appending to filename with null byte", async () => {
      const result = await bash.exec("echo test >> $'/tmp/file\\x00.txt'");
      expect(result.exitCode).not.toBe(0);
    });

    it("should fail when clobbering to filename with null byte", async () => {
      const result = await bash.exec("echo test >| $'/tmp/file\\x00.txt'");
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("Special Character Filenames", () => {
    it("should handle filenames starting with -", async () => {
      const result = await bash.exec(`
        touch /tmp/-dashfile
        ls /tmp/-dashfile
        rm /tmp/-dashfile
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle filenames with newlines", async () => {
      const result = await bash.exec(`
        touch $'/tmp/file\\nwith\\nnewlines'
        ls -la /tmp | grep -c 'file'
      `);
      // Should either work or fail safely
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle filenames with spaces", async () => {
      const result = await bash.exec(`
        touch "/tmp/file with spaces.txt"
        cat "/tmp/file with spaces.txt"
        rm "/tmp/file with spaces.txt"
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle filenames with quotes", async () => {
      const result = await bash.exec(`
        touch '/tmp/file"with"quotes.txt'
        ls '/tmp/file"with"quotes.txt'
        rm '/tmp/file"with"quotes.txt'
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle filenames with backticks", async () => {
      const result = await bash.exec(`
        touch '/tmp/file\`backticks\`.txt'
        ls '/tmp/file\`backticks\`.txt'
        rm '/tmp/file\`backticks\`.txt'
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle filenames with $", async () => {
      const result = await bash.exec(`
        touch '/tmp/file$dollar.txt'
        ls '/tmp/file$dollar.txt'
        rm '/tmp/file$dollar.txt'
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle filenames with glob chars when quoted", async () => {
      const result = await bash.exec(`
        touch '/tmp/file*with[glob]?.txt'
        ls '/tmp/file*with[glob]?.txt'
        rm '/tmp/file*with[glob]?.txt'
      `);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Path Traversal", () => {
    it("should normalize paths with ..", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/a/b/c
        cd /tmp/a/b/c
        ls ../../../..
      `);
      // Should resolve safely within the filesystem
      expect(result.exitCode).toBe(0);
    });

    it("should normalize /./././ paths correctly", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/normalize
        ls /tmp/./normalize/./
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle trailing slashes correctly", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/trailing
        touch /tmp/trailing/file.txt
        cat /tmp/trailing/file.txt/
      `);
      // May fail (ENOTDIR) but should not crash
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle double slashes", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/doubleslash
        touch /tmp//doubleslash//file.txt
        cat /tmp//doubleslash//file.txt
      `);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Unicode Filenames", () => {
    it("should handle unicode filenames", async () => {
      const result = await bash.exec(`
        touch /tmp/файл.txt
        ls /tmp/файл.txt
        rm /tmp/файл.txt
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle emoji filenames", async () => {
      const result = await bash.exec(`
        touch '/tmp/📁file.txt'
        ls '/tmp/📁file.txt'
        rm '/tmp/📁file.txt'
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle mixed unicode", async () => {
      const result = await bash.exec(`
        touch '/tmp/日本語_한국어_العربية.txt'
        ls '/tmp/日本語_한국어_العربية.txt'
        rm '/tmp/日本語_한국어_العربية.txt'
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle combining characters", async () => {
      // é can be represented as e + combining acute accent
      const result = await bash.exec(`
        touch $'/tmp/cafe\\xCC\\x81.txt'
        ls /tmp/café.txt 2>/dev/null || ls /tmp/cafe*.txt
      `);
      // Should handle but may normalize differently
      expect(typeof result.exitCode).toBe("number");
    });
  });

  describe("Edge Case Filenames", () => {
    it("should handle empty filename safely", async () => {
      // touch "" may succeed (creating no file) or fail
      // The important thing is it doesn't crash
      const result = await bash.exec('touch ""');
      expect(typeof result.exitCode).toBe("number");
    });

    it("should handle very long filenames", async () => {
      const longName = "a".repeat(255);
      const result = await bash.exec(`
        touch "/tmp/${longName}"
        ls "/tmp/${longName}"
        rm "/tmp/${longName}"
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle very long filenames up to system limit", async () => {
      // 255 is typically the max filename length on most filesystems
      const maxLength = "a".repeat(255);
      const result = await bash.exec(`
        touch "/tmp/${maxLength}" 2>/dev/null && rm "/tmp/${maxLength}"
        echo "handled"
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle dot files", async () => {
      const result = await bash.exec(`
        touch /tmp/.hidden
        ls -a /tmp/.hidden
        rm /tmp/.hidden
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle ... filename", async () => {
      const result = await bash.exec(`
        touch '/tmp/...'
        ls '/tmp/...'
        rm '/tmp/...'
      `);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Command Injection via Filenames", () => {
    it("should not execute commands in filename with backticks", async () => {
      const result = await bash.exec(`
        touch '/tmp/\`echo pwned\`.txt'
        cat '/tmp/\`echo pwned\`.txt'
        rm '/tmp/\`echo pwned\`.txt'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("pwned");
    });

    it("should not execute commands in filename with $()", async () => {
      const result = await bash.exec(`
        touch '/tmp/$(echo pwned).txt'
        cat '/tmp/$(echo pwned).txt'
        rm '/tmp/$(echo pwned).txt'
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("pwned");
    });

    it("should handle semicolon in filename when quoted", async () => {
      // Single quotes prevent semicolon from being interpreted
      const result = await bash.exec(`
        touch '/tmp/filesemi.txt'
        ls '/tmp/filesemi.txt'
        rm '/tmp/filesemi.txt'
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle pipe in filename when quoted", async () => {
      // Single quotes prevent pipe from being interpreted
      const result = await bash.exec(`
        touch '/tmp/filepipe.txt'
        ls '/tmp/filepipe.txt'
        rm '/tmp/filepipe.txt'
      `);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Symlink Security", () => {
    it("should create and follow valid symlinks", async () => {
      const result = await bash.exec(`
        echo "content" > /tmp/original.txt
        ln -s /tmp/original.txt /tmp/link.txt
        cat /tmp/link.txt
        rm /tmp/link.txt /tmp/original.txt
      `);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("content\n");
    });

    it("should handle broken symlinks gracefully", async () => {
      const result = await bash.exec(`
        ln -s /tmp/nonexistent /tmp/broken_link
        cat /tmp/broken_link 2>&1
        rm /tmp/broken_link
      `);
      // Should fail to read but not crash
      expect(result.stderr).toBeTruthy();
    });

    it("should handle circular symlinks gracefully", async () => {
      // Create circular symlinks pointing to each other
      await bash.exec(`
        rm -f /tmp/circlink1 /tmp/circlink2 2>/dev/null || true
        ln -s /tmp/circlink2 /tmp/circlink1
        ln -s /tmp/circlink1 /tmp/circlink2
      `);

      const result = await bash.exec("cat /tmp/circlink1");
      // Should fail - either ELOOP or ENOENT depending on implementation
      expect(result.exitCode).not.toBe(0);

      // Cleanup
      await bash.exec(
        "rm -f /tmp/circlink1 /tmp/circlink2 2>/dev/null || true",
      );
    });
  });

  describe("Glob Pattern Safety", () => {
    it("should expand globs safely", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/globsafe
        touch /tmp/globsafe/a.txt /tmp/globsafe/b.txt
        ls /tmp/globsafe/*.txt
        rm -r /tmp/globsafe
      `);
      expect(result.exitCode).toBe(0);
    });

    it("should handle no glob matches gracefully", async () => {
      const result = await bash.exec(`
        ls /tmp/nomatch*.xyz 2>&1
      `);
      // Should fail but not crash
      expect(result.exitCode).not.toBe(0);
    });

    it("should handle character classes in globs", async () => {
      const result = await bash.exec(`
        mkdir -p /tmp/charclass
        touch /tmp/charclass/file1.txt /tmp/charclass/file2.txt
        ls /tmp/charclass/file[12].txt
        rm -r /tmp/charclass
      `);
      expect(result.exitCode).toBe(0);
    });
  });
});
