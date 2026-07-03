import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("while loop stdin with pipeline in body", () => {
  it("simple pipeline in body reads all lines", async () => {
    const bash = new Bash({ files: { "/f": "a\nb\nc\n" } });
    const result = await bash.exec(
      'while IFS= read -r line; do echo "$line" | cat; done < /f',
    );
    expect(result.stdout).toBe("a\nb\nc\n");
    expect(result.exitCode).toBe(0);
  });

  it("multi-stage pipeline in body reads all lines", async () => {
    const bash = new Bash({ files: { "/f": "a\nb\nc\n" } });
    const result = await bash.exec(
      'while IFS= read -r line; do echo "$line" | tr a-z A-Z | cat; done < /f',
    );
    expect(result.stdout).toBe("A\nB\nC\n");
    expect(result.exitCode).toBe(0);
  });

  it("pipeline body does not consume loop stdin", async () => {
    const bash = new Bash({ files: { "/f": "x\ny\nz\n" } });
    const result = await bash.exec(
      "while IFS= read -r line; do echo extra | cat; done < /f",
    );
    expect(result.stdout).toBe("extra\nextra\nextra\n");
    expect(result.exitCode).toBe(0);
  });

  it("without IFS= also works with pipeline in body", async () => {
    const bash = new Bash({ files: { "/f": "a\nb\nc\n" } });
    const result = await bash.exec(
      'while read -r line; do echo "$line" | cat; done < /f',
    );
    expect(result.stdout).toBe("a\nb\nc\n");
    expect(result.exitCode).toBe(0);
  });

  it("nested loops each with a pipeline", async () => {
    const bash = new Bash({
      files: { "/outer": "A\nB\n", "/inner": "1\n2\n" },
    });
    const result = await bash.exec(`
      while IFS= read -r o; do
        while IFS= read -r i; do
          echo "$o:$i" | cat
        done < /inner
      done < /outer
    `);
    expect(result.stdout).toBe("A:1\nA:2\nB:1\nB:2\n");
    expect(result.exitCode).toBe(0);
  });

  it("group command reading extra line advances position", async () => {
    const bash = new Bash({ files: { "/f": "A\nB\nC\nD\n" } });
    const result = await bash.exec(`
      while IFS= read -r line; do
        { IFS= read -r extra; echo "$line+$extra"; } | cat
      done < /f
    `);
    expect(result.stdout).toBe("A+B\nC+D\n");
    expect(result.exitCode).toBe(0);
  });

  it("group with heredoc does not consume loop stdin", async () => {
    const bash = new Bash({ files: { "/f": "1\n2\n" } });
    const result = await bash.exec(`
      while IFS= read -r line; do
        { IFS= read -r x; echo "$line:$x"; } <<'EOF'
hello
EOF
      done < /f
    `);
    expect(result.stdout).toBe("1:hello\n2:hello\n");
    expect(result.exitCode).toBe(0);
  });

  it("works with stdin passed to exec()", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'while IFS= read -r line; do echo "$line" | tr a-z A-Z; done',
      { stdin: "hello\nworld\n" },
    );
    expect(result.stdout).toBe("HELLO\nWORLD\n");
    expect(result.exitCode).toBe(0);
  });

  it("cat with no args reads from loop stdin and advances the stream", async () => {
    // read consumes "first", cat drains the rest via the shared stdin stream
    const bash = new Bash({ files: { "/f": "first\nsecond\nthird\n" } });
    const result = await bash.exec(`
      while IFS= read -r line; do
        echo "read:$line"
        cat
      done < /f
    `);
    expect(result.stdout).toBe("read:first\nsecond\nthird\n");
    expect(result.exitCode).toBe(0);
  });

  it("grep with no args reads remaining loop stdin", async () => {
    // read gets "apple", grep filters remaining lines; cursor exhausted after grep
    const bash = new Bash({ files: { "/f": "apple\nbanana\napricot\n" } });
    const result = await bash.exec(`
      while IFS= read -r line; do
        grep "^b"
      done < /f
    `);
    expect(result.stdout).toBe("banana\n");
    expect(result.exitCode).toBe(0);
  });

  it("if condition reads from stdin redirect", async () => {
    const bash = new Bash({ files: { "/f": "hello\n" } });
    const result = await bash.exec(
      'if IFS= read -r line; then echo "got: $line"; fi < /f',
    );
    expect(result.stdout).toBe("got: hello\n");
    expect(result.exitCode).toBe(0);
  });

  it("if body reads from stdin redirect", async () => {
    const bash = new Bash({ files: { "/f": "line1\nline2\n" } });
    const result = await bash.exec(`
      if true; then
        IFS= read -r a
        IFS= read -r b
        echo "$a $b"
      fi < /f
    `);
    expect(result.stdout).toBe("line1 line2\n");
    expect(result.exitCode).toBe(0);
  });

  it("c-style for loop body reads from stdin redirect", async () => {
    const bash = new Bash({ files: { "/f": "x\ny\nz\n" } });
    const result = await bash.exec(`
      for ((i=0; i<3; i++)); do
        IFS= read -r line
        echo "$i: $line"
      done < /f
    `);
    expect(result.stdout).toBe("0: x\n1: y\n2: z\n");
    expect(result.exitCode).toBe(0);
  });

  it("case body reads from stdin redirect", async () => {
    const bash = new Bash({ files: { "/f": "hello\nworld\n" } });
    const result = await bash.exec(`
      case 1 in
        1) IFS= read -r a; IFS= read -r b; echo "$a $b";;
      esac < /f
    `);
    expect(result.stdout).toBe("hello world\n");
    expect(result.exitCode).toBe(0);
  });

  it("for loop with stdin redirect lets body read from file", async () => {
    const bash = new Bash({ files: { "/f": "line1\nline2\nline3\n" } });
    const result = await bash.exec(`
      for i in 1 2 3; do
        IFS= read -r line
        echo "$i: $line"
      done < /f
    `);
    expect(result.stdout).toBe("1: line1\n2: line2\n3: line3\n");
    expect(result.exitCode).toBe(0);
  });

  it("for loop body pipeline reads from stdin redirect", async () => {
    const bash = new Bash({ files: { "/f": "a\nb\nc\n" } });
    const result = await bash.exec(`
      for i in 1 2 3; do
        IFS= read -r line
        echo "$line" | tr a-z A-Z
      done < /f
    `);
    expect(result.stdout).toBe("A\nB\nC\n");
    expect(result.exitCode).toBe(0);
  });

  it("until loop with pipeline in body reads all lines", async () => {
    const bash = new Bash({ files: { "/f": "a\nb\nc\n" } });
    const result = await bash.exec(
      'until ! IFS= read -r line; do echo "$line" | cat; done < /f',
    );
    expect(result.stdout).toBe("a\nb\nc\n");
    expect(result.exitCode).toBe(0);
  });

  it("if body reads from heredoc", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      if true; then
        IFS= read -r a
        IFS= read -r b
        echo "$a $b"
      fi <<'EOF'
hello
world
EOF
    `);
    expect(result.stdout).toBe("hello world\n");
    expect(result.exitCode).toBe(0);
  });

  it("if body reads from herestring", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'if true; then IFS= read -r line; echo "got: $line"; fi <<< "herestring"',
    );
    expect(result.stdout).toBe("got: herestring\n");
    expect(result.exitCode).toBe(0);
  });

  it("for loop body reads from heredoc", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      for i in 1 2 3; do
        IFS= read -r line
        echo "$i: $line"
      done <<'EOF'
alpha
beta
gamma
EOF
    `);
    expect(result.stdout).toBe("1: alpha\n2: beta\n3: gamma\n");
    expect(result.exitCode).toBe(0);
  });

  it("for loop body reads from herestring", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'for i in 1; do IFS= read -r line; echo "$i: $line"; done <<< "word"',
    );
    expect(result.stdout).toBe("1: word\n");
    expect(result.exitCode).toBe(0);
  });

  it("c-style for loop body reads from heredoc", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      for ((i=0; i<2; i++)); do
        IFS= read -r line
        echo "$i: $line"
      done <<'EOF'
foo
bar
EOF
    `);
    expect(result.stdout).toBe("0: foo\n1: bar\n");
    expect(result.exitCode).toBe(0);
  });

  it("c-style for loop body reads from herestring", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'for ((i=0; i<1; i++)); do IFS= read -r line; echo "$line"; done <<< "hi"',
    );
    expect(result.stdout).toBe("hi\n");
    expect(result.exitCode).toBe(0);
  });

  it("until loop body reads from heredoc", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      until ! IFS= read -r line; do
        echo "got: $line"
      done <<'EOF'
one
two
EOF
    `);
    expect(result.stdout).toBe("got: one\ngot: two\n");
    expect(result.exitCode).toBe(0);
  });

  it("until loop body reads from herestring", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'until ! IFS= read -r line; do echo "$line"; done <<< "only"',
    );
    expect(result.stdout).toBe("only\n");
    expect(result.exitCode).toBe(0);
  });

  it("case body reads from heredoc", async () => {
    const bash = new Bash();
    const result = await bash.exec(`
      case 1 in
        1) IFS= read -r a; IFS= read -r b; echo "$a $b";;
      esac <<'EOF'
first
second
EOF
    `);
    expect(result.stdout).toBe("first second\n");
    expect(result.exitCode).toBe(0);
  });

  it("case body reads from herestring", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'case 1 in 1) IFS= read -r line; echo "$line";; esac <<< "only"',
    );
    expect(result.stdout).toBe("only\n");
    expect(result.exitCode).toBe(0);
  });

  it("cat as first pipeline stage reads loop stdin", async () => {
    // cat (first in pipeline, no file args) consumes remaining cursor content
    const bash = new Bash({ files: { "/f": "line1\nline2\n" } });
    const result = await bash.exec(`
      while IFS= read -r line; do
        cat | tr a-z A-Z
      done < /f
    `);
    // read gets "line1", cat drains "line2\n" and pipes it through tr
    expect(result.stdout).toBe("LINE2\n");
    expect(result.exitCode).toBe(0);
  });
});

