import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { BashTransformPipeline } from "../pipeline.js";
import { TeePlugin, type TeePluginMetadata } from "./tee-plugin.js";

const FIXED_DATE = new Date("2024-01-15T10:30:45.123Z");

describe("TeePlugin exec", () => {
  it("does not wrap single commands (no existing pipe)", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("echo hello");
    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);

    const meta = result.metadata as unknown as TeePluginMetadata;
    // Single commands are not wrapped — only pipelines with | are
    expect(meta.teeFiles).toHaveLength(0);
  });

  it("captures stdout for each command in pipeline", async () => {
    const bash = new Bash({
      files: { "/data/input.txt": "hello\nworld\nhello world\n" },
    });
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("cat /data/input.txt | grep hello");
    expect(result.stdout).toBe("hello\nhello world\n");
    expect(result.exitCode).toBe(0);

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(2);
    expect(meta.teeFiles[0].commandName).toBe("cat");
    expect(meta.teeFiles[0].command).toBe("cat /data/input.txt");
    expect(meta.teeFiles[1].commandName).toBe("grep");
    expect(meta.teeFiles[1].command).toBe("grep hello");

    const catStdout = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(catStdout).toBe("hello\nworld\nhello world\n");

    const grepStdout = await bash.readFile(meta.teeFiles[1].stdoutFile);
    expect(grepStdout).toBe("hello\nhello world\n");
  });

  it("only captures targeted commands in pipeline", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({
        outputDir: "/tmp/logs",
        timestamp: FIXED_DATE,
        targetCommandPattern: /^echo$/,
      }),
    );
    const result = await bash.exec("echo hello | cat");
    expect(result.stdout).toBe("hello\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(1);
    expect(meta.teeFiles[0].commandName).toBe("echo");
    expect(meta.teeFiles[0].command).toBe("echo hello");

    const stdoutContent = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(stdoutContent).toBe("hello\n");
  });

  it("captures output from pipeline with multiple stages", async () => {
    const bash = new Bash({
      files: {
        "/data/words.txt": "banana\napple\ncherry\napricot\navocado\n",
      },
    });
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("cat /data/words.txt | grep ^a | sort");
    expect(result.stdout).toBe("apple\napricot\navocado\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(3);
    expect(meta.teeFiles[0].commandName).toBe("cat");
    expect(meta.teeFiles[1].commandName).toBe("grep");
    expect(meta.teeFiles[2].commandName).toBe("sort");

    const catOut = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(catOut).toBe("banana\napple\ncherry\napricot\navocado\n");

    const grepOut = await bash.readFile(meta.teeFiles[1].stdoutFile);
    expect(grepOut).toBe("apple\napricot\navocado\n");

    const sortOut = await bash.readFile(meta.teeFiles[2].stdoutFile);
    expect(sortOut).toBe("apple\napricot\navocado\n");
  });

  it("writes to nested output directory", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs/deep/dir", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("echo test | cat");
    expect(result.exitCode).toBe(0);

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles[0].commandName).toBe("echo");
    const content = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(content).toBe("test\n");
  });

  it("stdout passthrough matches plain exec for pipeline", async () => {
    const bash = new Bash({
      files: { "/data/nums.txt": "3\n1\n2\n" },
    });
    const bashWithTee = new Bash({
      files: { "/data/nums.txt": "3\n1\n2\n" },
    });
    bashWithTee.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );

    const script = "cat /data/nums.txt | sort | head -2";
    const plain = await bash.exec(script);
    const withTee = await bashWithTee.exec(script);

    expect(withTee.stdout).toBe(plain.stdout);
    expect(withTee.exitCode).toBe(plain.exitCode);
  });

  it("preserves pipeline exit code (grep failure)", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("echo hello | grep nomatch");
    expect(result.exitCode).toBe(1);

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(2);

    const echoOut = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(echoOut).toBe("hello\n");

    const grepOut = await bash.readFile(meta.teeFiles[1].stdoutFile);
    expect(grepOut).toBe("");
  });

  it("preserves stderr in pipeline", async () => {
    const bash = new Bash({
      files: { "/data/file.txt": "found it\n" },
    });
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("ls /data/file.txt /no_such_path | cat");

    expect(result.stdout).toContain("/data/file.txt");
    expect(result.stderr).toContain("No such file");
  });

  it("skips single commands in && and || chains", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec(
      "echo first && echo second; false || echo fallback",
    );
    expect(result.stdout).toBe("first\nsecond\nfallback\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(0);
  });

  it("skips compound commands (if/for/while/subshell/group)", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("if true; then echo y; fi");
    expect(result.stdout).toBe("y\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(0);
  });

  it("wraps pipelines inside && chains when pipe exists", async () => {
    const bash = new Bash({
      files: { "/data/f.txt": "hello\n" },
    });
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec(
      "cat /data/f.txt | grep hello && echo found",
    );
    expect(result.stdout).toBe("hello\nfound\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    // The pipeline cat|grep is wrapped, echo found is single (not wrapped)
    expect(meta.teeFiles).toHaveLength(2);
    expect(meta.teeFiles[0].commandName).toBe("cat");
    expect(meta.teeFiles[1].commandName).toBe("grep");
  });

  it("returns empty teeFiles when targetCommandPattern matches nothing", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({
        outputDir: "/tmp/logs",
        timestamp: FIXED_DATE,
        targetCommandPattern: /^nonexistent_command$/,
      }),
    );
    const result = await bash.exec("echo hello | cat");
    expect(result.stdout).toBe("hello\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(0);
  });

  it("targetCommandPattern matches multiple different commands", async () => {
    const bash = new Bash({
      files: { "/data/file.txt": "hello\n" },
    });
    bash.registerTransformPlugin(
      new TeePlugin({
        outputDir: "/tmp/logs",
        timestamp: FIXED_DATE,
        targetCommandPattern: /^(cat|sort)$/,
      }),
    );
    const result = await bash.exec("cat /data/file.txt | grep hello | sort");
    expect(result.stdout).toBe("hello\n");

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(2);
    expect(meta.teeFiles[0].commandName).toBe("cat");
    expect(meta.teeFiles[1].commandName).toBe("sort");
  });

  it("multiple exec calls produce unique file paths", async () => {
    const bash = new Bash();
    const plugin = new TeePlugin({
      outputDir: "/tmp/logs",
      timestamp: FIXED_DATE,
    });
    bash.registerTransformPlugin(plugin);

    const result1 = await bash.exec("echo first | cat");
    const meta1 = result1.metadata as unknown as TeePluginMetadata;
    expect(meta1.teeFiles.length).toBeGreaterThan(0);

    const result2 = await bash.exec("echo second | cat");
    const meta2 = result2.metadata as unknown as TeePluginMetadata;
    expect(meta2.teeFiles.length).toBeGreaterThan(0);

    // Persistent counter ensures unique file paths
    expect(meta1.teeFiles[0].stdoutFile).not.toBe(meta2.teeFiles[0].stdoutFile);
  });

  it("captures output when pipeline has mixed targeted and non-targeted commands", async () => {
    const bash = new Bash({
      files: { "/data/file.txt": "hello\nworld\n" },
    });
    bash.registerTransformPlugin(
      new TeePlugin({
        outputDir: "/tmp/logs",
        timestamp: FIXED_DATE,
        targetCommandPattern: /^cat$/,
      }),
    );
    const result = await bash.exec("cat /data/file.txt | wc -l");
    expect(result.exitCode).toBe(0);

    const meta = result.metadata as unknown as TeePluginMetadata;
    expect(meta.teeFiles).toHaveLength(1);
    expect(meta.teeFiles[0].commandName).toBe("cat");

    const catOut = await bash.readFile(meta.teeFiles[0].stdoutFile);
    expect(catOut).toBe("hello\nworld\n");
  });

  it("handles while loop compound command in pipeline (skipped)", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec(
      "echo -e 'a\\nb\\nc' | while read line; do echo \"got: $line\"; done",
    );
    expect(result.exitCode).toBe(0);

    const meta = result.metadata as unknown as TeePluginMetadata;
    // echo is a SimpleCommand (captured), while loop is compound (skipped)
    const echoEntries = meta.teeFiles.filter((f) => f.commandName === "echo");
    expect(echoEntries.length).toBe(1);
    expect(echoEntries[0].command).toBe("echo -e 'a\\nb\\nc'");
  });
});

