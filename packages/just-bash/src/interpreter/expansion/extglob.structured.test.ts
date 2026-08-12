import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import {
  cleanupTestDir,
  createTestDir,
  runRealBash,
  setupFiles,
} from "../../comparison-tests/fixture-runner.js";

const quoteForShell = (value: string): string =>
  `'${value.replaceAll("'", "'\\''")}'`;

describe("structured extglob expansion", () => {
  const compareWithBash = async (
    files: Record<string, string>,
    script: string,
    options: string[] = [],
    expectedJustBashStderr?: string,
  ): Promise<void> => {
    const testDirectory = await createTestDir();
    try {
      const bash = await setupFiles(testDirectory, files);
      const expected = await runRealBash(
        `bash -O extglob${options.map((option) => ` -O ${option}`).join("")} -c ${quoteForShell(script)}`,
        testDirectory,
      );
      const actual = await bash.exec(
        `shopt -s extglob${options.length > 0 ? ` ${options.join(" ")}` : ""}\n${script}`,
        { rawScript: true },
      );

      expect({ stdout: actual.stdout, exitCode: actual.exitCode }).toEqual({
        stdout: expected.stdout,
        exitCode: expected.exitCode,
      });
      expect(actual.stderr).toBe(expectedJustBashStderr ?? expected.stderr);
    } finally {
      await cleanupTestDir(testDirectory);
    }
  };

  it("matches @(), ?(), *(), and +() like Bash", async () => {
    await compareWithBash(
      {
        x: "",
        xbar: "",
        xbaz: "",
        xfoo: "",
        xfoofoo: "",
      },
      "printf '@\\n'; printf '<%s>\\n' x@(foo|bar); printf '?\\n'; printf '<%s>\\n' x?(foo|bar); printf '*\\n'; printf '<%s>\\n' x*(foo|bar); printf '+\\n'; printf '<%s>\\n' x+(foo|bar)",
    );
  });

  it("keeps the existing !() no-match fallback", async () => {
    await compareWithBash({}, "printf '<%s>\\n' x!(foo|bar)");
  });

  it("matches nested, quoted, and escaped alternatives", async () => {
    await compareWithBash(
      {
        xbar: "",
        xbaz: "",
        xescaped: "",
        "xescaped|pipe": "",
        xfoo: "",
        "xquoted)close": "",
        "xquoted|pipe": "",
      },
      "printf '<%s>\\n' x@(foo|@(bar|baz)|'quoted|pipe'|escaped\\|pipe|\"quoted)close\")",
    );
  });

  it("executes dollar and backtick substitutions inside alternatives", async () => {
    await compareWithBash(
      { "x)": "", xfoo: "" },
      "printf '<%s>\\n' x@($(printf ')')|foo); printf '<%s>\\n' x@(`printf ')'`|foo)",
    );
  });

  it("expands no-match alternatives before preserving the default pattern", async () => {
    await compareWithBash({}, "printf '<%s>\\n' x@($(printf missing)|foo)");
  });

  it("runs substitutions while set -f disables pathname expansion", async () => {
    await compareWithBash(
      { xmissing: "" },
      "set -f; printf '<%s>\\n' x@($(printf missing)|foo)",
    );
  });

  it("expands selected parameter operation words inside alternatives", async () => {
    await compareWithBash(
      {},
      "unset value; set -f; printf '<%s>\\n' @(${value:-a\"b\"c}|z); value=set; printf '<%s>\\n' @(${value:+a\"b\"c}|z)",
    );
  });

  it("preserves expansion-produced backslashes in redirects", async () => {
    await compareWithBash(
      {},
      "set -f; value='\\\\*'; printf hi > @($value); test -f '@(\\*)'",
    );
  });

  it("keeps quoted alternatives literal before pathname expansion", async () => {
    await compareWithBash(
      { xfoo: "", xstar: "" },
      "value=foo; printf '<%s>\\n' x@('*'|$value)",
    );
  });

  it("keeps quoted alternatives unescaped in ordinary values", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "shopt -s extglob; value=@('*'); printf '%s\\n' \"$value\"",
    );

    expect(result).toMatchObject({
      stdout: "@(*)\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("expands outer braces when an alternative is quoted", async () => {
    await compareWithBash({ ax: "", by: "" }, "printf '<%s>\\n' {a,b}@('x'|y)");
  });

  it("splits unquoted values before expanding the extglob", async () => {
    await compareWithBash(
      { "bar.cc": "", "bar.h": "" },
      "value='a b'; printf '<%s>\\n' $value*.@(cc|h)",
    );
  });

  it("rejects split structured redirects before honoring set -f", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "value='a b'; set -f; printf hi > @($value)",
    );

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: @($value): ambiguous redirect\n",
      exitCode: 1,
    });
  });

  it("preserves substitution stderr once before failglob", async () => {
    // Bash adds a version-dependent source-line prefix to this diagnostic.
    await compareWithBash(
      {},
      "printf '<%s>\\n' x@($(printf 'expanded\\n' >&2; printf missing))",
      ["failglob"],
      "expanded\nbash: no match: x@(missing)\n",
    );
  });

  it("forwards substitution stderr from case patterns", async () => {
    await compareWithBash(
      {},
      "case foo in @($(printf 'err\\n' >&2; printf foo)|bar) ) printf matched;; esac",
    );
  });

  it("keeps quoted extglob alternatives intact during word splitting", async () => {
    await compareWithBash(
      {},
      "v='a b'; set -f; printf '<%s>\\n' @($v|\"d e\")",
    );
  });

  it("evaluates structured extglob alternatives once while globbing is disabled", async () => {
    await compareWithBash({}, 'i=0; set -f; : @($((i++))); echo "$i"');
  });

  it("evaluates structured extglob substitutions once with an empty IFS", async () => {
    await compareWithBash(
      {},
      "rm -f marker; IFS=; : @($(echo x >> marker; printf x)); cat marker",
    );
  });

  it("executes substitutions once while expanding redirect targets", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      shopt -s extglob
      rm -f marker
      : > @($(printf x >> marker; printf target))
      cat marker
      rm -f marker
      : > $(printf x >> marker; printf target)*
      cat marker
    `);

    expect(result).toMatchObject({
      stdout: "xx",
      stderr: "",
      exitCode: 0,
    });
  });

  it("retains the complete redirect source in ambiguous redirect errors", async () => {
    const bash = new Bash();
    const result = await bash.exec("value='a b'; set -f; printf hi > $value*");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "bash: $value*: ambiguous redirect\n",
      exitCode: 1,
    });
  });
});
