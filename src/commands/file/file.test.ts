import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("file", () => {
  describe("text files", () => {
    it("should detect ASCII text", async () => {
      const env = new Bash();
      await env.exec("echo 'hello world' > /tmp/test.txt");
      const result = await env.exec("file /tmp/test.txt");
      expect(result.stdout).toContain("ASCII text");
      expect(result.exitCode).toBe(0);
    });

    it("should detect empty files", async () => {
      const env = new Bash();
      await env.exec("touch /tmp/empty");
      const result = await env.exec("file /tmp/empty");
      expect(result.stdout).toContain("empty");
      expect(result.exitCode).toBe(0);
    });

    it("should detect CRLF line endings", async () => {
      const env = new Bash();
      // Use $'...' syntax or echo -e to properly create CRLF
      await env.exec("echo -e 'line1\\r\\nline2' > /tmp/crlf.txt");
      const result = await env.exec("file /tmp/crlf.txt");
      // The file command should detect CRLF line terminators
      expect(result.stdout).toContain("CRLF");
      expect(result.exitCode).toBe(0);
    });

    it("should detect shell scripts by shebang", async () => {
      const env = new Bash();
      await env.exec("echo '#!/bin/bash\\necho hello' > /tmp/script.sh");
      const result = await env.exec("file /tmp/script.sh");
      expect(result.stdout).toContain("shell script");
      expect(result.exitCode).toBe(0);
    });

    it("should detect Python scripts by shebang", async () => {
      const env = new Bash();
      await env.exec(
        "echo '#!/usr/bin/env python3\\nprint(1)' > /tmp/script.py",
      );
      const result = await env.exec("file /tmp/script.py");
      expect(result.stdout).toContain("Python");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("extension-based detection", () => {
    it("should detect TypeScript files", async () => {
      const env = new Bash();
      await env.exec("echo 'const x: number = 1;' > /tmp/test.ts");
      const result = await env.exec("file /tmp/test.ts");
      expect(result.stdout).toContain("TypeScript");
      expect(result.exitCode).toBe(0);
    });

    it("should detect JavaScript files", async () => {
      const env = new Bash();
      await env.exec("echo 'const x = 1;' > /tmp/test.js");
      const result = await env.exec("file /tmp/test.js");
      expect(result.stdout).toContain("JavaScript");
      expect(result.exitCode).toBe(0);
    });

    it("should detect JSON files", async () => {
      const env = new Bash();
      await env.exec('echo \'{"key": "value"}\' > /tmp/test.json');
      const result = await env.exec("file /tmp/test.json");
      expect(result.stdout).toContain("JSON");
      expect(result.exitCode).toBe(0);
    });

    it("should detect Markdown files", async () => {
      const env = new Bash();
      await env.exec("echo '# Hello' > /tmp/test.md");
      const result = await env.exec("file /tmp/test.md");
      expect(result.stdout).toContain("Markdown");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("directories", () => {
    it("should detect directories", async () => {
      const env = new Bash();
      await env.exec("mkdir -p /tmp/testdir");
      const result = await env.exec("file /tmp/testdir");
      expect(result.stdout).toContain("directory");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("options", () => {
    it("should support -b (brief) mode", async () => {
      const env = new Bash();
      await env.exec("echo 'hello' > /tmp/test.txt");
      const result = await env.exec("file -b /tmp/test.txt");
      expect(result.stdout).not.toContain("/tmp/test.txt:");
      expect(result.stdout).toContain("ASCII text");
      expect(result.exitCode).toBe(0);
    });

    it("should support -i (mime) mode", async () => {
      const env = new Bash();
      await env.exec("echo 'hello' > /tmp/test.txt");
      const result = await env.exec("file -i /tmp/test.txt");
      expect(result.stdout).toContain("text/plain");
      expect(result.exitCode).toBe(0);
    });

    it("should support combined -bi mode", async () => {
      const env = new Bash();
      await env.exec("mkdir -p /tmp/mimedir");
      const result = await env.exec("file -bi /tmp/mimedir");
      expect(result.stdout).toBe("inode/directory\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("multiple files", () => {
    it("should handle multiple files", async () => {
      const env = new Bash();
      await env.exec("echo 'text' > /tmp/a.txt");
      await env.exec("echo 'more' > /tmp/b.txt");
      const result = await env.exec("file /tmp/a.txt /tmp/b.txt");
      expect(result.stdout).toContain("/tmp/a.txt:");
      expect(result.stdout).toContain("/tmp/b.txt:");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should error on missing file", async () => {
      const env = new Bash();
      const result = await env.exec("file /tmp/nonexistent");
      expect(result.stdout).toContain("cannot open");
      expect(result.exitCode).toBe(1);
    });

    it("should error with no arguments", async () => {
      const env = new Bash();
      const result = await env.exec("file");
      expect(result.stderr).toContain("Usage");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("--help", () => {
    it("should display help", async () => {
      const env = new Bash();
      const result = await env.exec("file --help");
      expect(result.stdout).toContain("file");
      expect(result.stdout).toContain("determine file type");
      expect(result.exitCode).toBe(0);
    });
  });
});