describe("TeePlugin semantics preservation", () => {
  const FIXED_DATE = new Date("2024-01-15T10:30:45.123Z");

  async function assertSameSemantics(
    script: string,
    files?: Record<string, string>,
  ) {
    const plain = new Bash({ files });
    const withTee = new Bash({ files });
    withTee.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/tee-logs", timestamp: FIXED_DATE }),
    );

    const expected = await plain.exec(script);
    const actual = await withTee.exec(script);

    expect(actual.stdout, `stdout mismatch for: ${script}`).toBe(
      expected.stdout,
    );
    expect(actual.stderr, `stderr mismatch for: ${script}`).toBe(
      expected.stderr,
    );
    expect(actual.exitCode, `exitCode mismatch for: ${script}`).toBe(
      expected.exitCode,
    );
  }

  it("simple success: echo hello", async () => {
    await assertSameSemantics("echo hello");
  });

  it("simple failure: false", async () => {
    await assertSameSemantics("false");
  });

  it("pipeline success: cat file | grep match | sort", async () => {
    await assertSameSemantics("cat /data/input.txt | grep hello | sort", {
      "/data/input.txt": "hello\nworld\nhello world\n",
    });
  });

  it("pipeline failure (last cmd): echo hello | grep nomatch", async () => {
    await assertSameSemantics("echo hello | grep nomatch");
  });

  it("multiple statements: echo a; echo b; echo c", async () => {
    await assertSameSemantics("echo a; echo b; echo c");
  });

  it("logical AND: echo first && echo second", async () => {
    await assertSameSemantics("echo first && echo second");
  });

  it("logical OR: false || echo fallback", async () => {
    await assertSameSemantics("false || echo fallback");
  });

  it("AND with failure: false && echo unreachable", async () => {
    await assertSameSemantics("false && echo unreachable");
  });

  it("variable assignment then use: VAR=hello; echo $VAR", async () => {
    await assertSameSemantics("VAR=hello; echo $VAR");
  });

  it("compound commands: if true; then echo yes; fi", async () => {
    await assertSameSemantics("if true; then echo yes; fi");
  });

  it("for loop: for i in a b c; do echo $i; done", async () => {
    await assertSameSemantics("for i in a b c; do echo $i; done");
  });

  it("subshell: (echo sub)", async () => {
    await assertSameSemantics("(echo sub)");
  });

  it("group: { echo grp; }", async () => {
    await assertSameSemantics("{ echo grp; }");
  });

  it("mixed pipeline with compound: echo hello | while read x; do echo got $x; done", async () => {
    await assertSameSemantics(
      "echo hello | while read x; do echo got $x; done",
    );
  });

  it("exit code via $?: false; echo $?", async () => {
    await assertSameSemantics("false; echo $?");
  });

  it("multiline output: printf 'a\\nb\\nc\\n'", async () => {
    await assertSameSemantics("printf 'a\\nb\\nc\\n'");
  });

  it("no-output command: true", async () => {
    await assertSameSemantics("true");
  });

  it("stderr from non-last command in wrapped pipeline", async () => {
    await assertSameSemantics("ls /no_such_path_xyz | cat");
  });

  it("stderr preserved for unwrapped commands (|| chain)", async () => {
    await assertSameSemantics("ls /no_such_path_xyz 2>&1 || echo fallback");
  });

  it("stderr preserved for compound commands", async () => {
    await assertSameSemantics("if ls /no_such_path_xyz 2>&1; then echo y; fi");
  });

  it("stdout and stderr from wrapped pipeline command", async () => {
    await assertSameSemantics("ls /no_such_path_xyz /dev/null | cat");
  });

  // ── Complex scripts ──────────────────────────────────────────────────

  it("nested command substitution with pipeline", async () => {
    await assertSameSemantics("echo \"count: $(echo -e 'a\\nb\\nc' | wc -l)\"");
  });

  it("command substitution in variable, then use in pipeline", async () => {
    await assertSameSemantics('X=$(echo hello); echo "$X world" | cat', {});
  });

  it("chained exit codes with $? across multiple statements", async () => {
    await assertSameSemantics("true; A=$?; false; B=$?; echo $A $B");
  });

  it("for loop piping into command", async () => {
    await assertSameSemantics("for i in 3 1 2; do echo $i; done | sort");
  });

  it("while read loop consuming pipeline output", async () => {
    await assertSameSemantics(
      "echo -e 'a\\nb\\nc' | while read line; do echo \"[$line]\"; done",
    );
  });

  it("here-string fed into pipeline", async () => {
    await assertSameSemantics('cat <<< "hello world" | tr a-z A-Z');
  });

  it("arithmetic and conditionals mixed with commands", async () => {
    await assertSameSemantics(
      "x=5; y=3; echo $(( x + y )); (( x > y )) && echo bigger",
    );
  });

  it("function definition and call with pipe", async () => {
    await assertSameSemantics(
      'greet() { echo "hello $1"; }; greet world | cat',
    );
  });

  it("function with local variables and exit code", async () => {
    await assertSameSemantics(
      'check() { local v="$1"; [ "$v" = "yes" ]; }; check yes; echo $?; check no; echo $?',
    );
  });

  it("nested subshells with variable isolation", async () => {
    await assertSameSemantics("X=outer; (X=inner; echo $X); echo $X");
  });

  it("case statement with fallthrough patterns", async () => {
    await assertSameSemantics(
      'for f in foo.txt bar.sh baz.py; do case "$f" in *.txt) echo text;; *.sh) echo shell;; *) echo other;; esac; done',
    );
  });

  it("arrays: declare, append, iterate", async () => {
    await assertSameSemantics(
      'arr=(one two three); arr+=(four); for x in "${arr[@]}"; do echo $x; done',
    );
  });

  it("associative array lookup", async () => {
    await assertSameSemantics(
      "declare -A m; m[a]=1; m[b]=2; echo ${m[a]} ${m[b]}",
    );
  });

  it("parameter expansion operators", async () => {
    await assertSameSemantics(
      'X="hello world"; echo ${X^^}; echo ${X%% *}; echo ${X#* }; echo ${#X}',
    );
  });

  it("multi-line script: build and query", async () => {
    await assertSameSemantics(
      [
        "declare -A counts",
        "for w in the cat sat on the mat the cat; do",
        "  counts[$w]=$(( ${counts[$w]:-0} + 1 ))",
        "done",
        'for k in "${!counts[@]}"; do echo "$k: ${counts[$k]}"; done | sort',
      ].join("\n"),
    );
  });

  it("pipeline exit code propagation through $?", async () => {
    await assertSameSemantics(
      "echo hello | grep hello; A=$?; echo hello | grep nope; B=$?; echo $A $B",
    );
  });

  it("heredoc into pipeline", async () => {
    await assertSameSemantics(
      ["cat <<EOF | sort", "banana", "apple", "cherry", "EOF"].join("\n"),
    );
  });

  it("deeply nested command substitution", async () => {
    await assertSameSemantics("echo $(echo $(echo $(echo deep)))");
  });

  it("brace expansion with pipeline", async () => {
    await assertSameSemantics("echo {a,b,c}{1,2} | tr ' ' '\\n' | sort");
  });

  it("process substitution style: diff two pipelines via temp files", async () => {
    await assertSameSemantics(
      [
        "echo -e '1\\n2\\n3' > /tmp/a.txt",
        "echo -e '1\\n3\\n4' > /tmp/b.txt",
        "diff /tmp/a.txt /tmp/b.txt; echo exit:$?",
      ].join("\n"),
    );
  });

  it("complex redirect: stdout to file, stderr to stdout", async () => {
    await assertSameSemantics("ls /no_such_xyz 2>&1 | cat");
  });

  it("trap and exit code interaction", async () => {
    await assertSameSemantics('(trap "echo trapped" EXIT; echo before)');
  });

  it("multi-pipeline with mixed success/failure and $?", async () => {
    await assertSameSemantics("true; echo $?; false; echo $?; true; echo $?");
  });

  it("sequential commands: write file then read it", async () => {
    await assertSameSemantics(
      'echo "data" > /tmp/seq.txt; cat /tmp/seq.txt; rm /tmp/seq.txt; cat /tmp/seq.txt 2>&1; echo done',
    );
  });

  it("complex pipeline: generate, filter, transform, count", async () => {
    await assertSameSemantics(
      "printf '%s\\n' apple banana avocado blueberry apricot | grep ^a | sort | wc -l",
    );
  });

  it("variable in loop body used after loop", async () => {
    await assertSameSemantics(
      "total=0; for n in 1 2 3 4 5; do total=$(( total + n )); done; echo $total",
    );
  });

  it("nested if/else with commands", async () => {
    await assertSameSemantics(
      [
        "X=42",
        "if [ $X -gt 100 ]; then",
        "  echo big",
        "elif [ $X -gt 10 ]; then",
        "  echo medium",
        "else",
        "  echo small",
        "fi",
      ].join("\n"),
    );
  });

  it("command substitution with failing inner command", async () => {
    await assertSameSemantics(
      'result=$(grep nope /dev/null 2>&1); echo "got:$result:$?"',
    );
  });

  it("printf formatting with variables", async () => {
    await assertSameSemantics(
      'for i in 1 2 3; do printf "item %02d: %s\\n" $i "val$i"; done',
    );
  });

  it("read used in a non-piped context", async () => {
    await assertSameSemantics(
      'echo "one two three" | while read a b c; do echo "$c $b $a"; done',
    );
  });

  it("pipeline feeding while-read that accumulates state", async () => {
    await assertSameSemantics(
      [
        "sum=0",
        "echo -e '10\\n20\\n30' | while read n; do",
        '  echo "line: $n"',
        "done",
        "echo after",
      ].join("\n"),
    );
  });

  it("mixed && || ; chains with pipelines between", async () => {
    await assertSameSemantics(
      "echo start && echo hello | cat && echo end || echo fail",
    );
  });

  it("group command in pipeline", async () => {
    await assertSameSemantics("{ echo a; echo b; echo c; } | sort -r");
  });

  it("subshell exit code does not leak", async () => {
    await assertSameSemantics("(exit 42); echo $?");
  });

  it("string manipulation pipeline", async () => {
    await assertSameSemantics(
      'echo "Hello World FOO" | tr A-Z a-z | sed "s/foo/bar/" | cat',
    );
  });

  it("complex: build CSV, parse it, aggregate", async () => {
    await assertSameSemantics(
      [
        "printf 'name,score\\nalice,90\\nbob,85\\nalice,95\\nbob,70\\n' > /tmp/data.csv",
        "tail -n +2 /tmp/data.csv | sort -t, -k1,1 | cut -d, -f1 | uniq -c | sort -rn",
      ].join("\n"),
    );
  });

  it("exit code from last command in multi-statement script", async () => {
    await assertSameSemantics("echo a; echo b; echo c; false");
  });

  it("word splitting and globbing edge cases", async () => {
    await assertSameSemantics('X="a   b   c"; echo $X; echo "$X"');
  });

  it("empty pipeline commands", async () => {
    await assertSameSemantics("true | true | true; echo $?");
  });

  it("multiple here-docs in sequence", async () => {
    await assertSameSemantics(
      ["cat <<A", "first", "A", "cat <<B", "second", "B"].join("\n"),
    );
  });

  it("PIPESTATUS array preserved after pipeline", async () => {
    await assertSameSemantics('false | true | false; echo "${PIPESTATUS[@]}"');
  });

  it("PIPESTATUS array preserved for 2-command pipeline", async () => {
    await assertSameSemantics(
      'echo hello | grep nomatch; echo "${PIPESTATUS[@]}"',
    );
  });

  it("PIPESTATUS with mixed success/failure", async () => {
    await assertSameSemantics(
      'true | false | true; echo "${PIPESTATUS[0]} ${PIPESTATUS[1]} ${PIPESTATUS[2]}"',
    );
  });

  it("|& pipes stderr through to next command", async () => {
    await assertSameSemantics("ls /no_such_xyz |& cat");
  });

  it("|& with successful command", async () => {
    await assertSameSemantics("echo hello |& cat");
  });

  it("pipeline in || chain with PIPESTATUS check", async () => {
    await assertSameSemantics(
      'echo hello | grep nope || echo "fallback:${PIPESTATUS[@]}"',
    );
  });

  it("negated pipeline: ! false | true", async () => {
    await assertSameSemantics("! false | true; echo $?");
  });

  it("negated pipeline: ! true | false", async () => {
    await assertSameSemantics("! true | false; echo $?");
  });

  it("pipefail: rightmost failure exit code", async () => {
    await assertSameSemantics("set -o pipefail; false | true; echo $?");
  });

  it("pipefail with pipeline in && chain", async () => {
    await assertSameSemantics(
      "set -o pipefail; false | true && echo ok || echo fail",
    );
  });

  it("$? after wrapped pipeline", async () => {
    await assertSameSemantics("echo hello | grep nope; echo exit:$?");
  });
});

