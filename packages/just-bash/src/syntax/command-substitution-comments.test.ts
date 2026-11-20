import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

// bash starts a comment only at the start of a word. Inside `$(...)`, a `#` in
// a word or in nested quotes is text. The expected stdout and exit code are
// what bash 5.2 gives for the same script.

describe("Command substitution with a `#` that is not a comment", () => {
  it("runs the rest of the script after a `#` in nested quotes", async () => {
    const env = new Bash();
    const result = await env.exec(
      ['x=$(echo "$(echo "#a")")', 'echo "after x=[$x]"', "exit 7"].join("\n"),
    );
    expect(result.stdout).toBe("after x=[#a]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(7);
  });

  it.each([
    ["a-#b", "a-#b"],
    ["$#", "0"],
    ["${v}#a", "1#a"],
    ["$(echo a)#b", "a#b"],
    ["$((1))#b", "1#b"],
    ["<(true)#b", "/dev/fd/63#b"],
    [`'q'#b "q"#b`, "q#b q#b"],
    ["\\ #a", " #a"],
    ["{#a", "{#a"],
    ["a\\\n#c", "a#c"],
  ])("keeps the `#` in echo %j", async (words, expected) => {
    const env = new Bash();
    const result = await env.exec(
      `v=1; x=$(echo ${words}); echo "[$x]"; echo after`,
    );
    expect(result.stdout).toBe(`[${expected}]\nafter\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps the `#` at the start of an assignment value", async () => {
    const env = new Bash();
    const result = await env.exec('x=$(a=#b; echo "$a"); echo "[$x]"');
    expect(result.stdout).toBe("[#b]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ['"$(echo "#a")" "#b"', "#a #b"],
    ['"x$(echo "#a")y"', "x#ay"],
    ['"$(echo "$(echo "#deep")")"', "#deep"],
    [`"$(echo '"#a"')"`, '"#a"'],
    ['"$(echo "\\"#a")"', '"#a'],
    ['"$(echo $#)"', "0"],
  ])("reads the nested quotes in echo %j", async (words, expected) => {
    const env = new Bash();
    const result = await env.exec(`x=$(echo ${words}); echo "[$x]"`);
    expect(result.stdout).toBe(`[${expected}]\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ['"$(echo ")")"', ")"],
    ['"$(echo "(")"', "("],
    ['"$(echo "$(echo ")")")"', ")"],
    ['"$(case x in x) echo ")";; esac)"', ")"],
  ])("finds the closing `)` after echo %j", async (words, expected) => {
    const env = new Bash();
    const result = await env.exec(`x=$(echo ${words}); echo "[$x]"`);
    expect(result.stdout).toBe(`[${expected}]\n`);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("restores the case state after a nested `$(...)` in double quotes", async () => {
    const env = new Bash();
    const result = await env.exec(
      'x=$(case x in "$(echo x)") echo "#m";; esac); echo "[$x]"',
    );
    expect(result.stdout).toBe("[#m]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("finds a heredoc after a `$((` subshell in double quotes", async () => {
    const env = new Bash();
    const result = await env.exec(
      ['x=$(echo "$((echo a) )"', "cat <<E", ")", "E", ")", 'echo "[$x]"'].join(
        "\n",
      ),
    );
    expect(result.stdout).toBe("[a\n)]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("finds a heredoc in double quotes inside `$((...))`", async () => {
    const env = new Bash();
    const result = await env.exec(
      [
        'x=$(( "$(cat <<E | wc -l',
        "it's",
        "E",
        ')" + 1 ))',
        'echo "[$x]"',
      ].join("\n"),
    );
    expect(result.stdout).toBe("[2]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    [
      "keeps an outer heredoc open across a newline in",
      ['x=$(cat <<E; echo "$(echo a', ')"', "it's", "E", ")"],
      "[it's\na]\n",
    ],
    [
      "reads an outer and an inner heredoc in",
      [
        'x=$(cat <<A; echo "$(cat <<B',
        "inner's",
        "B",
        ')"',
        "outer's",
        "A",
        ")",
      ],
      "[outer's\ninner's]\n",
    ],
  ])("%s a nested `$(...)` in double quotes", async (_name, lines, expected) => {
    const env = new Bash();
    const result = await env.exec([...lines, 'echo "[$x]"'].join("\n"));
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("fails when the input ends inside `$(`", async () => {
    const env = new Bash();
    const result = await env.exec("x=$(echo a # )\necho after");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: line 2: unexpected EOF while looking for matching `)'\n",
    );
    expect(result.exitCode).toBe(2);
  });
});

describe("Command substitution with a here-string", () => {
  it.each([
    [
      "in nested quotes",
      ["v=abc", "x=$(", '  y="$(cat <<<"$v")"', '  echo "$y"', ")"],
      "[abc]\n",
    ],
    [
      "in nested quotes before a newline",
      ['x=$(echo "$(cat <<<a)"', "echo b)"],
      "[a\nb]\n",
    ],
    [
      "at the start of a line",
      ["v=abc", "x=$(", '  cat <<<"$v"', ")"],
      "[abc]\n",
    ],
    [
      "after a command on the same line",
      ["x=$(echo z; cat <<<b", "echo c)"],
      "[z\nb\nc]\n",
    ],
    [
      "before a heredoc",
      ["x=$(", "  cat <<<a", "  cat <<E", "it's )", "E", ")"],
      "[a\nit's )]\n",
    ],
  ])("reads a here-string %s", async (_name, lines, expected) => {
    const env = new Bash();
    const result = await env.exec([...lines, 'echo "[$x]"'].join("\n"));
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("Command substitution comments", () => {
  it.each([
    ["after a command", "echo a # c", "a\n"],
    ["inside $(...)", 'x=$(echo a # c\n); echo "[$x]"', "[a]\n"],
    ["at the start of $(...)", 'x=$(#c\necho a); echo "[$x]"', "[a]\n"],
    ["after ;", 'x=$(echo a;#c\necho b); echo "[$x]"', "[a\nb]\n"],
    ["after |", 'x=$(echo a|#c\ncat); echo "[$x]"', "[a]\n"],
    ["after &&", 'x=$(true&&#c\necho b); echo "[$x]"', "[b]\n"],
    ["after a subshell", 'x=$( (echo a)#c\n); echo "[$x]"', "[a]\n"],
    [
      "after a case pattern",
      'x=$(case a in a)#c\n echo y;; esac); echo "[$x]"',
      "[y]\n",
    ],
    ["after a line continuation", 'x=$(echo a \\\n#c\n); echo "[$x]"', "[a]\n"],
    [
      "in a nested $(...) in double quotes",
      'x=$(echo "$(echo a #c\n)"); echo "[$x]"',
      "[a]\n",
    ],
  ])("starts a comment %s", async (_name, script, expected) => {
    const env = new Bash();
    const result = await env.exec(script);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    ["${#v}", 'v=hello; x=$(echo ${#v}); echo "[$x]"', "[5]\n"],
    ["a#b", 'echo a#b "$(echo a#b)"', "a#b a#b\n"],
    [
      "a heredoc body",
      'x=$(cat <<\'E\'\n#a "b\nE\n); echo "[$x]"',
      '[#a "b]\n',
    ],
  ])("does not start a comment in %s", async (_name, script, expected) => {
    const env = new Bash();
    const result = await env.exec(script);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
