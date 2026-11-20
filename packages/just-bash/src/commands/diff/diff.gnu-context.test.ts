import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Context format, selected with -c.
 *
 * Every expected string in this file was produced by running GNU diffutils
 * 3.12 on the same two inputs and freezing its output verbatim,
 * with only the two header lines replaced (GNU stamps them with the files'
 * mtimes; just-bash omits the timestamp so its output is reproducible).
 */
describe("diff context format (-c) vs GNU diffutils 3.12", () => {
  describe("context format (-c)", () => {
    it("matches GNU for a single changed line", async () => {
      const env = new Bash({
        files: { "/a.txt": "a\nb\nc\n", "/b.txt": "a\nX\nc\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,3 ****\n  a\n! b\n  c\n--- 1,3 ----\n  a\n! X\n  c\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for a pure insertion in the middle", async () => {
      const env = new Bash({
        files: { "/a.txt": "l1\nl2\nl3\n", "/b.txt": "l1\nNEW\nl2\nl3\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,3 ****\n--- 1,4 ----\n  l1\n+ NEW\n  l2\n  l3\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for an insertion at the end", async () => {
      const env = new Bash({
        files: { "/a.txt": "a\nb\n", "/b.txt": "a\nb\nc\nd\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,2 ****\n--- 1,4 ----\n  a\n  b\n+ c\n+ d\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for an insertion at the start", async () => {
      const env = new Bash({
        files: { "/a.txt": "b\nc\n", "/b.txt": "a\nb\nc\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,2 ****\n--- 1,3 ----\n+ a\n  b\n  c\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for a pure deletion in the middle", async () => {
      const env = new Bash({
        files: { "/a.txt": "l1\nl2\nl3\n", "/b.txt": "l1\nl3\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,3 ****\n  l1\n- l2\n  l3\n--- 1,2 ----\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for a deletion at the start", async () => {
      const env = new Bash({
        files: { "/a.txt": "a\nb\nc\n", "/b.txt": "b\nc\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,3 ****\n- a\n  b\n  c\n--- 1,2 ----\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for a multi-line deletion", async () => {
      const env = new Bash({
        files: { "/a.txt": "a\nb\nc\nd\n", "/b.txt": "a\nd\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,4 ****\n  a\n- b\n- c\n  d\n--- 1,2 ----\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for two hunks far enough apart to stay separate", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "A\nm0\nm1\nm2\nm3\nm4\nm5\nm6\nB\n",
          "/b.txt": "A1\nm0\nm1\nm2\nm3\nm4\nm5\nm6\nB1\n",
        },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,4 ****\n! A\n  m0\n  m1\n  m2\n--- 1,4 ----\n! A1\n  m0\n  m1\n  m2\n***************\n*** 6,9 ****\n  m4\n  m5\n  m6\n! B\n--- 6,9 ----\n  m4\n  m5\n  m6\n! B1\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for two changes close enough for GNU to merge them", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "A\nm0\nm1\nm2\nm3\nm4\nm5\nB\n",
          "/b.txt": "A1\nm0\nm1\nm2\nm3\nm4\nm5\nB1\n",
        },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,8 ****\n! A\n  m0\n  m1\n  m2\n  m3\n  m4\n  m5\n! B\n--- 1,8 ----\n! A1\n  m0\n  m1\n  m2\n  m3\n  m4\n  m5\n! B1\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for an insertion and a deletion in one hunk", async () => {
      const env = new Bash({
        files: {
          "/a.txt": "k1\nDEL\nk2\nk3\nk4\n",
          "/b.txt": "k1\nk2\nk3\nADD\nk4\n",
        },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,5 ****\n  k1\n- DEL\n  k2\n  k3\n  k4\n--- 1,5 ----\n  k1\n  k2\n  k3\n+ ADD\n  k4\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for an empty file against a non-empty one", async () => {
      const env = new Bash({ files: { "/a.txt": "", "/b.txt": "a\nb\n" } });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 0 ****\n--- 1,2 ----\n+ a\n+ b\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for a non-empty file against an empty one", async () => {
      const env = new Bash({ files: { "/a.txt": "a\nb\n", "/b.txt": "" } });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,2 ****\n- a\n- b\n--- 0 ----\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for neither file ending in a newline", async () => {
      const env = new Bash({
        files: { "/a.txt": "a\nb\nc", "/b.txt": "a\nX\nc" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,3 ****\n  a\n! b\n  c\n\\ No newline at end of file\n--- 1,3 ----\n  a\n! X\n  c\n\\ No newline at end of file\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for only the second file missing its final newline", async () => {
      const env = new Bash({
        files: { "/a.txt": "a\nb\nc\n", "/b.txt": "a\nX\nc" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,3 ****\n  a\n! b\n! c\n--- 1,3 ----\n  a\n! X\n! c\n\\ No newline at end of file\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for only the first file missing its final newline", async () => {
      const env = new Bash({
        files: { "/a.txt": "a\nb\nc", "/b.txt": "a\nb\nc\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,3 ****\n  a\n  b\n! c\n\\ No newline at end of file\n--- 1,3 ----\n  a\n  b\n! c\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for a blank line as context", async () => {
      const env = new Bash({
        files: { "/a.txt": "x\n\ny\n", "/b.txt": "X\n\ny\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,3 ****\n! x\n  \n  y\n--- 1,3 ----\n! X\n  \n  y\n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });

    it("matches GNU for a line changed to a blank line", async () => {
      const env = new Bash({
        files: { "/a.txt": "a\nb\n", "/b.txt": "a\n\n" },
      });
      const result = await env.exec("diff -c /a.txt /b.txt");
      expect(result.stdout).toBe(
        "*** /a.txt\n--- /b.txt\n***************\n*** 1,2 ****\n  a\n! b\n--- 1,2 ----\n  a\n! \n",
      );
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(1);
    });
  });
});
