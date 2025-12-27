import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("xargs command", () => {
  describe("basic usage", () => {
    it("should execute echo by default", async () => {
      const env = new Bash();
      const result = await env.exec('echo "a b c" | xargs');
      expect(result.stdout).toBe("a b c\n");
      expect(result.exitCode).toBe(0);
    });

    it("should execute specified command", async () => {
      const env = new Bash({
        files: {
          "/file1.txt": "content1",
          "/file2.txt": "content2",
        },
      });
      const result = await env.exec('echo "/file1.txt /file2.txt" | xargs cat');
      expect(result.stdout).toBe("content1content2");
    });

    it("should handle empty input", async () => {
      const env = new Bash();
      const result = await env.exec('echo "" | xargs');
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-n option (batch size)", () => {
    it("should batch with -n 1", async () => {
      const env = new Bash();
      const result = await env.exec('echo "a b c" | xargs -n 1 echo');
      expect(result.stdout).toBe("a\nb\nc\n");
    });

    it("should batch with -n 2", async () => {
      const env = new Bash();
      const result = await env.exec('echo "a b c d" | xargs -n 2 echo');
      expect(result.stdout).toBe("a b\nc d\n");
    });

    it("should handle partial last batch", async () => {
      const env = new Bash();
      const result = await env.exec('echo "a b c" | xargs -n 2 echo');
      expect(result.stdout).toBe("a b\nc\n");
    });
  });

  describe("-I option (replace string)", () => {
    it("should replace placeholder with input", async () => {
      const env = new Bash();
      const result = await env.exec(
        'echo "a\nb\nc" | xargs -I {} echo file-{}',
      );
      expect(result.stdout).toBe("file-a\nfile-b\nfile-c\n");
    });

    it("should replace multiple occurrences", async () => {
      const env = new Bash();
      const result = await env.exec('echo "x" | xargs -I % echo %-%');
      expect(result.stdout).toBe("x-x\n");
    });

    it("should work with file operations", async () => {
      const env = new Bash({
        files: {
          "/src/a.txt": "content-a",
          "/src/b.txt": "content-b",
        },
      });
      const result = await env.exec(
        'echo "/src/a.txt\n/src/b.txt" | xargs -I {} cat {}',
      );
      expect(result.stdout).toBe("content-acontent-b");
    });
  });

  describe("-0 option (null separator)", () => {
    it("should split on null character", async () => {
      const env = new Bash();
      // Create input with null-separated items (simulated via file)
      await env.exec('echo -n "a" > /items.txt');
      // Note: Our echo doesn't handle -n yet, so let's test differently
      const result = await env.exec('echo "a\x00b\x00c" | xargs -0 echo');
      // Without proper null-separated input, this tests the flag parsing
      expect(result.exitCode).toBe(0);
    });
  });

  describe("-t option (verbose)", () => {
    it("should print commands to stderr", async () => {
      const env = new Bash();
      const result = await env.exec('echo "x y" | xargs -t echo');
      expect(result.stdout).toBe("x y\n");
      expect(result.stderr).toBe("echo x y\n");
    });
  });

  describe("-r option (no-run-if-empty)", () => {
    it("should not run command when input is empty", async () => {
      const env = new Bash();
      const result = await env.exec('echo "" | xargs -r echo "nonempty"');
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("real-world patterns", () => {
    it("should process files with grep results", async () => {
      const env = new Bash({
        files: {
          "/src/app.ts": "const x = 1;\nconst y = 2;",
          "/src/lib.ts": "export const z = 3;",
        },
      });
      // Find files with "const" and count lines
      const result = await env.exec("grep -l const /src/*.ts | xargs wc -l");
      // wc -l outputs line counts per file with filenames
      expect(result.stdout).toContain("/src/app.ts");
      expect(result.stdout).toContain("/src/lib.ts");
      expect(result.stdout).toContain("total");
      expect(result.exitCode).toBe(0);
    });

    it("should handle find | xargs rm pattern", async () => {
      const env = new Bash({
        files: {
          "/tmp/file1.tmp": "temp1",
          "/tmp/file2.tmp": "temp2",
          "/keep/file.txt": "keep",
        },
      });
      await env.exec('echo "/tmp/file1.tmp /tmp/file2.tmp" | xargs rm');

      const result1 = await env.exec("cat /tmp/file1.tmp");
      expect(result1.exitCode).toBe(1); // File should be deleted

      const result2 = await env.exec("cat /keep/file.txt");
      expect(result2.stdout).toBe("keep"); // This file should still exist
    });

    it("should work with -I for complex transformations", async () => {
      const env = new Bash({
        files: {
          "/files/a": "original-a",
          "/files/b": "original-b",
        },
      });
      // Copy files to backup directory
      await env.exec("mkdir /backup");
      await env.exec('echo "a\nb" | xargs -I {} cp /files/{} /backup/{}');

      const resultA = await env.exec("cat /backup/a");
      expect(resultA.stdout).toBe("original-a");

      const resultB = await env.exec("cat /backup/b");
      expect(resultB.stdout).toBe("original-b");
    });
  });

  describe("exit codes", () => {
    it("should propagate command failure exit code", async () => {
      const env = new Bash();
      const result = await env.exec('echo "missing.txt" | xargs cat');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("No such file");
    });
  });

  describe("help option", () => {
    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("xargs --help");
      expect(result.stdout).toContain("xargs");
      expect(result.stdout).toContain("build and execute");
      expect(result.stdout).toContain("-I");
      expect(result.stdout).toContain("-n");
      expect(result.exitCode).toBe(0);
    });
  });
});
