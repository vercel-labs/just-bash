/**
 * Tests imported from ripgrep: tests/regression.rs
 *
 * Regression tests from various GitHub issues.
 * Each test references the original issue number for traceability.
 */
import { describe, expect, it } from "vitest";
import { Bash } from "../../../Bash.js";

// Classic test fixture from ripgrep tests
const SHERLOCK = `For the Doctor Watsons of this world, as opposed to the Sherlock
Holmeses, success in the province of detective work must always
be, to a very large extent, the result of luck. Sherlock Holmes
can extract a clew from a wisp of straw or a flake of cigar ash;
but Doctor Watson has to have it taken out for him and dusted,
and exhibited clearly, with a label attached.
`;

describe("rg regression: issue #16 - directory trailing slash", () => {
  it("should handle gitignore with directory trailing slash", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "ghi/\n",
        "/home/user/ghi/toplevel.txt": "xyz\n",
        "/home/user/def/ghi/subdir.txt": "xyz\n",
      },
    });
    const result = await bash.exec("rg xyz");
    expect(result.exitCode).toBe(1);
  });
});

describe("rg regression: issue #25 - rooted gitignore pattern", () => {
  it("should handle rooted pattern in gitignore", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "/llvm/\n",
        "/home/user/src/llvm/foo": "test\n",
      },
    });
    const result = await bash.exec("rg test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("src/llvm/foo:1:test\n");
  });
});

describe("rg regression: issue #30 - negation after double-star", () => {
  it("should handle negation after double-star in gitignore", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "vendor/**\n!vendor/manifest\n",
        "/home/user/vendor/manifest": "test\n",
        "/home/user/vendor/other": "test\n",
      },
    });
    const result = await bash.exec("rg test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("vendor/manifest:1:test\n");
  });
});

describe("rg regression: issue #49 - unanchored directory pattern", () => {
  it("should handle unanchored directory pattern in gitignore", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "foo/bar\n",
        "/home/user/test/foo/bar/baz": "test\n",
      },
    });
    const result = await bash.exec("rg xyz");
    expect(result.exitCode).toBe(1);
  });
});

describe("rg regression: issue #50 - nested directory pattern", () => {
  it("should handle nested directory pattern in gitignore", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "XXX/YYY/\n",
        "/home/user/abc/def/XXX/YYY/bar": "test\n",
        "/home/user/ghi/XXX/YYY/bar": "test\n",
      },
    });
    const result = await bash.exec("rg xyz");
    expect(result.exitCode).toBe(1);
  });
});

describe("rg regression: issue #65 - simple directory ignore", () => {
  it("should handle simple directory ignore pattern", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "a/\n",
        "/home/user/a/foo": "xyz\n",
        "/home/user/a/bar": "xyz\n",
      },
    });
    const result = await bash.exec("rg xyz");
    expect(result.exitCode).toBe(1);
  });
});

describe("rg regression: issue #67 - negation of root", () => {
  it("should handle negation of root with include", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "/*\n!/dir\n",
        "/home/user/foo/bar": "test\n",
        "/home/user/dir/bar": "test\n",
      },
    });
    const result = await bash.exec("rg test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("dir/bar:1:test\n");
  });
});

describe("rg regression: issue #87 - double-star pattern", () => {
  it("should handle double-star in gitignore", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "foo\n**no-vcs**\n",
        "/home/user/foo": "test\n",
      },
    });
    const result = await bash.exec("rg test");
    expect(result.exitCode).toBe(1);
  });
});

describe("rg regression: issue #90 - negation of hidden file", () => {
  it("should handle negation of hidden file in gitignore", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "!.foo\n",
        "/home/user/.foo": "test\n",
      },
    });
    // Need --hidden to search hidden files
    const result = await bash.exec("rg --hidden test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(".foo:1:test\n");
  });
});

describe("rg regression: issue #93 - IP address regex", () => {
  it("should match IP address pattern", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/foo": "192.168.1.1\n",
      },
    });
    const result = await bash.exec("rg '(\\d{1,3}\\.){3}\\d{1,3}'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("foo:1:192.168.1.1\n");
  });
});

describe("rg regression: issue #127 - gitignore with path", () => {
  it("should handle gitignore with full path pattern", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "foo/sherlock\n",
        "/home/user/foo/sherlock": SHERLOCK,
        "/home/user/foo/watson": SHERLOCK,
      },
    });
    const result = await bash.exec("rg Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("foo/watson:");
    expect(result.stdout).not.toContain("foo/sherlock:");
  });
});

describe("rg regression: issue #184 - dot star gitignore", () => {
  it("should handle .* in gitignore properly", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": ".*\n",
        "/home/user/foo/bar/baz": "test\n",
      },
    });
    const result = await bash.exec("rg test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("foo/bar/baz:1:test\n");
  });
});

describe("rg regression: issue #199 - smart case with word boundary", () => {
  it("should use smart case with word boundary regex", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/foo": "tEsT\n",
      },
    });
    const result = await bash.exec("rg --smart-case '\\btest\\b'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("foo:1:tEsT\n");
  });
});

