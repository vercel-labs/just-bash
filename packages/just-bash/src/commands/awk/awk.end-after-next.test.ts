import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("awk END after next or nextfile on the last record", () => {
  it("should run every END statement after next", async () => {
    const env = new Bash({ files: { "/in": "a\nb\n" } });
    const result = await env.exec(
      `awk '{ next } END { print "E1"; print "E2" }' /in`,
    );
    expect(result.stdout).toBe("E1\nE2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should run every END statement after nextfile", async () => {
    const env = new Bash({ files: { "/in": "a\nb\n" } });
    const result = await env.exec(
      `awk '{ nextfile } END { print "E1"; print "E2" }' /in`,
    );
    expect(result.stdout).toBe("E1\nE2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should run every END statement after next across files", async () => {
    const env = new Bash({
      files: { "/a.txt": "a1\na2\n", "/b.txt": "b1\nb2\n" },
    });
    const result = await env.exec(
      `awk '{ n++; next } END { print "E1"; print n }' /a.txt /b.txt`,
    );
    expect(result.stdout).toBe("E1\n4\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should run every END statement after nextfile across files", async () => {
    const env = new Bash({
      files: { "/a.txt": "a1\na2\n", "/b.txt": "b1\nb2\n" },
    });
    const result = await env.exec(
      `awk 'FNR == 1 { print; nextfile } END { print "E1"; print "E2" }' /a.txt /b.txt`,
    );
    expect(result.stdout).toBe("a1\nb1\nE1\nE2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should run every END statement after next on stdin", async () => {
    const env = new Bash();
    const result = await env.exec(
      `printf 'a\\nb\\n' | awk '{ next } END { print "E1"; print "E2" }'`,
    );
    expect(result.stdout).toBe("E1\nE2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should run loops and every END block after next", async () => {
    const env = new Bash({ files: { "/in": "a\nb\n" } });
    const result = await env.exec(
      `awk '{ next } END { for (i = 1; i <= 2; i++) print i } END { print "E2" }' /in`,
    );
    expect(result.stdout).toBe("1\n2\nE2\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should still stop END at exit after next", async () => {
    const env = new Bash({ files: { "/in": "a\n" } });
    const result = await env.exec(
      `awk '{ next } END { print "E1"; exit 3; print "E2" }' /in`,
    );
    expect(result.stdout).toBe("E1\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(3);
  });
});
