import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * How `ls` arranges more than one operand.
 *
 * Operands are not listed in the order they were given. Everything that is
 * not a directory prints first, as one block in sort order with no label and
 * no separator; each directory follows, in sort order, labeled `name:` and
 * preceded by a blank line. A single directory operand is the exception and
 * prints bare. Diagnostics for operands that do not exist go to stderr and
 * set the status to 2, leaving the surviving operands to list normally.
 *
 * The blank line matters beyond cosmetics: `find … -exec ls -l {} +` and
 * `xargs ls -l` hand `ls` a batch of file operands, and a separator between
 * them puts empty lines through whatever sorts or counts the result.
 *
 * Measured against GNU coreutils ls 9.2, cross-checked against BSD ls
 * (macOS 15), which agrees on every case here.
 */

const FILES = {
  "/w/f1.txt": "a\n",
  "/w/f2.txt": "b\n",
  "/w/dir1/x.txt": "c\n",
  "/w/dir2/y.txt": "d\n",
};

async function run(command: string) {
  return await new Bash({ cwd: "/w", files: FILES }).exec(command);
}

describe("ls groups multiple operands", () => {
  it("does not separate file operands", async () => {
    const result = await run("ls -1 f1.txt f2.txt");
    expect(result.stdout).toBe("f1.txt\nf2.txt\n");
    expect(result.exitCode).toBe(0);
  });

  it("prints files before directories regardless of operand order", async () => {
    const result = await run("ls -1 dir2 f2.txt f1.txt dir1");
    expect(result.stdout).toBe(
      "f1.txt\nf2.txt\n\ndir1:\nx.txt\n\ndir2:\ny.txt\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("separates a directory group from the files above it", async () => {
    const result = await run("ls -1 f1.txt dir1");
    expect(result.stdout).toBe("f1.txt\n\ndir1:\nx.txt\n");
  });

  it("separates directory groups from each other without a leading blank", async () => {
    const result = await run("ls -1 dir1 dir2");
    expect(result.stdout).toBe("dir1:\nx.txt\n\ndir2:\ny.txt\n");
  });

  it("leaves a lone directory operand unlabeled", async () => {
    const result = await run("ls -1 dir1");
    expect(result.stdout).toBe("x.txt\n");
  });

  it("reverses both groups under -r", async () => {
    const result = await run("ls -1r f1.txt f2.txt dir1 dir2");
    expect(result.stdout).toBe(
      "f2.txt\nf1.txt\n\ndir2:\ny.txt\n\ndir1:\nx.txt\n",
    );
  });

  it("orders file operands by size under -S", async () => {
    const bash = new Bash({
      cwd: "/w",
      files: { "/w/small.txt": "a\n", "/w/big.txt": "a".repeat(50) },
    });
    const result = await bash.exec("ls -1S small.txt big.txt");
    expect(result.stdout).toBe("big.txt\nsmall.txt\n");
  });

  it("lists the operands that exist and reports the one that does not", async () => {
    const result = await run("ls -1 nope.txt f2.txt dir1 f1.txt");
    expect(result.stdout).toBe("f1.txt\nf2.txt\n\ndir1:\nx.txt\n");
    expect(result.stderr).toBe("ls: nope.txt: No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("keeps -d operands in one unseparated block", async () => {
    const result = await run("ls -1d dir2 f1.txt dir1");
    expect(result.stdout).toBe("dir1\ndir2\nf1.txt\n");
    expect(result.exitCode).toBe(0);
  });
});
