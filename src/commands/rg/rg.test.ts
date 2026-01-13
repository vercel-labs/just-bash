import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg", () => {
  describe("basic search", () => {
    it("should search for pattern in current directory", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file1.txt": "hello world\nfoo bar\n",
          "/home/user/file2.txt": "hello there\nbaz qux\n",
        },
      });
      const result = await bash.exec("rg hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("file1.txt");
      expect(result.stdout).toContain("file2.txt");
      expect(result.stdout).toContain("hello");
    });

    it("should search in specified path", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/src/app.ts": "const hello = 'world';\n",
          "/home/user/README.md": "# Hello\n",
        },
      });
      const result = await bash.exec("rg hello src");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("src/app.ts");
      expect(result.stdout).not.toContain("README.md");
    });

    it("should return exit code 1 when no matches", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "hello world\n",
        },
      });
      const result = await bash.exec("rg nomatch");
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
    });

    it("should show line numbers by default", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "line1\nhello\nline3\n",
        },
      });
      const result = await bash.exec("rg hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(":2:");
    });

    it("should hide line numbers with -N", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "hello world\n",
        },
      });
      const result = await bash.exec("rg -N hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toMatch(/:\d+:/);
    });
  });

  describe("case sensitivity", () => {
    it("should use smart case by default (lowercase = case-insensitive)", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "Hello World\nhello world\n",
        },
      });
      const result = await bash.exec("rg hello");
      expect(result.exitCode).toBe(0);
      // Smart case: lowercase pattern matches both
      expect(result.stdout).toContain("Hello");
      expect(result.stdout).toContain("hello");
    });

    it("should use smart case (uppercase in pattern = case-sensitive)", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "Hello World\nhello world\n",
        },
      });
      const result = await bash.exec("rg Hello");
      expect(result.exitCode).toBe(0);
      // Smart case: uppercase in pattern = case-sensitive
      expect(result.stdout).toContain("Hello");
      expect(result.stdout).not.toContain(":hello");
    });

    it("should be case-insensitive with -i", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "Hello World\nhello world\nHELLO WORLD\n",
        },
      });
      const result = await bash.exec("rg -i HELLO");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Hello");
      expect(result.stdout).toContain("hello");
      expect(result.stdout).toContain("HELLO");
    });
  });

  describe("file type filtering", () => {
    it("should filter by type with -t", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/src/app.ts": "const foo = 1;\n",
          "/home/user/src/app.js": "const foo = 2;\n",
          "/home/user/src/style.css": "foo { }\n",
        },
      });
      const result = await bash.exec("rg -t ts foo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("app.ts");
      expect(result.stdout).not.toContain("app.js");
      expect(result.stdout).not.toContain("style.css");
    });

    it("should exclude type with -T", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/src/app.ts": "const foo = 1;\n",
          "/home/user/src/app.js": "const foo = 2;\n",
        },
      });
      const result = await bash.exec("rg -T ts foo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("app.ts");
      expect(result.stdout).toContain("app.js");
    });

    it("should error on unknown type", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "hello\n",
        },
      });
      const result = await bash.exec("rg -t unknowntype hello");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown type");
    });

    it("should list types with --type-list", async () => {
      const bash = new Bash();
      const result = await bash.exec("rg --type-list");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("js:");
      expect(result.stdout).toContain("ts:");
      expect(result.stdout).toContain("py:");
    });
  });

  describe("glob filtering", () => {
    it("should filter files with -g", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/src/app.ts": "const foo = 1;\n",
          "/home/user/src/test.ts": "const foo = 2;\n",
          "/home/user/src/util.ts": "const foo = 3;\n",
        },
      });
      const result = await bash.exec("rg -g '*.ts' foo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("app.ts");
      expect(result.stdout).toContain("test.ts");
    });

    it("should support negated globs", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/src/app.ts": "const foo = 1;\n",
          "/home/user/src/test.ts": "const foo = 2;\n",
        },
      });
      const result = await bash.exec("rg -g '!test.ts' foo");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("app.ts");
      expect(result.stdout).not.toContain("test.ts");
    });
  });

  describe("hidden files", () => {
    it("should skip hidden files by default", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/visible.txt": "hello\n",
          "/home/user/.hidden.txt": "hello\n",
        },
      });
      const result = await bash.exec("rg hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("visible.txt");
      expect(result.stdout).not.toContain(".hidden.txt");
    });

    it("should include hidden files with --hidden", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/visible.txt": "hello\n",
          "/home/user/.hidden.txt": "hello\n",
        },
      });
      const result = await bash.exec("rg --hidden hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("visible.txt");
      expect(result.stdout).toContain(".hidden.txt");
    });
  });

  describe("gitignore", () => {
    it("should respect .gitignore patterns", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/.gitignore": "*.log\nnode_modules/\n",
          "/home/user/app.ts": "hello\n",
          "/home/user/debug.log": "hello\n",
          "/home/user/node_modules/pkg/index.js": "hello\n",
        },
      });
      const result = await bash.exec("rg hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("app.ts");
      expect(result.stdout).not.toContain("debug.log");
      expect(result.stdout).not.toContain("node_modules");
    });

    it("should include ignored files with --no-ignore", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/.gitignore": "*.log\n",
          "/home/user/app.ts": "hello\n",
          "/home/user/debug.log": "hello\n",
        },
      });
      const result = await bash.exec("rg --no-ignore hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("app.ts");
      expect(result.stdout).toContain("debug.log");
    });
  });

  describe("output modes", () => {
    it("should count matches with -c", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "hello\nhello\nhello\n",
        },
      });
      const result = await bash.exec("rg -c hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(":3");
    });

    it("should list files with -l", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file1.txt": "hello\n",
          "/home/user/file2.txt": "hello\n",
        },
      });
      const result = await bash.exec("rg -l hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("file1.txt");
      expect(result.stdout).toContain("file2.txt");
      // Should not include line content
      expect(result.stdout).not.toMatch(/:hello/);
    });

    it("should list files without matches with -L", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file1.txt": "hello\n",
          "/home/user/file2.txt": "world\n",
        },
      });
      const result = await bash.exec("rg -L hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("file1.txt");
      expect(result.stdout).toContain("file2.txt");
    });

    it("should show only matching text with -o", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "hello world\n",
        },
      });
      const result = await bash.exec("rg -o hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
      expect(result.stdout).not.toContain("world");
    });
  });

  describe("context lines", () => {
    it("should show lines after match with -A", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "line1\nhello\nline3\nline4\n",
        },
      });
      const result = await bash.exec("rg -A 1 hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello");
      expect(result.stdout).toContain("line3");
    });

    it("should show lines before match with -B", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "line1\nline2\nhello\nline4\n",
        },
      });
      const result = await bash.exec("rg -B 1 hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("line2");
      expect(result.stdout).toContain("hello");
    });

    it("should show context with -C", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "line1\nline2\nhello\nline4\nline5\n",
        },
      });
      const result = await bash.exec("rg -C 1 hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("line2");
      expect(result.stdout).toContain("hello");
      expect(result.stdout).toContain("line4");
    });
  });

  describe("pattern options", () => {
    it("should match whole words with -w", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "hello world\nhelloworld\n",
        },
      });
      const result = await bash.exec("rg -w hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("hello world");
      expect(result.stdout).not.toContain("helloworld");
    });

    it("should match whole lines with -x", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "hello\nhello world\n",
        },
      });
      const result = await bash.exec("rg -x hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain(":hello");
      expect(result.stdout).not.toContain("hello world");
    });

    it("should treat pattern as literal with -F", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "a.b\naxb\n",
        },
      });
      const result = await bash.exec("rg -F 'a.b'");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("a.b");
      expect(result.stdout).not.toContain("axb");
    });

    it("should invert match with -v", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/file.txt": "hello\nworld\n",
        },
      });
      const result = await bash.exec("rg -v hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).not.toContain("hello");
      expect(result.stdout).toContain("world");
    });
  });

  describe("binary files", () => {
    it("should skip binary files by default", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/text.txt": "hello\n",
          "/home/user/binary.bin": "hello\x00world\n",
        },
      });
      const result = await bash.exec("rg hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("text.txt");
      expect(result.stdout).not.toContain("binary.bin");
    });
  });

  describe("max depth", () => {
    it("should limit search depth with --max-depth", async () => {
      const bash = new Bash({
        cwd: "/home/user",
        files: {
          "/home/user/level0.txt": "hello\n",
          "/home/user/dir1/level1.txt": "hello\n",
          "/home/user/dir1/dir2/level2.txt": "hello\n",
        },
      });
      const result = await bash.exec("rg --max-depth 1 hello");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("level0.txt");
      expect(result.stdout).toContain("level1.txt");
      expect(result.stdout).not.toContain("level2.txt");
    });
  });

  describe("help", () => {
    it("should show help with --help", async () => {
      const bash = new Bash();
      const result = await bash.exec("rg --help");
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("rg");
      expect(result.stdout).toContain("recursively search");
    });
  });

  describe("error handling", () => {
    it("should error on missing pattern", async () => {
      const bash = new Bash();
      const result = await bash.exec("rg");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("no pattern");
    });

    it("should error on unknown option", async () => {
      const bash = new Bash();
      const result = await bash.exec("rg --unknown-option pattern");
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("unknown");
    });
  });
});

describe("gitignore parser", () => {
  it("should handle simple patterns", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "*.log\n",
        "/home/user/app.ts": "hello\n",
        "/home/user/error.log": "hello\n",
      },
    });
    const result = await bash.exec("rg hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("app.ts");
    expect(result.stdout).not.toContain("error.log");
  });

  it("should handle negation patterns", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "*.log\n!important.log\n",
        "/home/user/debug.log": "hello\n",
        "/home/user/important.log": "hello\n",
      },
    });
    const result = await bash.exec("rg hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("debug.log");
    expect(result.stdout).toContain("important.log");
  });

  it("should handle directory patterns", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "build/\n",
        "/home/user/src/app.ts": "hello\n",
        "/home/user/build/output.js": "hello\n",
      },
    });
    const result = await bash.exec("rg hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("app.ts");
    expect(result.stdout).not.toContain("output.js");
  });
});
