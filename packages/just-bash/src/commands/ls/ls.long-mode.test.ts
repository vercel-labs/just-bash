import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * The mode column of a long listing reports the entry's own permission bits,
 * so a file keeps whatever `chmod` gave it and a symlink reads `l` followed by
 * the name of its target.
 *
 * Every mode character asserted below was checked against GNU coreutils 9.4
 * `ls -l`, except one deliberate deviation: with `-F`, just-bash appends `@` to
 * a symlink after the arrow (`link -> target@`) where coreutils puts the
 * indicator on the target instead and never prints `@` in long format. That is
 * just-bash's pre-existing BSD-style convention, unchanged by this work, and
 * the two `-F` cases below pin it rather than coreutils' behavior.
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

  // `.` is the directory being listed, never the symlink that names it, so a
  // listing reached through a link reports the directory's own mode. Verified
  // against `ls -la mylink/` in a directory where `mylink -> d` and `d` is
  // 0700, which coreutils 9.4 prints as `drwx------ ... .`.
  it("describes . as the directory behind a symlinked operand", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/d/f.txt": "" } });
    await bash.exec("chmod 700 d; ln -s d mylink");
    const result = await bash.exec("ls -la mylink/");
    expect(result.stdout).toMatch(
      new RegExp(
        `^total 3\n` +
          `drwx------ 1 user user     0 Jan  1 00:00 \\.\n` +
          `drwxr-xr-x 1 user user     0 Jan  1 00:00 \\.\\.\n` +
          `-rw-r--r-- 1 user user     0 ${DATE} f\\.txt\n$`,
      ),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("describes . as the directory behind a symlinked cwd", async () => {
    const bash = new Bash({ cwd: "/w", files: { "/w/d/f.txt": "" } });
    await bash.exec("chmod 700 d; ln -s d mylink");
    const result = await bash.exec("cd mylink; ls -la");
    expect(result.stdout).toMatch(
      new RegExp(
        `^total 3\n` +
          `drwx------ 1 user user     0 Jan  1 00:00 \\.\n` +
          `drwxr-xr-x 1 user user     0 Jan  1 00:00 \\.\\.\n` +
          `-rw-r--r-- 1 user user     0 ${DATE} f\\.txt\n$`,
      ),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  // `..` is the parent of the directory being listed, so a link into a
  // subdirectory reports that subdirectory, not the link's own parent. Real
  // bash in `lnk -> sub/deep` with `sub` 0705 prints `drwx---r-x ... ..`.
  it("describes .. as the parent of the resolved directory", async () => {
    const bash = new Bash({
      cwd: "/w",
      files: { "/w/sub/deep/f.txt": "" },
    });
    await bash.exec("chmod 705 sub; chmod 750 sub/deep; ln -s sub/deep lnk");
    const result = await bash.exec("cd lnk; ls -la");
    expect(result.stdout).toMatch(
      new RegExp(
        `^total 3\n` +
          `drwxr-x--- 1 user user     0 Jan  1 00:00 \\.\n` +
          `drwx---r-x 1 user user     0 Jan  1 00:00 \\.\\.\n` +
          `-rw-r--r-- 1 user user     0 ${DATE} f\\.txt\n$`,
      ),
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
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

  // BSD-style convention, not coreutils: coreutils puts the -F indicator on the
  // target and prints no `@` for a link in long format. See the file header.
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
