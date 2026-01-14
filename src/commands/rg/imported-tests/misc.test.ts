/**
 * Tests imported from ripgrep: tests/misc.rs
 *
 * Miscellaneous tests for various ripgrep behaviors.
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

describe("rg misc: single file search", () => {
  it("should search single file without filename prefix", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg Sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Sherlock");
    expect(result.stdout).not.toContain("sherlock:");
  });
});

describe("rg misc: directory search", () => {
  it("should search directory with filename prefix", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("sherlock:");
  });
});

describe("rg misc: line numbers", () => {
  it("should show line numbers with -n", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -n Sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1:");
    expect(result.stdout).toContain("3:");
  });
});

describe("rg misc: inverted match", () => {
  it("should invert match with -v", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -v Sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Holmeses");
    expect(result.stdout).toContain("can extract");
    expect(result.stdout).toContain("but Doctor Watson");
    expect(result.stdout).toContain("exhibited clearly");
    expect(result.stdout).not.toContain("the Sherlock");
  });

  it("should show line numbers with inverted match", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -n -v Sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("2:");
    expect(result.stdout).toContain("4:");
    expect(result.stdout).toContain("5:");
    expect(result.stdout).toContain("6:");
  });
});

describe("rg misc: case insensitive", () => {
  it("should search case-insensitively with -i", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -i sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Sherlock");
  });
});

describe("rg misc: word match", () => {
  it("should match whole words with -w", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -w as sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("as opposed");
  });

  it("should handle period as word with -ow", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/haystack": "...\n",
      },
    });
    const result = await bash.exec("rg -ow '.' haystack");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(".\n.\n.\n");
  });
});

describe("rg misc: line match", () => {
  it("should match whole lines with -x", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec(
      "rg -x 'and exhibited clearly, with a label attached.' sherlock",
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "and exhibited clearly, with a label attached.\n",
    );
  });
});

describe("rg misc: literal match", () => {
  it("should match literal strings with -F", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "blib\n()\nblab\n",
      },
    });
    const result = await bash.exec("rg -F '()' file");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("()\n");
  });
});

describe("rg misc: quiet mode", () => {
  it("should suppress output with -q", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -q Sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});

describe("rg misc: file types", () => {
  it("should filter by type with -t", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
        "/home/user/file.py": "Sherlock\n",
        "/home/user/file.rs": "Sherlock\n",
      },
    });
    const result = await bash.exec("rg -t rust Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file.rs:1:Sherlock\n");
  });

  it("should negate type with -T", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.py": "Sherlock\n",
        "/home/user/file.rs": "Sherlock\n",
      },
    });
    const result = await bash.exec("rg -T rust Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file.py:1:Sherlock\n");
  });
});

describe("rg misc: glob patterns", () => {
  it("should filter by glob with -g", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
        "/home/user/file.py": "Sherlock\n",
        "/home/user/file.rs": "Sherlock\n",
      },
    });
    const result = await bash.exec("rg -g '*.rs' Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file.rs:1:Sherlock\n");
  });

  it("should negate glob with -g !", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.py": "Sherlock\n",
        "/home/user/file.rs": "Sherlock\n",
      },
    });
    const result = await bash.exec("rg -g '!*.rs' Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file.py:1:Sherlock\n");
  });

  it("should use case-sensitive glob matching", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file1.HTML": "Sherlock\n",
        "/home/user/file2.html": "Sherlock\n",
      },
    });
    const result = await bash.exec("rg --glob '*.html' Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file2.html:1:Sherlock\n");
  });
});

describe("rg misc: count", () => {
  it("should count matching lines with --count", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg --count Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("sherlock:2\n");
  });
});

describe("rg misc: files with matches", () => {
  it("should list files with --files-with-matches", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg --files-with-matches Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("sherlock\n");
  });

  it("should list files without match with --files-without-match", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
        "/home/user/file.py": "foo\n",
      },
    });
    const result = await bash.exec("rg --files-without-match Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file.py\n");
  });
});

describe("rg misc: after context", () => {
  it("should show after context with -A", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -A 1 Sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Sherlock");
    expect(result.stdout).toContain("Holmeses");
    expect(result.stdout).toContain("can extract");
  });

  it("should show after context with line numbers", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -A 1 -n Sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1:");
    expect(result.stdout).toContain("2-");
    expect(result.stdout).toContain("3:");
    expect(result.stdout).toContain("4-");
  });
});

describe("rg misc: before context", () => {
  it("should show before context with -B", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -B 1 Sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Sherlock");
    expect(result.stdout).toContain("Holmeses");
  });

  it("should show before context with line numbers", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -B 1 -n Sherlock sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1:");
    expect(result.stdout).toContain("2-");
    expect(result.stdout).toContain("3:");
  });
});

describe("rg misc: combined context", () => {
  it("should show context with -C", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -C 1 'world|attached' sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("world");
    expect(result.stdout).toContain("attached");
    expect(result.stdout).toContain("--"); // Context separator
  });

  it("should show context with line numbers", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg -C 1 -n 'world|attached' sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("1:");
    expect(result.stdout).toContain("2-");
    expect(result.stdout).toContain("5-");
    expect(result.stdout).toContain("6:");
  });
});

describe("rg misc: hidden files", () => {
  it("should ignore hidden files by default", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg Sherlock");
    expect(result.exitCode).toBe(1);
  });

  it("should include hidden files with --hidden", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.sherlock": SHERLOCK,
      },
    });
    const result = await bash.exec("rg --hidden Sherlock");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(".sherlock:");
  });
});

describe("rg misc: gitignore", () => {
  it("should respect .gitignore", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
        "/home/user/.gitignore": "sherlock\n",
      },
    });
    const result = await bash.exec("rg Sherlock");
    expect(result.exitCode).toBe(1);
  });

  it("should respect .ignore", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock": SHERLOCK,
        "/home/user/.ignore": "sherlock\n",
      },
    });
    const result = await bash.exec("rg Sherlock");
    expect(result.exitCode).toBe(1);
  });
});

describe("rg misc: only matching", () => {
  it("should show only matching parts with -o", async () => {
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

describe("rg misc: regex patterns", () => {
  it("should match alternation patterns", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "cat\ndog\nbird\n",
      },
    });
    const result = await bash.exec("rg 'cat|dog'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file:1:cat\nfile:2:dog\n");
  });

  it("should match character classes", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "a1b2c3\n",
      },
    });
    const result = await bash.exec("rg '[0-9]+'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("a1b2c3");
  });

  it("should match word boundaries", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "foo foobar barfoo\n",
      },
    });
    const result = await bash.exec("rg '\\bfoo\\b'");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("foo foobar");
  });
});

describe("rg misc: subdirectories", () => {
  it("should search subdirectories recursively", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/dir/file.txt": "test\n",
        "/home/user/dir/sub/file.txt": "test\n",
      },
    });
    const result = await bash.exec("rg test");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("dir/file.txt");
    expect(result.stdout).toContain("dir/sub/file.txt");
  });
});

describe("rg misc: multiple patterns with -e", () => {
  it("should match multiple patterns", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "foo\nbar\nbaz\n",
      },
    });
    const result = await bash.exec("rg -e foo -e bar");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("foo");
    expect(result.stdout).toContain("bar");
    expect(result.stdout).not.toContain("baz");
  });
});

describe("rg misc: smart case", () => {
  it("should use smart case with lowercase pattern", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "TEST\ntest\nTest\n",
      },
    });
    const result = await bash.exec("rg test");
    expect(result.exitCode).toBe(0);
    // Smart case: lowercase = case insensitive
    expect(result.stdout).toContain("TEST");
    expect(result.stdout).toContain("test");
    expect(result.stdout).toContain("Test");
  });

  it("should use smart case with uppercase pattern", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file": "TEST\ntest\nTest\n",
      },
    });
    const result = await bash.exec("rg TEST");
    expect(result.exitCode).toBe(0);
    // Smart case: uppercase = case sensitive
    expect(result.stdout).toContain("TEST");
    expect(result.stdout).not.toContain("test\n");
    expect(result.stdout).not.toContain("Test\n");
  });
});

// Gzip tests from ripgrep misc.rs (compressed_gzip, etc.)
// Note: Only gzip is supported, not bzip2, xz, lz4, lzma, brotli, zstd, or compress
describe("rg misc: compressed files (-z)", () => {
  // Dynamically import gzipSync to avoid issues
  const { gzipSync } = require("node:zlib");

  it("compressed_gzip: should search in gzip compressed files with -z", async () => {
    const compressed = gzipSync(Buffer.from(SHERLOCK));
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/sherlock.gz": compressed,
      },
    });
    const result = await bash.exec("rg -z Sherlock sherlock.gz");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Sherlock");
  });

  it("should search gzip files recursively with -z", async () => {
    const compressed = gzipSync(Buffer.from("hello world\n"));
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/test.gz": compressed,
        "/home/user/plain.txt": "hello there\n",
      },
    });
    const result = await bash.exec("rg -z hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("test.gz");
    expect(result.stdout).toContain("plain.txt");
  });

  it("should not decompress without -z flag", async () => {
    const compressed = gzipSync(Buffer.from("hello world\n"));
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/test.gz": compressed,
        "/home/user/plain.txt": "hello there\n",
      },
    });
    const result = await bash.exec("rg hello");
    expect(result.exitCode).toBe(0);
    // Should only find the plain text file
    expect(result.stdout).toBe("plain.txt:1:hello there\n");
  });

  // Note: compressed_failing_gzip test not implemented - we don't validate gzip magic bytes
  // before attempting decompression
});
