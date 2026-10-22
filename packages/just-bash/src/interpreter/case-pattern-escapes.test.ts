import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { ExecutionLimitError } from "./errors.js";

async function run(script: string) {
  return new Bash().exec(script);
}

describe("case patterns keep escaped and quoted characters literal", () => {
  it.each([
    // [subject, pattern, matches]
    ["-x", String.raw`-\?`, false],
    ["-?", String.raw`-\?`, true],
    ["ab", String.raw`a\*`, false],
    ["a*", String.raw`a\*`, true],
    ["ab", String.raw`a\[b`, false],
    ["a[b", String.raw`a\[b`, true],
    ["a|b", String.raw`a\|b`, true],
    ["abc", `a"*"`, false],
    ["a*", `a"*"`, true],
    ["abc", "a'*'", false],
    ["abc", `a*"c"`, true],
    ["abc", `a"b"*`, true],
  ])("case %s in %s matches: %s", async (subject, pattern, matches) => {
    const result = await run(
      `case '${subject}' in ${pattern}) echo match;; *) echo no;; esac`,
    );
    expect(result).toMatchObject({
      stdout: matches ? "match\n" : "no\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("still lets an unquoted expansion act as a glob", async () => {
    const result = await run(
      "x='*'; case abc in a$x) echo match;; *) echo no;; esac",
    );
    expect(result.stdout).toBe("match\n");
  });

  it("matches a quoted expansion literally", async () => {
    const result = await run(
      `x='*'; case abc in a"$x") echo match;; *) echo no;; esac; case 'a*' in a"$x") echo match;; *) echo no;; esac`,
    );
    expect(result.stdout).toBe("no\nmatch\n");
  });

  it("matches an escaped backslash as a backslash", async () => {
    const result = await run(
      String.raw`case 'a\b' in a\\b) echo match;; *) echo no;; esac; case ab in a\\b) echo match;; *) echo no;; esac`,
    );
    expect(result.stdout).toBe("match\nno\n");
  });

  it("matches an escaped backslash as a backslash in [[ ]]", async () => {
    const result = await run(
      String.raw`[[ 'a\b' == a\\b ]] && echo match || echo no; [[ ab == a\\b ]] && echo match || echo no`,
    );
    expect(result.stdout).toBe("match\nno\n");
  });

  it("reproduces the libtool option parser from the issue", async () => {
    const result = await run(
      String.raw`for a in -x --mode; do case $a in -\?|-h) echo "$a usage";; -\?*) echo "$a short";; *) echo "$a other";; esac; done; case ab in a\*) echo bad;; *) echo ok;; esac`,
    );
    expect(result).toMatchObject({
      stdout: "-x other\n--mode other\nok\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("bounds a pattern built from several expansions by maxStringLength", async () => {
    // each expansion fits in the limit, but the pattern made of three of them does not
    const bash = new Bash({ executionLimits: { maxStringLength: 40 } });
    const result = await bash.exec(
      "a=xxxxxxxxxxxxxxxxxxxx; case x in $a$a$a) echo match;; *) echo no;; esac",
    );

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("word expansion");
  });

  it("bounds the right-hand side of [[ == ]] by maxStringLength", async () => {
    const bash = new Bash({ executionLimits: { maxStringLength: 40 } });
    const result = await bash.exec(
      "a=xxxxxxxxxxxxxxxxxxxx; [[ x == $a$a$a ]] && echo match || echo no",
    );

    // the conditional reports the error and counts as false, so the || branch runs
    expect(result.stdout).toBe("no\n");
    expect(result.stderr).toContain("string length limit exceeded (40 bytes)");
  });

  it("keeps ordinary glob patterns working", async () => {
    const result = await run(
      "case hello in h*o) echo a;; esac; case hello in h?llo) echo b;; esac; case hello in [a-h]ello) echo c;; esac; case hello in x|hel*) echo d;; esac",
    );
    expect(result.stdout).toBe("a\nb\nc\nd\n");
  });
});