describe("rg regression: issue #206 - glob with subdirectory", () => {
  it("should match glob in subdirectory", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/foo/bar.txt": "test\n",
      },
    });
    const result = await bash.exec("rg test -g '*.txt'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("foo/bar.txt:1:test\n");
  });
});

describe("rg regression: issue #229 - smart case with bracket expression", () => {
  it("should be case-sensitive when pattern has uppercase in bracket", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/foo": "economie\n",
      },
    });
    const result = await bash.exec("rg -S '[E]conomie'");
    expect(result.exitCode).toBe(1); // No match - E makes it case-sensitive
  });
});

describe("rg regression: issue #251 - unicode case folding", () => {
  it("should match cyrillic with -i", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/foo": "привет\nПривет\nПрИвЕт\n",
      },
    });
    const result = await bash.exec("rg -i привет");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("foo:1:привет\nfoo:2:Привет\nfoo:3:ПрИвЕт\n");
  });
});

describe("rg regression: issue #270 - pattern starting with dash", () => {
  it("should handle -e with pattern starting with dash", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/foo": "-test\n",
      },
    });
    const result = await bash.exec("rg -e '-test'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("foo:1:-test\n");
  });
});

describe("rg regression: issue #279 - quiet mode empty output", () => {
  it("should have empty output in quiet mode", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/foo": "test\n",
      },
    });
    const result = await bash.exec("rg -q test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("rg regression: issue #405 - negated glob with path", () => {
  it("should handle negated glob with path", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/foo/bar/file1.txt": "test\n",
        "/home/user/bar/foo/file2.txt": "test\n",
      },
    });
    const result = await bash.exec("rg -g '!/foo/**' test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("bar/foo/file2.txt:1:test\n");
  });
});

describe("rg regression: issue #451 - only matching", () => {
  it("should show only matching parts", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/digits.txt": "1 2 3\n",
      },
    });
    const result = await bash.exec("rg --only-matching '[0-9]+' digits.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("1\n2\n3\n");
  });
});

describe("rg regression: issue #493 - word boundary with space", () => {
  it("should handle word boundary with leading/trailing spaces", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/input.txt": "peshwaship 're seminomata\n",
      },
    });
    const result = await bash.exec('rg -o "\\b \'re \\b" input.txt');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(" 're \n");
  });
});

describe("rg regression: issue #506 - word match with alternation", () => {
  it("should handle -w -o with alternation", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/wb.txt": "min minimum amin\nmax maximum amax\n",
      },
    });
    const result = await bash.exec("rg -w -o 'min|max' wb.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("min\nmax\n");
  });
});

describe("rg regression: issue #553 - repeated flags", () => {
  it("should handle repeated -i flag", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -i -i sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Sherlock");
  });

  it("should handle -C override", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result1 = await bash.exec("rg -C 1 'world|attached' sherlock");
    expect(result1.exitCode).toBe(0);
    expect(result1.stdout).toContain("--"); // Context separator

    const result2 = await bash.exec("rg -C 1 -C 0 'world|attached' sherlock");
    expect(result2.exitCode).toBe(0);
    expect(result2.stdout).not.toContain("--"); // No context separator with -C 0
  });
});

describe("rg regression: issue #693 - context in count mode", () => {
  it("should ignore context with -c", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/bar": "xyz\n",
        "/home/user/foo": "xyz\n",
      },
    });
    const result = await bash.exec("rg -C1 -c --sort path xyz");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("bar:1\nfoo:1\n");
  });
});

describe("rg regression: issue #807 - hidden with gitignore", () => {
  it("should handle gitignore for hidden subdirectories", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": ".a/b\n",
        "/home/user/.a/b/file": "test\n",
        "/home/user/.a/c/file": "test\n",
      },
    });
    const result = await bash.exec("rg --hidden test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(".a/c/file:1:test\n");
  });
});

describe("rg regression: misc patterns", () => {
  it("should match complex regex patterns", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/email.txt": "test@example.com\ninvalid\nfoo@bar.org\n",
      },
    });
    const result = await bash.exec("rg '[a-z]+@[a-z]+\\.[a-z]+' email.txt");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("test@example.com\nfoo@bar.org\n");
  });

  it("should match multiple patterns on same line", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "foo bar baz\n",
      },
    });
    const result = await bash.exec("rg -o 'foo|baz'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file:foo\nfile:baz\n");
  });
});

describe("rg regression: edge cases", () => {
  it("should handle empty pattern with -e", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "test\n",
      },
    });
    // Empty pattern should match everything
    const result = await bash.exec("rg -e ''");
    expect(result.exitCode).toBe(0);
  });

  it("should handle multiple -e patterns including empty", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "foo\nbar\n",
      },
    });
    const result = await bash.exec("rg -e foo -e bar");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file:1:foo\nfile:2:bar\n");
  });
});
