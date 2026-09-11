import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("mktemp directory options and templates", () => {
  it.each([
    "--tmpdir=",
    "-p ''",
  ])("uses /tmp for an empty directory option: %s", async (option) => {
    const env = new Bash();
    const result = await env.exec(`TMPDIR= mktemp ${option}`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\/tmp\/tmp\.[0-9A-Za-z]{10}\n$/);
    expect(await env.fs.exists(result.stdout.trim())).toBe(true);
  });

  it.each([
    "--tmpdir=",
    "-p ''",
  ])("falls back to TMPDIR for an empty directory option: %s", async (option) => {
    const env = new Bash();
    const result = await env.exec(
      `mkdir /scratch && TMPDIR=/scratch mktemp ${option}`,
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\/scratch\/tmp\.[0-9A-Za-z]{10}\n$/);
    expect(await env.fs.exists(result.stdout.trim())).toBe(true);
  });

  it("consumes a separate -p value at the end of a short-option cluster", async () => {
    const env = new Bash();
    const result = await env.exec("mkdir /scratch && mktemp -dp /scratch");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\/scratch\/tmp\.[0-9A-Za-z]{10}\n$/);
    const stat = await env.fs.stat(result.stdout.trim());
    expect(stat.isDirectory).toBe(true);
    expect(stat.mode & 0o777).toBe(0o700);
  });

  it.each([
    "-p",
    "-dp",
  ])("rejects a missing directory argument: %s", async (option) => {
    const env = new Bash();
    const result = await env.exec(`mktemp ${option}`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("mktemp: option requires an argument -- 'p'\n");
    expect(result.exitCode).toBe(1);
  });

  it.each([
    "-q",
    "--quiet",
  ])("still reports malformed templates under %s", async (option) => {
    const env = new Bash();
    const result = await env.exec(`mktemp ${option} -t bad.XX`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("mktemp: too few X's in template 'bad.XX'\n");
    expect(result.exitCode).toBe(1);
    expect(await env.fs.readdir("/tmp")).toEqual([]);
  });

  it("replaces the final run of X's and preserves earlier runs", async () => {
    const env = new Bash();
    const result = await env.exec("TMPDIR= mktemp -t XXXX.log.XXXX");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\/tmp\/XXXX\.log\.[0-9A-Za-z]{4}\n$/);
    expect(await env.fs.exists(result.stdout.trim())).toBe(true);
  });

  it("prints a single leading slash when TMPDIR is the root", async () => {
    const env = new Bash();
    const result = await env.exec("TMPDIR=/ mktemp");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\/tmp\.[0-9A-Za-z]{10}\n$/);
    expect(await env.fs.exists(result.stdout.trim())).toBe(true);
  });
});
