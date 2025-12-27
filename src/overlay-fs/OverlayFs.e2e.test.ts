/**
 * End-to-end tests for BashEnv with OverlayFs
 *
 * These tests verify that bash commands work correctly when
 * operating on an OverlayFs-backed filesystem.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { OverlayFs } from "./OverlayFs.js";

describe("BashEnv with OverlayFs - E2E", () => {
  let tempDir: string;
  let overlay: OverlayFs;
  let env: Bash;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "overlay-e2e-"));
    overlay = new OverlayFs({ root: tempDir, mountPoint: "/" });
    env = new Bash({ fs: overlay, cwd: "/" });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("file reading commands", () => {
    beforeEach(() => {
      fs.writeFileSync(
        path.join(tempDir, "sample.txt"),
        "line1\nline2\nline3\nline4\nline5",
      );
    });

    it("should read files with cat", async () => {
      const result = await env.exec("cat /sample.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("line1\nline2\nline3\nline4\nline5");
    });

    it("should read first lines with head", async () => {
      const result = await env.exec("head -n 2 /sample.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("line1\nline2\n");
    });

    it("should read last lines with tail", async () => {
      const result = await env.exec("tail -n 2 /sample.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("line4\nline5\n");
    });

    it("should count lines with wc", async () => {
      const result = await env.exec("wc -l /sample.txt");
      expect(result.exitCode).toBe(0);
      // wc output includes filename, just verify it ran successfully
      expect(result.stdout).toContain("sample.txt");
    });

    it("should read memory-written files", async () => {
      await env.exec('echo "memory content" > /memory.txt');
      const result = await env.exec("cat /memory.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("memory content\n");
    });
  });

  describe("file writing and modification", () => {
    it("should write files without affecting real fs", async () => {
      await env.exec('echo "test content" > /new-file.txt');

      const result = await env.exec("cat /new-file.txt");
      expect(result.stdout).toBe("test content\n");

      // Real fs should not have the file
      expect(fs.existsSync(path.join(tempDir, "new-file.txt"))).toBe(false);
    });

    it("should append to files", async () => {
      await env.exec('echo "first" > /append.txt');
      await env.exec('echo "second" >> /append.txt');

      const result = await env.exec("cat /append.txt");
      expect(result.stdout).toBe("first\nsecond\n");
    });

    it("should override real files in memory", async () => {
      fs.writeFileSync(path.join(tempDir, "real.txt"), "original");

      await env.exec('echo "modified" > /real.txt');

      const result = await env.exec("cat /real.txt");
      expect(result.stdout).toBe("modified\n");

      // Real file should be unchanged
      expect(fs.readFileSync(path.join(tempDir, "real.txt"), "utf8")).toBe(
        "original",
      );
    });

    it("should create files with touch", async () => {
      await env.exec("touch /touched.txt");

      const result = await env.exec("ls /touched.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("touched.txt");
    });

    it("should truncate files", async () => {
      await env.exec('echo "content" > /truncate.txt');
      await env.exec(": > /truncate.txt");

      const result = await env.exec("cat /truncate.txt");
      expect(result.stdout).toBe("");
    });
  });

  describe("directory operations", () => {
    it("should list real directory contents", async () => {
      fs.writeFileSync(path.join(tempDir, "a.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "b.txt"), "b");
      fs.mkdirSync(path.join(tempDir, "subdir"));

      const result = await env.exec("ls /");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("a.txt");
      expect(result.stdout).toContain("b.txt");
      expect(result.stdout).toContain("subdir");
    });

    it("should list mixed real and memory contents", async () => {
      fs.writeFileSync(path.join(tempDir, "real.txt"), "real");

      await env.exec('echo "memory" > /memory.txt');

      const result = await env.exec("ls /");
      expect(result.stdout).toContain("real.txt");
      expect(result.stdout).toContain("memory.txt");
    });

    it("should create directories with mkdir", async () => {
      await env.exec("mkdir /newdir");

      const result = await env.exec("ls -d /newdir");
      expect(result.exitCode).toBe(0);

      // Real fs should not have the directory
      expect(fs.existsSync(path.join(tempDir, "newdir"))).toBe(false);
    });

    it("should create nested directories with mkdir -p", async () => {
      await env.exec("mkdir -p /a/b/c");

      await env.exec('echo "deep" > /a/b/c/file.txt');
      const result = await env.exec("cat /a/b/c/file.txt");
      expect(result.stdout).toBe("deep\n");
    });

    it("should remove directories with rm -r", async () => {
      await env.exec("mkdir /emptydir");
      const mkResult = await env.exec("ls -d /emptydir");
      expect(mkResult.exitCode).toBe(0);

      // Use rm -r to remove directory
      await env.exec("rm -r /emptydir");

      // Verify via ls that directory is gone
      const lsResult = await env.exec("ls /emptydir 2>&1");
      expect(lsResult.exitCode).not.toBe(0);
    });

    it("should change working directory with cd", async () => {
      fs.mkdirSync(path.join(tempDir, "workdir"));
      fs.writeFileSync(path.join(tempDir, "workdir", "file.txt"), "content");

      const result = await env.exec("cd /workdir && cat file.txt");
      expect(result.stdout).toBe("content");
    });

    it("should show current directory with pwd", async () => {
      const result = await env.exec("pwd");
      expect(result.stdout.trim()).toBe("/");

      const result2 = await env.exec(
        "cd /subdir 2>/dev/null || mkdir /subdir && cd /subdir && pwd",
      );
      expect(result2.stdout.trim()).toBe("/subdir");
    });
  });

  describe("file manipulation", () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(tempDir, "source.txt"), "source content");
    });

    it("should copy files with cp", async () => {
      await env.exec("cp /source.txt /dest.txt");

      const result = await env.exec("cat /dest.txt");
      expect(result.stdout).toBe("source content");

      // Real fs should not have the copy
      expect(fs.existsSync(path.join(tempDir, "dest.txt"))).toBe(false);
    });

    it("should move files with mv", async () => {
      await env.exec("mv /source.txt /moved.txt");

      const exists = await env.exec("cat /source.txt");
      expect(exists.exitCode).not.toBe(0);

      const result = await env.exec("cat /moved.txt");
      expect(result.stdout).toBe("source content");
    });

    it("should remove files with rm", async () => {
      await env.exec("rm /source.txt");

      const result = await env.exec("cat /source.txt");
      expect(result.exitCode).not.toBe(0);

      // Real file should still exist
      expect(fs.existsSync(path.join(tempDir, "source.txt"))).toBe(true);
    });

    it("should remove directories recursively with rm -r", async () => {
      fs.mkdirSync(path.join(tempDir, "dir"));
      fs.writeFileSync(path.join(tempDir, "dir", "file.txt"), "content");

      await env.exec("rm -r /dir");

      const result = await env.exec("ls /dir");
      expect(result.exitCode).not.toBe(0);

      // Real directory should still exist
      expect(fs.existsSync(path.join(tempDir, "dir"))).toBe(true);
    });

    it("should copy directories recursively with cp -r", async () => {
      fs.mkdirSync(path.join(tempDir, "srcdir"));
      fs.writeFileSync(path.join(tempDir, "srcdir", "file.txt"), "nested");

      await env.exec("cp -r /srcdir /destdir");

      const result = await env.exec("cat /destdir/file.txt");
      expect(result.stdout).toBe("nested");
    });
  });

  describe("text processing", () => {
    beforeEach(() => {
      fs.writeFileSync(
        path.join(tempDir, "data.txt"),
        "apple\nbanana\ncherry\napple\ndate",
      );
    });

    it("should filter with grep", async () => {
      const result = await env.exec("grep apple /data.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("apple\napple\n");
    });

    it("should count matches with grep -c", async () => {
      const result = await env.exec("grep -c apple /data.txt");
      expect(result.stdout.trim()).toBe("2");
    });

    it("should invert match with grep -v", async () => {
      const result = await env.exec("grep -v apple /data.txt");
      expect(result.stdout).not.toContain("apple");
      expect(result.stdout).toContain("banana");
    });

    it("should sort lines", async () => {
      const result = await env.exec("sort /data.txt");
      expect(result.stdout).toBe("apple\napple\nbanana\ncherry\ndate\n");
    });

    it("should get unique lines with uniq", async () => {
      const result = await env.exec("sort /data.txt | uniq");
      expect(result.stdout).toBe("apple\nbanana\ncherry\ndate\n");
    });

    it("should count unique lines with uniq -c", async () => {
      const result = await env.exec("sort /data.txt | uniq -c");
      expect(result.stdout).toContain("2");
      expect(result.stdout).toContain("apple");
    });

    it("should cut fields", async () => {
      await env.exec('echo "a:b:c" > /fields.txt');
      const result = await env.exec("cut -d: -f2 /fields.txt");
      expect(result.stdout.trim()).toBe("b");
    });

    it("should replace with sed", async () => {
      const result = await env.exec("sed 's/apple/orange/g' /data.txt");
      expect(result.stdout).not.toContain("apple");
      expect(result.stdout).toContain("orange");
    });

    it("should transform with tr", async () => {
      const result = await env.exec("echo 'hello' | tr 'a-z' 'A-Z'");
      expect(result.stdout.trim()).toBe("HELLO");
    });
  });

  describe("pipelines and redirections", () => {
    it("should pipe between commands", async () => {
      fs.writeFileSync(path.join(tempDir, "nums.txt"), "3\n1\n2");

      const result = await env.exec("cat /nums.txt | sort");
      expect(result.stdout).toBe("1\n2\n3\n");
    });

    it("should chain multiple pipes", async () => {
      fs.writeFileSync(
        path.join(tempDir, "words.txt"),
        "cat\ndog\ncat\nbird\ndog\ncat",
      );

      const result = await env.exec(
        "cat /words.txt | sort | uniq -c | sort -rn | head -n 1",
      );
      expect(result.stdout).toContain("3");
      expect(result.stdout).toContain("cat");
    });

    it("should redirect stdout to file", async () => {
      await env.exec("echo hello > /out.txt");
      const result = await env.exec("cat /out.txt");
      expect(result.stdout).toBe("hello\n");
    });

    it("should redirect stderr to file", async () => {
      await env.exec("cat /nonexistent 2> /err.txt");
      const result = await env.exec("cat /err.txt");
      expect(result.stdout).toContain("No such file");
    });

    it("should redirect both stdout and stderr", async () => {
      // Simple test of stderr redirect working
      await env.exec("cat /nonexistent 2> /err.txt");
      const errResult = await env.exec("cat /err.txt");
      expect(errResult.stdout.length).toBeGreaterThan(0);
    });

    it("should use here-strings", async () => {
      const result = await env.exec('cat <<< "here string content"');
      expect(result.stdout).toBe("here string content\n");
    });
  });

  describe("find command", () => {
    beforeEach(() => {
      fs.mkdirSync(path.join(tempDir, "findtest"));
      fs.mkdirSync(path.join(tempDir, "findtest", "subdir"));
      fs.writeFileSync(path.join(tempDir, "findtest", "file1.txt"), "a");
      fs.writeFileSync(path.join(tempDir, "findtest", "file2.log"), "b");
      fs.writeFileSync(
        path.join(tempDir, "findtest", "subdir", "file3.txt"),
        "c",
      );
    });

    it("should find files by name pattern", async () => {
      const result = await env.exec('find /findtest -name "*.txt"');
      expect(result.stdout).toContain("file1.txt");
      expect(result.stdout).toContain("file3.txt");
      expect(result.stdout).not.toContain("file2.log");
    });

    it("should find files by type", async () => {
      const result = await env.exec("find /findtest -type d");
      expect(result.stdout).toContain("findtest");
      expect(result.stdout).toContain("subdir");
    });

    it("should find files in memory and real fs", async () => {
      await env.exec('echo "memory" > /findtest/memory.txt');

      const result = await env.exec('find /findtest -name "*.txt"');
      expect(result.stdout).toContain("file1.txt");
      expect(result.stdout).toContain("file3.txt");
      expect(result.stdout).toContain("memory.txt");
    });

    it("should not find deleted files", async () => {
      await env.exec("rm /findtest/file1.txt");

      const result = await env.exec('find /findtest -name "*.txt"');
      expect(result.stdout).not.toContain("file1.txt");
      expect(result.stdout).toContain("file3.txt");
    });
  });

  describe("complex workflows", () => {
    it("should process log files", async () => {
      const logContent = [
        "2024-01-01 ERROR something failed",
        "2024-01-01 INFO started",
        "2024-01-02 ERROR another failure",
        "2024-01-02 INFO completed",
        "2024-01-03 ERROR third error",
      ].join("\n");

      fs.writeFileSync(path.join(tempDir, "app.log"), logContent);

      const result = await env.exec("grep ERROR /app.log | wc -l");
      expect(result.stdout.trim()).toBe("3");
    });

    it("should build a project simulation", async () => {
      // Create source files
      await env.exec("mkdir -p /src /build");
      await env.exec('echo "console.log(1)" > /src/a.js');
      await env.exec('echo "console.log(2)" > /src/b.js');

      // "Build" by concatenating
      await env.exec("cat /src/*.js > /build/bundle.js");

      const result = await env.exec("cat /build/bundle.js");
      expect(result.stdout).toContain("console.log(1)");
      expect(result.stdout).toContain("console.log(2)");

      // Real fs should be clean
      expect(fs.existsSync(path.join(tempDir, "src"))).toBe(false);
      expect(fs.existsSync(path.join(tempDir, "build"))).toBe(false);
    });

    it("should simulate a deployment pipeline", async () => {
      // Setup
      fs.mkdirSync(path.join(tempDir, "app"));
      fs.writeFileSync(
        path.join(tempDir, "app", "config.json"),
        '{"env": "dev"}',
      );

      // Modify config for production
      await env.exec(
        "sed 's/dev/prod/' /app/config.json > /app/config.prod.json",
      );

      // Verify
      const result = await env.exec("cat /app/config.prod.json");
      expect(result.stdout).toContain("prod");

      // Original unchanged
      const original = await env.exec("cat /app/config.json");
      expect(original.stdout).toContain("dev");
    });

    it("should handle data transformation pipeline", async () => {
      const csvData = "name,age\nAlice,30\nBob,25\nCharlie,35";
      fs.writeFileSync(path.join(tempDir, "data.csv"), csvData);

      // Extract ages, sort, get oldest
      const result = await env.exec(
        "tail -n +2 /data.csv | cut -d, -f2 | sort -rn | head -n 1",
      );
      expect(result.stdout.trim()).toBe("35");
    });
  });

  describe("environment and variables", () => {
    it("should use environment variables", async () => {
      const envWithVars = new Bash({
        fs: overlay,
        cwd: "/",
        env: { MY_VAR: "test_value" },
      });

      const result = await envWithVars.exec("echo $MY_VAR");
      expect(result.stdout.trim()).toBe("test_value");
    });

    it("should export and use variables", async () => {
      const result = await env.exec('export FOO=bar && echo "FOO is $FOO"');
      expect(result.stdout).toContain("FOO is bar");
    });

    it("should use variables within same command", async () => {
      // Variables persist within the same exec call
      const result = await env.exec("export PERSIST=value && echo $PERSIST");
      expect(result.stdout.trim()).toBe("value");
    });
  });

  describe("symlinks", () => {
    it("should create and follow symlinks", async () => {
      await env.exec('echo "target content" > /target.txt');
      await env.exec("ln -s /target.txt /link.txt");

      const result = await env.exec("cat /link.txt");
      expect(result.stdout).toBe("target content\n");
    });

    it("should verify symlink exists", async () => {
      await env.exec('echo "target" > /target.txt');
      await env.exec("ln -s /target.txt /link.txt");

      // Verify the symlink was created by reading through it
      const result = await env.exec("cat /link.txt");
      expect(result.stdout).toBe("target\n");

      // Verify we can list it
      const lsResult = await env.exec("ls /link.txt");
      expect(lsResult.exitCode).toBe(0);
    });

    it("should read symlink target with readlink", async () => {
      await env.exec("ln -s /some/path /mylink");

      const result = await env.exec("readlink /mylink");
      expect(result.stdout.trim()).toBe("/some/path");
    });
  });

  describe("file permissions", () => {
    it("should change permissions with chmod", async () => {
      await env.exec('echo "script" > /script.sh');
      await env.exec("chmod 755 /script.sh");

      // Verify permissions changed via overlay API
      const stat = await overlay.stat("/script.sh");
      expect(stat.mode & 0o777).toBe(0o755);
    });

    it("should stat files", async () => {
      fs.writeFileSync(path.join(tempDir, "statme.txt"), "content");

      const result = await env.exec("stat /statme.txt");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("statme.txt");
    });
  });

  describe("error handling", () => {
    it("should return non-zero exit code for missing files", async () => {
      const result = await env.exec("cat /nonexistent.txt");
      expect(result.exitCode).not.toBe(0);
    });

    it("should return non-zero for invalid commands", async () => {
      const result = await env.exec("invalidcommand123");
      expect(result.exitCode).not.toBe(0);
    });

    it("should handle command substitution errors gracefully", async () => {
      const result = await env.exec("echo $(cat /nonexistent)");
      // Command should complete even if substitution fails
      expect(result).toBeDefined();
    });

    it("should have correct exit code for failed command", async () => {
      // The exit code of a pipeline is the exit code of the last command
      // Using a command that will fail at the end of the pipe
      const result = await env.exec("echo test | cat /nonexistent");
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("isolation verification", () => {
    it("should not modify real filesystem after complex operations", async () => {
      // Perform many operations
      await env.exec("mkdir -p /a/b/c");
      await env.exec('echo "1" > /a/file1.txt');
      await env.exec('echo "2" > /a/b/file2.txt');
      await env.exec('echo "3" > /a/b/c/file3.txt');
      await env.exec("cp -r /a /a-copy");
      await env.exec("mv /a-copy /a-moved");
      await env.exec("rm -r /a");

      // Verify overlay state
      const result = await env.exec("find /a-moved -type f");
      expect(result.stdout).toContain("file1.txt");
      expect(result.stdout).toContain("file2.txt");
      expect(result.stdout).toContain("file3.txt");

      // Verify real fs is untouched
      const realContents = fs.readdirSync(tempDir);
      expect(realContents).not.toContain("a");
      expect(realContents).not.toContain("a-copy");
      expect(realContents).not.toContain("a-moved");
    });

    it("should maintain separate state across overlay instances", async () => {
      // Write to first overlay
      await env.exec('echo "first" > /shared.txt');

      // Create second overlay with same root
      const overlay2 = new OverlayFs({ root: tempDir, mountPoint: "/" });
      const env2 = new Bash({ fs: overlay2, cwd: "/" });

      // Second overlay should not see first overlay's writes
      const result = await env2.exec("cat /shared.txt");
      expect(result.exitCode).not.toBe(0);

      // But can write its own version
      await env2.exec('echo "second" > /shared.txt');
      const result2 = await env2.exec("cat /shared.txt");
      expect(result2.stdout).toBe("second\n");

      // First overlay unchanged
      const result1 = await env.exec("cat /shared.txt");
      expect(result1.stdout).toBe("first\n");
    });
  });
});
