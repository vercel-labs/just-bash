import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * Multi-pattern validation for `grep -f`. Alternatives are concatenated
 * textually, so a malformed pattern must be rejected rather than allowed to
 * absorb its neighbour. Expectations verified against GNU grep 3.12 (which
 * reports its own wording, e.g. "Trailing backslash"; just-bash keeps its
 * existing `invalid regular expression` phrasing).
 */
describe("grep -f invalid patterns", () => {
  const hay = { "/hay.txt": "apple pie\ncherry\nbanana split\n" };

  it("rejects a trailing backslash instead of swallowing the next pattern", async () => {
    const env = new Bash({
      files: { ...hay, "/bad.txt": "a\\\nbanana\n" },
    });
    const result = await env.exec("grep -f /bad.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: invalid regular expression: a\\\n");
    expect(result.exitCode).toBe(2);
  });

  it("rejects a trailing backslash under -v too", async () => {
    const env = new Bash({
      files: { ...hay, "/bad.txt": "a\\\nbanana\n" },
    });
    const result = await env.exec("grep -v -f /bad.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: invalid regular expression: a\\\n");
    expect(result.exitCode).toBe(2);
  });

  it("rejects an unmatched bracket expression", async () => {
    const env = new Bash({
      files: { ...hay, "/bad.txt": "[a\nb]c\n" },
    });
    const result = await env.exec("grep -f /bad.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: invalid regular expression: [a\n");
    expect(result.exitCode).toBe(2);
  });

  it("rejects an unmatched group with -E", async () => {
    const env = new Bash({
      files: { ...hay, "/bad.txt": "(a\nb)c\n" },
    });
    const result = await env.exec("grep -E -f /bad.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: invalid regular expression: (a\n");
    expect(result.exitCode).toBe(2);
  });

  it("accepts a backslash in -F patterns, which are literal", async () => {
    const env = new Bash({
      files: { ...hay, "/bad.txt": "a\\\nbanana\n" },
    });
    const result = await env.exec("grep -F -f /bad.txt /hay.txt");
    expect(result.stdout).toBe("banana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("grep -P with multiple patterns", () => {
  const files = {
    "/hay.txt": "apple pie\ncherry\nbanana split\n",
    "/two.txt": "apple\nbanana\n",
    "/one.txt": "apple\n",
  };

  it("refuses more than one pattern from a file", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -P -f /two.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "grep: the -P option only supports a single pattern\n",
    );
    expect(result.exitCode).toBe(2);
  });

  it("refuses a -e pattern combined with a -f pattern", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -P -e cherry -f /one.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "grep: the -P option only supports a single pattern\n",
    );
    expect(result.exitCode).toBe(2);
  });

  it("refuses a newline-separated PATTERNS operand", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -P \"$(printf 'a\\nb')\" /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "grep: the -P option only supports a single pattern\n",
    );
    expect(result.exitCode).toBe(2);
  });

  it("folds duplicate patterns before counting", async () => {
    const env = new Bash({ files: { ...files, "/dup.txt": "apple\napple\n" } });
    const result = await env.exec("grep -P -f /dup.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("accepts a single pattern from a file", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -P -f /one.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("accepts a single empty pattern from a file", async () => {
    const env = new Bash({ files: { ...files, "/blank.txt": "\n" } });
    const result = await env.exec("grep -P -f /blank.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\ncherry\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("short-circuits an empty pattern file before the -P check", async () => {
    const env = new Bash({ files: { ...files, "/empty.txt": "" } });
    const result = await env.exec("grep -P -f /empty.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });
});

describe("grep -f argument handling", () => {
  const hay = { "/hay.txt": "apple pie\n" };

  it("reports an empty -f value as an empty file name", async () => {
    const env = new Bash({ files: hay });
    const result = await env.exec("grep -f '' /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: : No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("reports an empty --file= value as an empty file name", async () => {
    const env = new Bash({ files: hay });
    const result = await env.exec("grep --file= /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: : No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("uses the long-option wording when --file has no argument", async () => {
    const env = new Bash({ files: hay });
    const result = await env.exec("grep --file");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: option '--file' requires an argument\n");
    expect(result.exitCode).toBe(2);
  });

  it("uses the short-option wording when -f has no argument", async () => {
    const env = new Bash({ files: hay });
    const result = await env.exec("grep -f");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: option requires an argument -- 'f'\n");
    expect(result.exitCode).toBe(2);
  });
});
