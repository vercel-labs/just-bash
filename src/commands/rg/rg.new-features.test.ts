/**
 * Tests for new rg features: -z (compressed), -L (symlinks), --json, -u (unrestricted)
 */

import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Bash } from "../../index.js";

const SHERLOCK = `For the Doctor Watsons of this world, as opposed to the Sherlock
Holmeses, success in the province of detective work must always
be, to a very large extent, the result of luck. Sherlock Holmes
can extract a clew from a wisp of straw or a flake of cigar ash;
but Doctor Watson has to have it taken out for him and dusted,
and handed to him on a plate.
`;

describe("rg -z (compressed files)", () => {
  it("should search in gzip compressed files with -z", async () => {
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

  it("should search in gzip compressed files recursively with -z", async () => {
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

  it("should not search compressed files without -z", async () => {
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
});

describe("rg -L (follow symlinks)", () => {
  it("should accept -L/--follow flag without error", async () => {
    // Test that -L flag is recognized (actual symlink support depends on VFS)
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "hello world\n",
      },
    });
    const result = await bash.exec("rg -L hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file.txt:1:hello world\n");
  });

  it("should accept --follow flag without error", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/file.txt": "hello world\n",
      },
    });
    const result = await bash.exec("rg --follow hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("file.txt:1:hello world\n");
  });
});

describe("rg --json (JSON output)", () => {
  it("should output JSON Lines format with --json", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/test.txt": "hello world\n",
      },
    });
    const result = await bash.exec("rg --json hello test.txt");
    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3); // begin, match, end, summary

    // Parse JSON Lines
    const messages = lines.map((line) => JSON.parse(line));

    // Check begin message
    const begin = messages.find((m) => m.type === "begin");
    expect(begin).toBeDefined();
    expect(begin.data.path.text).toBe("test.txt");

    // Check match message
    const match = messages.find((m) => m.type === "match");
    expect(match).toBeDefined();
    expect(match.data.lines.text).toBe("hello world\n");
    expect(match.data.line_number).toBe(1);
    expect(match.data.submatches.length).toBe(1);
    expect(match.data.submatches[0].match.text).toBe("hello");

    // Check end message
    const end = messages.find((m) => m.type === "end");
    expect(end).toBeDefined();

    // Check summary message
    const summary = messages.find((m) => m.type === "summary");
    expect(summary).toBeDefined();
    expect(summary.data.stats.searches_with_match).toBe(1);
  });

  it("should include submatches with correct offsets in JSON", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/test.txt": "foo bar foo\n",
      },
    });
    const result = await bash.exec("rg --json foo test.txt");
    expect(result.exitCode).toBe(0);

    const lines = result.stdout.trim().split("\n");
    const messages = lines.map((line) => JSON.parse(line));
    const match = messages.find((m) => m.type === "match");

    expect(match.data.submatches.length).toBe(2);
    expect(match.data.submatches[0].start).toBe(0);
    expect(match.data.submatches[0].end).toBe(3);
    expect(match.data.submatches[1].start).toBe(8);
    expect(match.data.submatches[1].end).toBe(11);
  });
});

describe("rg -u (unrestricted)", () => {
  it("should ignore gitignore with -u", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "ignored.txt\n",
        "/home/user/ignored.txt": "hello\n",
        "/home/user/visible.txt": "hello\n",
      },
    });
    // Without -u, ignored.txt should not be searched
    let result = await bash.exec("rg hello");
    expect(result.stdout).toBe("visible.txt:1:hello\n");

    // With -u, ignored.txt should be searched
    result = await bash.exec("rg -u hello");
    expect(result.stdout).toContain("ignored.txt");
    expect(result.stdout).toContain("visible.txt");
  });

  it("should search hidden files with -uu", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.hidden": "hello\n",
        "/home/user/visible.txt": "hello\n",
      },
    });
    // Without -uu, .hidden should not be searched
    let result = await bash.exec("rg hello");
    expect(result.stdout).toBe("visible.txt:1:hello\n");

    // With -uu (--no-ignore --hidden), .hidden should be searched
    result = await bash.exec("rg -uu hello");
    expect(result.stdout).toContain(".hidden");
    expect(result.stdout).toContain("visible.txt");
  });

  it("-u should be equivalent to --no-ignore", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.gitignore": "ignored.txt\n",
        "/home/user/ignored.txt": "hello\n",
      },
    });
    const resultU = await bash.exec("rg -u hello");
    const resultNoIgnore = await bash.exec("rg --no-ignore hello");
    expect(resultU.stdout).toBe(resultNoIgnore.stdout);
  });

  it("-uu should be equivalent to --no-ignore --hidden", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/.hidden": "hello\n",
      },
    });
    const resultUU = await bash.exec("rg -uu hello");
    const resultFlags = await bash.exec("rg --no-ignore --hidden hello");
    expect(resultUU.stdout).toBe(resultFlags.stdout);
  });
});

describe("rg -a (text/binary)", () => {
  it("should search binary files as text with -a", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/binary.bin": "hello\x00world\n",
      },
    });
    // Without -a, binary should be skipped
    let result = await bash.exec("rg hello");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");

    // With -a, binary should be searched
    result = await bash.exec("rg -a hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("binary.bin");
  });
});

describe("rg symlink handling in directory traversal", () => {
  it("should skip symlinks by default in directory search", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/real.txt": "hello\n",
      },
    });
    // Create a symlink to the file
    await bash.exec("ln -s real.txt /home/user/link.txt");

    // Without -L, symlinks should be skipped
    const result = await bash.exec("rg hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("real.txt:1:hello\n");
    expect(result.stdout).not.toContain("link.txt");
  });

  it("should follow symlinks with -L in directory search", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/real.txt": "hello\n",
      },
    });
    // Create a symlink to the file
    await bash.exec("ln -s real.txt /home/user/link.txt");

    // With -L, symlinks should be followed
    const result = await bash.exec("rg -L hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("real.txt");
    expect(result.stdout).toContain("link.txt");
  });

  it("should follow symlinks to directories with -L", async () => {
    const bash = new Bash({
      cwd: "/home/user",
      files: {
        "/home/user/subdir/file.txt": "hello\n",
      },
    });
    // Create a symlink to the directory
    await bash.exec("ln -s subdir /home/user/linkdir");

    // Without -L, should only find file in real directory
    let result = await bash.exec("rg hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("subdir/file.txt:1:hello\n");

    // With -L, should find file through both paths
    result = await bash.exec("rg -L hello");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("subdir/file.txt");
    expect(result.stdout).toContain("linkdir/file.txt");
  });
});
