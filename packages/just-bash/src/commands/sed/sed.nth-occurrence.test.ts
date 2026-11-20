import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Expected output recorded from GNU sed 4.9.
const run = (args: string, input: string) =>
  new Bash({ files: { "/test.txt": input } }).exec(`sed ${args} /test.txt`);

const LINES = "x\na\naaa\n";

describe("sed s with a number and g", () => {
  it("replaces the Nth match and every later match", async () => {
    const result = await run("'s/a/b/2g'", "aaaa\n");
    expect(result.stdout).toBe("abbb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("replaces nothing when the pattern has fewer matches than the number", async () => {
    const result = await run("'s/a/b/5g'", "aaaa\n");
    expect(result.stdout).toBe("aaaa\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("expands groups and & in each replaced match", async () => {
    const result = await run("'s/\\(a\\)/[\\1&]/2g'", "aaaa\n");
    expect(result.stdout).toBe("a[aa][aa][aa]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("counts matches with the I flag", async () => {
    const result = await run("'s/A/b/2gI'", "aAaA\n");
    expect(result.stdout).toBe("abbb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("counts matches across a multiline pattern space", async () => {
    const result = await run("'N;s/a/b/3g'", "aa\naa\n");
    expect(result.stdout).toBe("aa\nbb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("matches ^ only at the start of the pattern space", async () => {
    const result = await run("'s/^a/b/2g'", "aaaa\n");
    expect(result.stdout).toBe("aaaa\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("sed s with a number and empty matches", () => {
  it("skips an empty match right after a match, without g", async () => {
    const result = await run("'s/b*/x/3'", "abc\n");
    expect(result.stdout).toBe("abcx\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("skips an empty match right after a match, with g", async () => {
    const result = await run("'s/b*/x/2g'", "abc\n");
    expect(result.stdout).toBe("axcx\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("replaces every later empty match with g", async () => {
    const result = await run("'s/x*/-/2g'", "abc\n");
    expect(result.stdout).toBe("a-b-c-\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("replaces nothing when there is no Nth match", async () => {
    const result = await run("'s/b*/x/4'", "abc\n");
    expect(result.stdout).toBe("abc\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("sed s with a number and the p flag", () => {
  it("prints only the lines that have an Nth match", async () => {
    const result = await run("-n 's/a/b/3p'", LINES);
    expect(result.stdout).toBe("aab\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints nothing when no line has an Nth match", async () => {
    const result = await run("-n 's/a/b/4p'", LINES);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints only the lines that have an Nth match, with g", async () => {
    const result = await run("-n 's/a/b/2gp'", LINES);
    expect(result.stdout).toBe("abb\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("prints when the replacement is the same text", async () => {
    const result = await run("-n 's/a/a/2p'", LINES);
    expect(result.stdout).toBe("aaa\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("sed s with a number and the t and T commands", () => {
  it("t branches only when the Nth match is replaced", async () => {
    const result = await run("'s/a/b/2;tx;s/$/ -/;b;:x;s/$/ +/'", LINES);
    expect(result.stdout).toBe("x -\na -\naba +\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("T branches when there is no Nth match", async () => {
    const result = await run("'s/a/b/3;Tx;s/$/ +/;b;:x;s/$/ -/'", LINES);
    expect(result.stdout).toBe("x -\na -\naab +\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("t branches only when the Nth match is replaced, with g", async () => {
    const result = await run("'s/a/b/2g;tx;s/$/ -/;b;:x;s/$/ +/'", LINES);
    expect(result.stdout).toBe("x -\na -\nabb +\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("t branches when the replacement is the same text", async () => {
    const result = await run("'s/a/a/2;tx;s/$/ -/;b;:x;s/$/ +/'", LINES);
    expect(result.stdout).toBe("x -\na -\naaa +\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("t still sees a replacement by an earlier s command", async () => {
    const result = await run(
      "'s/a/b/;s/a/b/5;tx;s/$/ -/;b;:x;s/$/ +/'",
      "aaa\nz\n",
    );
    expect(result.stdout).toBe("baa +\nz -\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("T clears the flag, so a later T sees that there is no Nth match", async () => {
    const result = await run(
      "'s/a/b/;Tx;s/a/c/5;Ty;s/$/ -/;b;:x;s/$/ x/;b;:y;s/$/ y/'",
      "aaa\nz\n",
    );
    expect(result.stdout).toBe("baa y\nz x\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
