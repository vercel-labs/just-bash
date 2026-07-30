import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

/**
 * `grep -f FILE` / `--file=FILE` — patterns read from a file, one per line.
 * Expectations verified against GNU grep 3.12.
 */
describe("grep -f (patterns from file)", () => {
  const files = {
    "/pat.txt": "apple\nbanana\n",
    "/hay.txt": "apple pie\ncherry\nbanana split\n",
  };

  it("reads newline-separated patterns from a file", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -f /pat.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("matches the exact repro from issue #322", async () => {
    const env = new Bash();
    const result = await env.exec(
      [
        "printf 'apple\\nbanana\\n' > /tmp/pat.txt",
        "printf 'apple pie\\ncherry\\nbanana split\\n' > /tmp/hay.txt",
        "grep -f /tmp/pat.txt /tmp/hay.txt",
      ].join("; "),
    );
    expect(result.stdout).toBe("apple pie\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("accepts --file=FILE", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep --file=/pat.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("accepts --file FILE as two arguments", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep --file /pat.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("accepts the value attached to the flag (-fFILE)", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -f/pat.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("accepts -f bundled with other short flags", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -nf /pat.txt /hay.txt");
    expect(result.stdout).toBe("1:apple pie\n3:banana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("unions -f patterns with -e patterns", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -f /pat.txt -e cherry /hay.txt");
    expect(result.stdout).toBe("apple pie\ncherry\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("unions -f patterns with -e patterns regardless of order", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -e cherry -f /pat.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\ncherry\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("unions patterns across repeated -f flags", async () => {
    const env = new Bash({
      files: {
        ...files,
        "/p1.txt": "apple\n",
        "/p2.txt": "banana\n",
      },
    });
    const result = await env.exec("grep -f /p1.txt -f /p2.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats a missing trailing newline as a pattern terminator", async () => {
    const env = new Bash({
      files: { ...files, "/notrail.txt": "apple\nbanana" },
    });
    const result = await env.exec("grep -f /notrail.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reads patterns from stdin with -f -", async () => {
    const env = new Bash({ files });
    const result = await env.exec("printf 'app\\nban\\n' | grep -f - /hay.txt");
    expect(result.stdout).toBe("apple pie\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("lets only the first of repeated -f - read stdin", async () => {
    const env = new Bash({ files });
    const result = await env.exec(
      "printf 'apple\\n' | grep -f - -f - /hay.txt",
    );
    expect(result.stdout).toBe("apple pie\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps repeated -f - to a single pattern under -P", async () => {
    const env = new Bash({ files });
    const result = await env.exec(
      "printf 'apple\\n' | grep -P -f - -f - /hay.txt",
    );
    expect(result.stdout).toBe("apple pie\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("leaves no stdin to search when -f - consumed it", async () => {
    const env = new Bash();
    const result = await env.exec("printf 'apple\\n' | grep -f -");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });
});

describe("grep -f empty patterns", () => {
  const files = {
    "/hay.txt": "apple pie\ncherry\nbanana split\n",
    "/empty.txt": "",
    "/blank.txt": "\n",
    "/mixed.txt": "foo\n\nbar\n",
  };

  it("matches every line when the pattern file is a single blank line", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -f /blank.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\ncherry\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("matches every line when a blank line is mixed with real patterns", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -f /mixed.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\ncherry\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("anchors the empty pattern with -x so only blank lines match", async () => {
    const env = new Bash({
      files: { ...files, "/withblank.txt": "a\n\nb\n" },
    });
    const result = await env.exec("grep -F -x -f /blank.txt /withblank.txt");
    expect(result.stdout).toBe("\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("matches nothing when the pattern file is empty", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -f /empty.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("matches nothing for grep -f /dev/null", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -f /dev/null /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("suppresses the -c count entirely for an empty pattern file", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -c -f /empty.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("does not even open input files for an empty pattern file", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -f /empty.txt /nonexistent.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(1);
  });

  it("selects every line with -v and an empty pattern file", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -v -f /empty.txt /hay.txt");
    expect(result.stdout).toBe("apple pie\ncherry\nbanana split\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("counts every line with -c -v and an empty pattern file", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -c -v -f /empty.txt /hay.txt");
    expect(result.stdout).toBe("3\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("still finds a match when an empty pattern file is combined with -e", async () => {
    const env = new Bash({ files });
    const result = await env.exec("grep -f /empty.txt -e apple /hay.txt");
    expect(result.stdout).toBe("apple pie\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("grep -f errors", () => {
  it("reports a missing pattern file and exits 2", async () => {
    const env = new Bash({ files: { "/hay.txt": "apple pie\n" } });
    const result = await env.exec("grep -f /missing.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "grep: /missing.txt: No such file or directory\n",
    );
    expect(result.exitCode).toBe(2);
  });

  it("reports the failing file when only one of several -f is missing", async () => {
    const env = new Bash({
      files: { "/hay.txt": "apple pie\n", "/pat.txt": "apple\n" },
    });
    const result = await env.exec("grep -f /pat.txt -f /nope.txt /hay.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: /nope.txt: No such file or directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("reports a directory pattern file and exits 2", async () => {
    const env = new Bash({ files: { "/dir/keep.txt": "x\n" } });
    const result = await env.exec("grep -f /dir /dir/keep.txt");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: /dir: Is a directory\n");
    expect(result.exitCode).toBe(2);
  });

  it("reports a missing -f argument and exits 2", async () => {
    const env = new Bash({ files: { "/hay.txt": "apple pie\n" } });
    const result = await env.exec("grep -f");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("grep: option requires an argument -- 'f'\n");
    expect(result.exitCode).toBe(2);
  });
});
