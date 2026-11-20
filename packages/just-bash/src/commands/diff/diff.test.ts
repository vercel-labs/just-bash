import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("diff", () => {
  describe("basic comparison", () => {
    it("should return 0 for identical files", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "line1\nline2\nline3\n",
          "/b.txt": "line1\nline2\nline3\n",
        },
      });
      const result = await env.exec("diff /a.txt /b.txt");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should return 1 for different files", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "line1\n",
          "/b.txt": "line2\n",
        },
      });
      const result = await env.exec("diff /a.txt /b.txt");
      expect(result.exitCode).toBe(1);
    });

    it("should show normal diff output by default", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "hello\n",
          "/b.txt": "world\n",
        },
      });
      const result = await env.exec("diff /a.txt /b.txt");
      expect(result.stdout).toBe("1c1\n< hello\n---\n> world\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("should show added lines", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "line1\n",
          "/b.txt": "line1\nline2\n",
        },
      });
      const result = await env.exec("diff /a.txt /b.txt");
      expect(result.stdout).toBe("1a2\n> line2\n");
      expect(result.exitCode).toBe(1);
    });

    it("should show removed lines", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "line1\nline2\n",
          "/b.txt": "line1\n",
        },
      });
      const result = await env.exec("diff /a.txt /b.txt");
      expect(result.stdout).toBe("2d1\n< line2\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("brief mode (-q)", () => {
    it("should report files differ with -q", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "aaa\n",
          "/b.txt": "bbb\n",
        },
      });
      const result = await env.exec("diff -q /a.txt /b.txt");
      expect(result.stdout).toBe("Files /a.txt and /b.txt differ\n");
      expect(result.exitCode).toBe(1);
    });

    it("should output nothing for identical files with -q", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "same\n",
          "/b.txt": "same\n",
        },
      });
      const result = await env.exec("diff -q /a.txt /b.txt");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should work with --brief", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "aaa\n",
          "/b.txt": "bbb\n",
        },
      });
      const result = await env.exec("diff --brief /a.txt /b.txt");
      expect(result.stdout).toBe("Files /a.txt and /b.txt differ\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("report identical (-s)", () => {
    it("should report when files are identical with -s", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "same\n",
          "/b.txt": "same\n",
        },
      });
      const result = await env.exec("diff -s /a.txt /b.txt");
      expect(result.stdout).toBe("Files /a.txt and /b.txt are identical\n");
      expect(result.exitCode).toBe(0);
    });

    it("should work with --report-identical-files", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "same\n",
          "/b.txt": "same\n",
        },
      });
      const result = await env.exec(
        "diff --report-identical-files /a.txt /b.txt",
      );
      expect(result.stdout).toBe("Files /a.txt and /b.txt are identical\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("ignore case (-i)", () => {
    it("should ignore case differences with -i", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "Hello World\n",
          "/b.txt": "hello world\n",
        },
      });
      const result = await env.exec("diff -i /a.txt /b.txt");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });

    it("should show diff without -i for case differences", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "Hello\n",
          "/b.txt": "hello\n",
        },
      });
      const result = await env.exec("diff /a.txt /b.txt");
      expect(result.stdout).toBe("1c1\n< Hello\n---\n> hello\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("stdin support", () => {
    it("should read first file from stdin with -", async () => {
      const env = new Bash({
        files: {
          "/b.txt": "from file\n",
        },
      });
      const result = await env.exec('echo "from stdin" | diff - /b.txt');
      expect(result.stdout).toBe("1c1\n< from stdin\n---\n> from file\n");
      expect(result.exitCode).toBe(1);
    });

    it("should read second file from stdin with -", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "from file\n",
        },
      });
      const result = await env.exec('echo "from stdin" | diff /a.txt -');
      expect(result.stdout).toBe("1c1\n< from file\n---\n> from stdin\n");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("error handling", () => {
    it("should error on missing file", async () => {
      const env = new Bash({
        files: { "/exists.txt": "content\n" },
      });
      const result = await env.exec("diff /missing.txt /exists.txt");
      expect(result.stderr).toBe(
        "diff: /missing.txt: No such file or directory\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should error on missing second file", async () => {
      const env = new Bash({
        files: { "/exists.txt": "content\n" },
      });
      const result = await env.exec("diff /exists.txt /missing.txt");
      expect(result.stderr).toBe(
        "diff: /missing.txt: No such file or directory\n",
      );
      expect(result.exitCode).toBe(2);
    });

    it("should error with missing operand", async () => {
      const env = new Bash();
      const result = await env.exec("diff /a.txt");
      expect(result.stderr).toContain("missing operand");
      expect(result.exitCode).toBe(2);
    });

    it("should error on unknown option", async () => {
      const env = new Bash();
      const result = await env.exec("diff --unknown /a.txt /b.txt");
      expect(result.stderr).toContain("unrecognized option");
      expect(result.exitCode).toBe(1);
    });

    it("should error on unknown short option", async () => {
      const env = new Bash();
      const result = await env.exec("diff -z /a.txt /b.txt");
      expect(result.stderr).toContain("invalid option");
      expect(result.exitCode).toBe(1);
    });
  });

  describe("help", () => {
    it("should show help with --help", async () => {
      const env = new Bash();
      const result = await env.exec("diff --help");
      expect(result.stdout).toContain("diff");
      expect(result.stdout).toContain("compare");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("multiline diffs", () => {
    it("should handle multiple changed lines", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "line1\nline2\nline3\n",
          "/b.txt": "line1\nmodified\nline3\n",
        },
      });
      const result = await env.exec("diff /a.txt /b.txt");
      expect(result.stdout).toBe("2c2\n< line2\n---\n> modified\n");
      expect(result.exitCode).toBe(1);
    });

    it("should show context around changes with -u", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "1\n2\n3\n4\n5\n",
          "/b.txt": "1\n2\nX\n4\n5\n",
        },
      });
      const result = await env.exec("diff -u /a.txt /b.txt");
      expect(result.stdout).toBe(
        "--- /a.txt\n+++ /b.txt\n@@ -1,5 +1,5 @@\n 1\n 2\n-3\n+X\n 4\n 5\n",
      );
      expect(result.exitCode).toBe(1);
    });
  });

  describe("empty files", () => {
    it("should handle empty vs non-empty", async () => {
      const env = new Bash({
        files: {
          "/empty.txt": "",
          "/content.txt": "has content\n",
        },
      });
      const result = await env.exec("diff /empty.txt /content.txt");
      expect(result.stdout).toBe("0a1\n> has content\n");
      expect(result.exitCode).toBe(1);
    });

    it("should handle both empty files", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "",
          "/b.txt": "",
        },
      });
      const result = await env.exec("diff /a.txt /b.txt");
      expect(result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("output style selection", () => {
    const files = { "/a.txt": "1\n2\n3\n4\n5\n", "/b.txt": "1\n2\nX\n4\n5\n" };

    it("should select normal format with --normal", async () => {
      const env = new Bash({ files });
      const result = await env.exec("diff --normal /a.txt /b.txt");
      expect(result.stdout).toBe("3c3\n< 3\n---\n> X\n");
      expect(result.exitCode).toBe(1);
    });

    it("should select context format with -c", async () => {
      const env = new Bash({ files });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,5 ****\n" +
          "  1\n  2\n! 3\n  4\n  5\n--- 1,5 ----\n  1\n  2\n! X\n  4\n  5\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("should select context format with --context", async () => {
      const env = new Bash({ files });
      const short = await env.exec("diff -c /a.txt /b.txt");
      const long = await env.exec("diff --context /a.txt /b.txt");
      expect(long.stdout).toBe(short.stdout);
      expect(long.exitCode).toBe(1);
    });

    it("should not emit the jsdiff === banner in any style", async () => {
      const env = new Bash({ files });
      for (const flag of ["", "-u", "-c", "--normal"]) {
        const result = await env.exec(`diff ${flag} /a.txt /b.txt`);
        expect(result.stdout).not.toContain("=====");
      }
    });

    it("should reject conflicting output styles", async () => {
      const env = new Bash({ files });
      const result = await env.exec("diff -u -c /a.txt /b.txt");
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(
        "diff: conflicting output style options\n" +
          "diff: Try 'diff --help' for more information.\n",
      );
      expect(result.exitCode).toBe(2);
    });
  });

  describe("version", () => {
    it("should print the program name and exit 0 with --version", async () => {
      const env = new Bash();
      const result = await env.exec("diff --version");
      expect(result.stdout).toBe("diff (just-bash)\n");
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("filename quoting in -u/-c headers", () => {
    it("should leave an ordinary filename bare", async () => {
      const env = new Bash({ files: { "/a.txt": "a\n", "/b.txt": "b\n" } });
      const result = await env.exec("diff -u /a.txt /b.txt");
      expect(result.stdout).toBe(
        "--- /a.txt\n+++ /b.txt\n@@ -1 +1 @@\n-a\n+b\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("should quote a filename containing a space", async () => {
      const env = new Bash({ files: { "/has space": "a\n", "/b.txt": "b\n" } });
      const result = await env.exec("diff -u '/has space' /b.txt");
      expect(result.stdout).toBe(
        '--- "/has space"\n+++ /b.txt\n@@ -1 +1 @@\n-a\n+b\n',
      );
      expect(result.exitCode).toBe(1);
    });

    it("should escape a newline so it cannot forge patch lines", async () => {
      const env = new Bash({ files: { "/ev\nil": "a\n", "/b.txt": "b\n" } });
      const result = await env.exec("diff -u \"$(printf '/ev\\nil')\" /b.txt");
      expect(result.stdout).toBe(
        '--- "/ev\\nil"\n+++ /b.txt\n@@ -1 +1 @@\n-a\n+b\n',
      );
      // A raw newline here would have forged two extra lines in the patch.
      expect(result.stdout.split("\n")).toHaveLength(6);
      expect(result.exitCode).toBe(1);
    });

    it("should escape a double quote, and quote in -c headers too", async () => {
      const env = new Bash({ files: { '/a"b c': "a\n", "/b.txt": "b\n" } });
      const result = await env.exec("diff -c '/a\"b c' /b.txt");
      expect(result.stdout).toBe(
        '*** "/a\\"b c"\n--- /b.txt\n***************\n' +
          "*** 1 ****\n! a\n--- 1 ----\n! b\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("should leave non-ASCII filenames bare", async () => {
      const env = new Bash({ files: { "/ünïcøde": "a\n", "/b.txt": "b\n" } });
      const result = await env.exec("diff -u /ünïcøde /b.txt");
      expect(result.stdout).toBe(
        "--- /ünïcøde\n+++ /b.txt\n@@ -1 +1 @@\n-a\n+b\n",
      );
      expect(result.exitCode).toBe(1);
    });

    it("should not print filenames at all in normal format", async () => {
      const env = new Bash({ files: { "/has space": "a\n", "/b.txt": "b\n" } });
      const result = await env.exec("diff '/has space' /b.txt");
      expect(result.stdout).toBe("1c1\n< a\n---\n> b\n");
      expect(result.exitCode).toBe(1);
    });
  });
});
