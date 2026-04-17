import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq raw input (-R)", () => {
  it("should read stdin lines as strings with -R", async () => {
    const env = new Bash();
    const result = await env.exec("printf 'a\\nb\\n' | jq -R '.'");
    expect(result.stdout).toBe('"a"\n"b"\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should preserve blank lines with -R", async () => {
    const env = new Bash();
    const result = await env.exec("printf 'a\\n\\nb' | jq -R '.'");
    expect(result.stdout).toBe('"a"\n""\n"b"\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should slurp raw stdin into a single string with -Rs", async () => {
    const env = new Bash();
    const result = await env.exec("printf 'a\\nb\\n' | jq -Rs '.'");
    expect(result.stdout).toBe('"a\\nb\\n"\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should read raw input from files line by line", async () => {
    const env = new Bash({
      files: {
        "/a.txt": "first\n",
        "/b.txt": "second",
      },
    });
    const result = await env.exec("jq -R '.' /a.txt /b.txt");
    expect(result.stdout).toBe('"first"\n"second"\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should slurp raw input across files without inserting separators", async () => {
    const env = new Bash({
      files: {
        "/a.txt": "first\n",
        "/b.txt": "second",
      },
    });
    const result = await env.exec("jq -Rs '.' /a.txt /b.txt");
    expect(result.stdout).toBe('"first\\nsecond"\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should handle stdin marker together with files in raw mode", async () => {
    const env = new Bash({
      files: {
        "/file.txt": "file\n",
      },
    });
    const result = await env.exec("printf 'stdin\\n' | jq -R '.' - /file.txt");
    expect(result.stdout).toBe('"stdin"\n"file"\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should allow raw input with raw output", async () => {
    const env = new Bash();
    const result = await env.exec("printf 'hello\\n' | jq -Rr '.'");
    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should produce no output for empty raw input", async () => {
    const env = new Bash();
    const result = await env.exec("printf '' | jq -R '.'");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should slurp empty raw input into an empty string", async () => {
    const env = new Bash();
    const result = await env.exec("printf '' | jq -Rs '.'");
    expect(result.stdout).toBe('""\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