describe("stdin redirect edge cases", () => {
  // <<- strip-tabs path
  it("while loop body reads from strip-tabs heredoc (<<-)", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'while IFS= read -r line; do echo "got: $line"; done <<-EOF\n\thello\n\tworld\nEOF\n',
    );
    expect(result.stdout).toBe("got: hello\ngot: world\n");
    expect(result.exitCode).toBe(0);
  });

  it("if body reads from strip-tabs heredoc (<<-)", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'if true; then IFS= read -r a; echo "$a"; fi <<-EOF\n\tstripped\nEOF\n',
    );
    expect(result.stdout).toBe("stripped\n");
    expect(result.exitCode).toBe(0);
  });

  it("for loop body reads from strip-tabs heredoc (<<-)", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'for i in 1; do IFS= read -r line; echo "$i: $line"; done <<-EOF\n\ttabbed\nEOF\n',
    );
    expect(result.stdout).toBe("1: tabbed\n");
    expect(result.exitCode).toBe(0);
  });

  it("c-style for loop body reads from strip-tabs heredoc (<<-)", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'for ((i=0; i<1; i++)); do IFS= read -r line; echo "$line"; done <<-EOF\n\ttabbed\nEOF\n',
    );
    expect(result.stdout).toBe("tabbed\n");
    expect(result.exitCode).toBe(0);
  });

  it("until loop body reads from strip-tabs heredoc (<<-)", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'until ! IFS= read -r line; do echo "$line"; done <<-EOF\n\ttabbed\nEOF\n',
    );
    expect(result.stdout).toBe("tabbed\n");
    expect(result.exitCode).toBe(0);
  });

  it("case body reads from strip-tabs heredoc (<<-)", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'case 1 in 1) IFS= read -r line; echo "$line";; esac <<-EOF\n\ttabbed\nEOF\n',
    );
    expect(result.stdout).toBe("tabbed\n");
    expect(result.exitCode).toBe(0);
  });

  // file-not-found error path for < redirect
  it("while loop errors when stdin file does not exist", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'while IFS= read -r line; do echo "$line"; done < /nope',
    );
    expect(result.stderr).toContain("No such file or directory");
    expect(result.exitCode).not.toBe(0);
  });

  it("if errors when stdin file does not exist", async () => {
    const bash = new Bash();
    const result = await bash.exec("if true; then echo hi; fi < /nope");
    expect(result.stderr).toContain("No such file or directory");
    expect(result.exitCode).not.toBe(0);
  });

  it("for loop errors when stdin file does not exist", async () => {
    const bash = new Bash();
    const result = await bash.exec('for i in 1; do echo "$i"; done < /nope');
    expect(result.stderr).toContain("No such file or directory");
    expect(result.exitCode).not.toBe(0);
  });

  it("c-style for loop errors when stdin file does not exist", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'for ((i=0; i<1; i++)); do echo "$i"; done < /nope',
    );
    expect(result.stderr).toContain("No such file or directory");
    expect(result.exitCode).not.toBe(0);
  });

  it("until loop errors when stdin file does not exist", async () => {
    const bash = new Bash();
    const result = await bash.exec("until false; do echo hi; done < /nope");
    expect(result.stderr).toContain("No such file or directory");
    expect(result.exitCode).not.toBe(0);
  });

  it("case errors when stdin file does not exist", async () => {
    const bash = new Bash();
    const result = await bash.exec("case 1 in 1) echo hi;; esac < /nope");
    expect(result.stderr).toContain("No such file or directory");
    expect(result.exitCode).not.toBe(0);
  });
});