describe("TeePlugin error handling", () => {
  const FIXED_DATE = new Date("2024-01-15T10:30:45.123Z");

  it("preserves exit code and stderr for failing pipeline command", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("echo hello | cat /nonexistent_xyz");
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("No such file");
  });

  it("pipeline exit code preserved through PIPESTATUS", async () => {
    const bash = new Bash();
    bash.registerTransformPlugin(
      new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }),
    );
    const result = await bash.exec("echo hello | grep nomatch");
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });
});

describe("TeePlugin transform output", () => {
  const FIXED_DATE = new Date("2024-01-15T10:30:45.123Z");
  const TS = "2024-01-15T10-30-45.123Z";
  const D = `/tmp/logs/${TS}`;

  function transform(script: string) {
    return new BashTransformPipeline()
      .use(new TeePlugin({ outputDir: "/tmp/logs", timestamp: FIXED_DATE }))
      .transform(script);
  }

  it("single command: no wrapping (no existing pipe)", () => {
    const r = transform("echo hello");
    expect(r.script).toBe("echo hello");
    expect(r.metadata.teeFiles).toHaveLength(0);
  });

  it("pipeline: wraps each command, saves + restores PIPESTATUS", () => {
    const r = transform("echo hello | grep hello");
    expect(r.script).toBe(
      `echo hello | tee ${D}-000-echo.stdout.txt | grep hello | tee ${D}-001-grep.stdout.txt ; __tps0=\${PIPESTATUS[0]} __tps1=\${PIPESTATUS[2]} ; (exit $__tps0) | (exit $__tps1)`,
    );
  });

  it("single commands in && / || chains: no wrapping", () => {
    const r = transform("echo first && echo second || echo third");
    expect(r.script).toBe("echo first && echo second || echo third");
    expect(r.metadata.teeFiles).toHaveLength(0);
  });

  it("pipeline in && chain: wraps the pipeline, skips the single command", () => {
    const r = transform("echo hello | grep hello && echo found");
    expect(r.script).toBe(
      `echo hello | tee ${D}-000-echo.stdout.txt | grep hello | tee ${D}-001-grep.stdout.txt ; __tps0=\${PIPESTATUS[0]} __tps1=\${PIPESTATUS[2]} ; (exit $__tps0) | (exit $__tps1) && echo found`,
    );
    expect(r.metadata.teeFiles).toHaveLength(2);
  });

  it("assignment-only and single commands: no wrapping", () => {
    const r = transform("VAR=hello; echo $VAR");
    // Both are single-command pipelines — no wrapping
    expect(r.script).toBe("VAR=hello\necho $VAR");
    expect(r.metadata.teeFiles).toHaveLength(0);
  });

  it("compound commands not wrapped", () => {
    const r = transform("if true; then echo yes; fi");
    expect(r.script).toBe("if true; then\necho yes\nfi");
    expect(r.metadata.teeFiles).toHaveLength(0);
  });

  it("persistent counter across pipelines", () => {
    const r = transform("echo a | cat; echo b | cat");
    expect(r.script).toContain("000-echo");
    expect(r.script).toContain("001-cat");
    expect(r.script).toContain("002-echo");
    expect(r.script).toContain("003-cat");
  });

  it("still saves/restores PIPESTATUS even when only some commands wrapped", () => {
    const r = new BashTransformPipeline()
      .use(
        new TeePlugin({
          outputDir: "/tmp/logs",
          timestamp: FIXED_DATE,
          targetCommandPattern: /^echo$/,
        }),
      )
      .transform("echo hello | cat");
    // echo is wrapped (tee inserted), cat is not. PIPESTATUS still needs
    // restoring because tee inflated it from 2 to 3 entries.
    expect(r.script).toBe(
      `echo hello | tee ${D}-000-echo.stdout.txt | cat ; __tps0=\${PIPESTATUS[0]} __tps1=\${PIPESTATUS[2]} ; (exit $__tps0) | (exit $__tps1)`,
    );
  });
});
