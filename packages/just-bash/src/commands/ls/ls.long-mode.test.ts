import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * The mode column of a long listing reports the entry's own permission bits,
 * so a file keeps whatever `chmod` gave it and a symlink reads `l` followed by
 * the name of its target. Verified against GNU coreutils 9.4 `ls -l`.
 */

const DATE = String.raw`\w{3}\s+\d+\s+[\d:]+`;

describe("ls -l mode column", () => {
  it("shows the mode a file was given", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.sh": "a\n" } });
    const result = await bash.exec("chmod 755 f.sh; ls -l f.sh");
    expect(result.stdout).toMatch(
      new RegExp(`^-rwxr-xr-x 1 user user     2 ${DATE} f\\.sh\n$`),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("shows a private file as -rw-------", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/secret.txt": "body\n" } });
    const result = await bash.exec("chmod 600 secret.txt; ls -l secret.txt");
    expect(result.stdout).toMatch(
      new RegExp(`^-rw------- 1 user user     5 ${DATE} secret\\.txt\n$`),
    );
    expect(result.stderr).toBe("");
  });

  it("shows each entry's own mode in a directory listing", async () => {
    const bash = new Bash({
      cwd: "/w",
      files: {
        "/w/plain.txt": "one\n",
        "/w/script.sh": "two\n",
        "/w/private/nested.txt": "three\n",
      },
    });
    const result = await bash.exec(
      "chmod 640 plain.txt; chmod 755 script.sh; chmod 700 private; ls -l",
    );
    expect(result.stdout).toMatch(
      new RegExp(
        `^total 3\n` +
          `-rw-r----- 1 user user     4 ${DATE} plain\\.txt\n` +
          `drwx------ 1 user user     0 ${DATE} private\n` +
          `-rwxr-xr-x 1 user user     4 ${DATE} script\\.sh\n$`,
      ),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("shows the real mode for . and .. under -a", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/d/f.txt": "" } });
    const result = await bash.exec("chmod 700 d; chmod 750 /w; ls -la d");
    expect(result.stdout).toMatch(
      new RegExp(
        `^total 3\n` +
          `drwx------ 1 user user     0 Jan  1 00:00 \\.\n` +
          `drwxr-x--- 1 user user     0 Jan  1 00:00 \\.\\.\n` +
          `-rw-r--r-- 1 user user     0 ${DATE} f\\.txt\n$`,
      ),
    );
    expect(result.stderr).toBe("");
  });

  it("shows a symlink as lrwxrwxrwx with its target", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.sh": "a\n" } });
    await bash.exec("chmod 755 f.sh; ln -s f.sh link");
    const result = await bash.exec("ls -l link");
    expect(result.stdout).toMatch(
      new RegExp(`^lrwxrwxrwx 1 user user     4 ${DATE} link -> f\\.sh\n$`),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("shows a symlink entry in a directory listing", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/target.txt": "abc\n" } });
    await bash.exec("ln -s target.txt link");
    const result = await bash.exec("ls -l");
    expect(result.stdout).toMatch(
      new RegExp(
        `^total 2\n` +
          `lrwxrwxrwx 1 user user    10 ${DATE} link -> target\\.txt\n` +
          `-rw-r--r-- 1 user user     4 ${DATE} target\\.txt\n$`,
      ),
    );
    expect(result.stderr).toBe("");
  });

  it("shows a broken symlink, which has no target to stat", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/keep.txt": "" } });
    await bash.exec("ln -s nowhere brk");
    const result = await bash.exec("ls -l");
    expect(result.stdout).toMatch(
      new RegExp(
        `^total 2\n` +
          `lrwxrwxrwx 1 user user     7 ${DATE} brk -> nowhere\n` +
          `-rw-r--r-- 1 user user     0 ${DATE} keep\\.txt\n$`,
      ),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("shows a symlink operand under -d", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/d/f.txt": "" } });
    await bash.exec("ln -s d dd");
    const result = await bash.exec("ls -ld dd");
    expect(result.stdout).toMatch(
      new RegExp(`^lrwxrwxrwx 1 user user     1 ${DATE} dd -> d\n$`),
    );
    expect(result.stderr).toBe("");
  });

  it("keeps the -F suffix after the arrow of a symlink", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/f.sh": "a\n" } });
    await bash.exec("ln -s f.sh link");
    const result = await bash.exec("ls -lF link");
    expect(result.stdout).toMatch(
      new RegExp(`^lrwxrwxrwx 1 user user     4 ${DATE} link -> f\\.sh@\n$`),
    );
    expect(result.stderr).toBe("");
  });

  it("shows a directory's real mode for -d", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/d/f.txt": "" } });
    const result = await bash.exec("chmod 751 d; ls -ld d");
    expect(result.stdout).toMatch(
      new RegExp(`^drwxr-x--x 1 user user     0 ${DATE} d\n$`),
    );
    expect(result.stderr).toBe("");
  });
});
