/**
 * Tests for rg -I/--no-filename flag
 *
 * The -I/--no-filename flag suppresses the prefixing of file names on output.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg -I/--no-filename basic functionality", () => {
  it("should hide filename with -I in directory search", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "hello world\n",
      },
    });
    const result = await bash.exec("rg -I hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world\n");
  });

  it("should hide filename with --no-filename in directory search", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/data.txt": "test line\n",
      },
    });
    const result = await bash.exec("rg --no-filename test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("test line\n");
  });

  it("should work without line numbers when combined with -N", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "match here\n",
      },
    });
    const result = await bash.exec("rg -I -N match");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("match here\n");
  });

  it("should hide filename for single file search (already hidden by default)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/test.txt": "foo bar\n",
      },
    });
    // Single file already hides filename, -I is redundant but should work
    const result = await bash.exec("rg -I foo test.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("foo bar\n");
  });
});

describe("rg -I with multiple files", () => {
  it("should hide filenames for all files", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/a.txt": "found\n",
        "/home/user/b.txt": "found\n",
        "/home/user/c.txt": "found\n",
      },
    });
    const result = await bash.exec("rg -I found");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("found\nfound\nfound\n");
  });

  it("should still show line numbers with multiple files", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/first.txt": "line one\nline two\n",
        "/home/user/second.txt": "line three\n",
      },
    });
    const result = await bash.exec("rg -In --sort path line");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("1:line one\n2:line two\n1:line three\n");
  });

  it("should hide filenames in subdirectories", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/src/app.ts": "export const x = 1;\n",
        "/home/user/lib/util.ts": "export const y = 2;\n",
      },
    });
    const result = await bash.exec("rg -I export");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("export const y = 2;\nexport const x = 1;\n");
  });
});

describe("rg -I with other flags", () => {
  it("should work with -c (count)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "a\na\na\n",
      },
    });
    const result = await bash.exec("rg -I -c a");
    expect(result.exitCode).toBe(0);
    // Count mode with -I should hide filename
    expect(result.stdout).toBe("3\n");
  });

  it("should work with -c across multiple files", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/a.txt": "x\nx\n",
        "/home/user/b.txt": "x\nx\nx\n",
      },
    });
    const result = await bash.exec("rg -I -c x");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("2\n3\n");
  });

  it("should work with -o (only matching)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/nums.txt": "abc123def456\n",
      },
    });
    const result = await bash.exec("rg -I -o '[0-9]+'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("123\n456\n");
  });

  it("should work with -v (invert match)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "keep\nremove\nkeep\n",
      },
    });
    const result = await bash.exec("rg -I -v remove");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("keep\nkeep\n");
  });

  it("should work with -i (case insensitive)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "Hello\nHELLO\nhello\n",
      },
    });
    const result = await bash.exec("rg -I -i hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Hello\nHELLO\nhello\n");
  });

  it("should work with -w (word match)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "foo bar\nfoobar\nbar foo baz\n",
      },
    });
    const result = await bash.exec("rg -I -w foo");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("foo bar\nbar foo baz\n");
  });

  it("should work with -m (max count)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "test\ntest\ntest\ntest\n",
      },
    });
    const result = await bash.exec("rg -I -m2 test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("test\ntest\n");
  });

  it("should NOT affect -l (files with matches)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/a.txt": "match\n",
        "/home/user/b.txt": "match\n",
      },
    });
    // -l lists files, so filename is the output - -I doesn't make sense here
    // but ripgrep still shows filenames with -l even with -I
    const result = await bash.exec("rg -I -l match");
    expect(result.exitCode).toBe(0);
    // -l output shows filenames regardless of -I
    expect(result.stdout).toBe("a.txt\nb.txt\n");
  });

  it("should NOT affect --files-without-match", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/has.txt": "match\n",
        "/home/user/no.txt": "other\n",
      },
    });
    const result = await bash.exec("rg -I --files-without-match match");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("no.txt\n");
  });
});

describe("rg -I with context lines", () => {
  it("should hide filename with -A (after context)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "before\nmatch\nafter\nmore\n",
      },
    });
    const result = await bash.exec("rg -I -A1 match");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("match\nafter\n");
  });

  it("should hide filename with -B (before context)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "before\nmatch\nafter\n",
      },
    });
    const result = await bash.exec("rg -I -B1 match");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("before\nmatch\n");
  });

  it("should hide filename with -C (context)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "a\nb\nmatch\nc\nd\n",
      },
    });
    const result = await bash.exec("rg -I -C1 match");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("b\nmatch\nc\n");
  });

  it("should hide filename in context across multiple files", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/a.txt": "ctx\nmatch\nctx\n",
        "/home/user/b.txt": "ctx\nmatch\nctx\n",
      },
    });
    const result = await bash.exec("rg -I -C1 --sort path match");
    expect(result.exitCode).toBe(0);
    // No separator between files when -I is used since there's no filename prefix
    expect(result.stdout).toBe("ctx\nmatch\nctx\nctx\nmatch\nctx\n");
  });
});

describe("rg -I with file filters", () => {
  it("should work with -t (type filter)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/code.js": "const x = 1;\n",
        "/home/user/code.py": "x = 1\n",
      },
    });
    const result = await bash.exec("rg -I -t js const");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("const x = 1;\n");
  });

  it("should work with -g (glob filter)", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/test.log": "error occurred\n",
        "/home/user/test.txt": "error here too\n",
      },
    });
    const result = await bash.exec("rg -I -g '*.log' error");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("error occurred\n");
  });
});

describe("rg -I edge cases", () => {
  it("should handle empty matches with no filename", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "no match here\n",
      },
    });
    const result = await bash.exec("rg -I notfound");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("should work with special characters in output", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "path/to/file:line:content\n",
      },
    });
    const result = await bash.exec("rg -I path");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("path/to/file:line:content\n");
  });

  it("should work with hidden files when --hidden is used", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.hidden": "secret\n",
      },
    });
    const result = await bash.exec("rg -I --hidden secret");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("secret\n");
  });

  it("should work combined with other short flags", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "Test\ntest\nTEST\n",
      },
    });
    // Combine -I with -i and -n
    const result = await bash.exec("rg -Iin test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("1:Test\n2:test\n3:TEST\n");
  });

  it("should output just line numbers with -In", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "match\n",
      },
    });
    const result = await bash.exec("rg -In match");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("1:match\n");
  });
});

describe("rg -I with regex patterns", () => {
  it("should work with regex alternation", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "apple\norange\nbanana\n",
      },
    });
    const result = await bash.exec("rg -I 'apple|banana'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("apple\nbanana\n");
  });

  it("should work with character classes", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "abc123\ndef456\n",
      },
    });
    const result = await bash.exec("rg -I '[0-9]+'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("abc123\ndef456\n");
  });
});

describe("rg -I piping use case", () => {
  it("should produce clean output for piping to other commands", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/data.txt": "value: 100\nvalue: 200\nvalue: 300\n",
      },
    });
    // -I -N -o gives just the matched text, perfect for piping
    const result = await bash.exec("rg -I -N -o '[0-9]+'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("100\n200\n300\n");
  });
});
