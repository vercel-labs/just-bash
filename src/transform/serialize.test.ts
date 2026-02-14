import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { parse } from "../parser/parser.js";
import { serialize } from "./serialize.js";

/**
 * Round-trip test helper: parse → serialize → parse, verify AST equality.
 * Strips line numbers and sourceText since the serializer doesn't preserve them.
 */
function roundTrip(input: string): void {
  const ast1 = parse(input);
  const serialized = serialize(ast1);
  const ast2 = parse(serialized);
  expect(stripMeta(ast2)).toEqual(stripMeta(ast1));
}

function stripMeta(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripMeta);
  if (typeof obj === "object") {
    const rec = obj as Record<string, unknown>;
    // Normalize Escaped parts to Literal parts (functionally equivalent)
    if (rec.type === "Escaped") {
      return { type: "Literal", value: rec.value };
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rec)) {
      if (key === "line" || key === "sourceText" || key === "originalText")
        continue;
      result[key] = stripMeta(value);
    }
    return result;
  }
  return obj;
}

describe("serialize", () => {
  describe("simple commands", () => {
    it("basic command", () => roundTrip("echo hello"));
    it("command with multiple args", () => roundTrip("ls -la /tmp"));
    it("assignment only", () => roundTrip("x=1"));
    it("assignment with command", () => roundTrip("VAR=value echo test"));
    it("append assignment", () => roundTrip("PATH+=/new"));
    it("array assignment", () => roundTrip("arr=(a b c)"));
    it("empty assignment", () => roundTrip("x="));
  });

  describe("pipelines", () => {
    it("simple pipe", () => roundTrip("echo hello | cat"));
    it("multi-stage pipe", () => roundTrip("cat file | grep foo | wc -l"));
    it("negated pipeline", () => roundTrip("! grep foo file"));
    it("pipe stderr", () => roundTrip("cmd1 |& cmd2"));
    it("timed pipeline", () => roundTrip("time sleep 1"));
    it("timed posix pipeline", () => roundTrip("time -p sleep 1"));
  });

  describe("lists and operators", () => {
    it("&& chain", () => roundTrip("cmd1 && cmd2"));
    it("|| chain", () => roundTrip("cmd1 || cmd2"));
    it("semicolon chain", () => roundTrip("cmd1; cmd2"));
    it("mixed operators", () => roundTrip("cmd1 && cmd2 || cmd3"));
    it("background command", () => roundTrip("sleep 10 &"));
  });

  describe("redirections", () => {
    it("output redirect", () => roundTrip("echo hi > file.txt"));
    it("append redirect", () => roundTrip("echo hi >> file.txt"));
    it("input redirect", () => roundTrip("cat < file.txt"));
    it("stderr redirect", () => roundTrip("cmd 2> err.log"));
    it("stdout+stderr redirect", () => roundTrip("cmd &> all.log"));
    it("stdout+stderr append", () => roundTrip("cmd &>> all.log"));
    it("fd dup", () => roundTrip("cmd 2>&1"));
    it("fd close", () => roundTrip("cmd 2>&-"));
    it("here-string", () => roundTrip("cat <<< hello"));
    it("noclobber redirect", () => roundTrip("echo hi >| file.txt"));
    it("read-write redirect", () => roundTrip("cmd <> file.txt"));
    it("fd variable", () => roundTrip("exec {fd}> file.txt"));
  });

  describe("quoting and word parts", () => {
    it("single quoted", () => roundTrip("echo 'hello world'"));
    it("double quoted", () => roundTrip('echo "hello world"'));
    it("escaped char", () => roundTrip("echo hello\\ world"));
    it("variable expansion", () => roundTrip("echo $HOME"));
    it("braced variable", () => roundTrip("echo ${HOME}"));
    it("command substitution", () => roundTrip("echo $(pwd)"));
    it("backtick substitution", () => roundTrip("echo `pwd`"));
    it("arithmetic expansion", () => roundTrip("echo $((1 + 2))"));
    it("tilde expansion", () => roundTrip("cd ~"));
    it("tilde with user", () => roundTrip("ls ~root"));
    it("glob", () => roundTrip("ls *.txt"));
    it("brace expansion words", () => roundTrip("echo {a,b,c}"));
    it("brace expansion range", () => roundTrip("echo {1..10}"));
    it("brace expansion range with step", () => roundTrip("echo {1..10..2}"));
  });

  describe("parameter operations", () => {
    it("length", () => roundTrip("echo ${#var}"));
    it("default value (colon)", () => roundTrip("echo ${var:-default}"));
    it("default value (no colon)", () => roundTrip("echo ${var-default}"));
    it("assign default (colon)", () => roundTrip("echo ${var:=default}"));
    it("assign default (no colon)", () => roundTrip("echo ${var=default}"));
    it("error if unset (with message)", () =>
      roundTrip("echo ${var:?error msg}"));
    it("error if unset (no message)", () => roundTrip("echo ${var:?}"));
    it("error if unset (no colon)", () => roundTrip("echo ${var?error}"));
    it("use alternative (colon)", () => roundTrip("echo ${var:+alt}"));
    it("use alternative (no colon)", () => roundTrip("echo ${var+alt}"));
    it("substring offset only", () => roundTrip("echo ${var:2}"));
    it("substring offset and length", () => roundTrip("echo ${var:0:5}"));
    it("prefix removal", () => roundTrip("echo ${var#pattern}"));
    it("greedy prefix removal", () => roundTrip("echo ${var##pattern}"));
    it("suffix removal", () => roundTrip("echo ${var%pattern}"));
    it("greedy suffix removal", () => roundTrip("echo ${var%%pattern}"));
    it("pattern replacement", () => roundTrip("echo ${var/old/new}"));
    it("global pattern replacement", () => roundTrip("echo ${var//old/new}"));
    it("pattern replacement anchored start", () =>
      roundTrip("echo ${var/#old/new}"));
    it("pattern replacement anchored end", () =>
      roundTrip("echo ${var/%old/new}"));
    it("pattern replacement no replacement", () =>
      roundTrip("echo ${var/old}"));
    it("case upper", () => roundTrip("echo ${var^}"));
    it("case upper all", () => roundTrip("echo ${var^^}"));
    it("case lower", () => roundTrip("echo ${var,}"));
    it("case lower all", () => roundTrip("echo ${var,,}"));
    it("case upper with pattern", () => roundTrip("echo ${var^^[a-z]}"));
    it("indirection", () => roundTrip("echo ${!ref}"));
    it("indirection with inner op", () => roundTrip("echo ${!var##pattern}"));
    it("array keys @", () => roundTrip("echo ${!arr[@]}"));
    it("array keys *", () => roundTrip("echo ${!arr[*]}"));
    it("var name prefix @", () => roundTrip("echo ${!MY@}"));
    it("var name prefix *", () => roundTrip("echo ${!MY*}"));
    it("transform @Q", () => roundTrip("echo ${var@Q}"));
    it("special param $?", () => roundTrip("echo $?"));
    it("special param $#", () => roundTrip("echo $#"));
    it("special param $@", () => roundTrip("echo $@"));
    it("positional > 9", () => roundTrip("echo ${10}"));
  });

  describe("compound commands", () => {
    it("if/then/fi", () => roundTrip("if true; then echo yes; fi"));
    it("if/else", () => roundTrip("if true; then echo yes; else echo no; fi"));
    it("if/elif/else", () =>
      roundTrip(
        "if cmd1; then echo 1; elif cmd2; then echo 2; else echo 3; fi",
      ));

    it("for loop", () => roundTrip("for i in 1 2 3; do echo $i; done"));
    it("for loop no words", () => roundTrip("for x; do echo $x; done"));
    it("c-style for", () =>
      roundTrip("for ((i=0; i<10; i++)); do echo $i; done"));

    it("while loop", () => roundTrip("while true; do echo loop; done"));
    it("until loop", () => roundTrip("until false; do echo loop; done"));

    it("case statement", () =>
      roundTrip("case $x in a) echo a;; b|c) echo bc;; *) echo other;; esac"));
    it("case with fallthrough", () =>
      roundTrip("case $x in a) echo a;& b) echo b;; esac"));
    it("case with empty body", () => roundTrip("case $x in a) ;; esac"));

    it("subshell", () => roundTrip("(echo sub)"));
    it("group", () => roundTrip("{ echo group; }"));

    it("function def", () => roundTrip("myfunc() { echo hello; }"));

    it("if with redirections", () =>
      roundTrip("if true; then echo yes; fi > out.txt"));
    it("for with redirections", () =>
      roundTrip("for i in 1 2 3; do echo $i; done > out.txt"));
    it("while with redirections", () =>
      roundTrip("while true; do echo loop; done > out.txt"));
    it("case with redirections", () =>
      roundTrip("case $x in a) echo a;; esac > out.txt"));
    it("subshell with redirections", () => roundTrip("(echo sub) > out.txt"));
    it("group with redirections", () => roundTrip("{ echo group; } > out.txt"));
  });

  describe("arithmetic command", () => {
    it("simple arithmetic", () => roundTrip("((x = 1 + 2))"));
    it("comparison", () => roundTrip("((x > 5))"));
    it("ternary", () => roundTrip("((x = a > b ? a : b))"));
    it("increment", () => roundTrip("((x++))"));
    it("prefix decrement", () => roundTrip("((--x))"));
    it("nested parens", () => roundTrip("(((x + y) * z))"));
    it("array element", () => roundTrip("((arr[0] + arr[1]))"));
    it("array element assignment", () => roundTrip("((arr[0] = 5))"));
    it("array element with string key", () => roundTrip("((assoc[key] + 1))"));
    it("nested arithmetic expansion", () =>
      roundTrip("echo $((1 + $((2 + 3))))"));
    it("command substitution in arithmetic", () =>
      roundTrip("echo $((1 + $(echo 2)))"));
    it("dynamic base", () => roundTrip("echo $(( ${base}#ff ))"));
    it("dynamic octal number", () => roundTrip("echo $(( ${zero}11 ))"));
    it("single quote in arithmetic", () => roundTrip("(( '1' ))"));
    it("variable with dollar prefix", () => roundTrip("echo $(($x + 1))"));
    it("compound assignment +=", () => roundTrip("((x += 5))"));
    it("arithmetic with redirections", () =>
      roundTrip("((x = 1)) > /dev/null"));
  });

  describe("conditional command", () => {
    it("string comparison", () => roundTrip('[[ $a == "foo" ]]'));
    it("file test", () => roundTrip("[[ -f file.txt ]]"));
    it("and", () => roundTrip("[[ -f a && -f b ]]"));
    it("or", () => roundTrip("[[ -f a || -f b ]]"));
    it("negation", () => roundTrip("[[ ! -f a ]]"));
    it("grouped", () => roundTrip("[[ ( -f a || -f b ) && -d c ]]"));
    it("regex match", () => roundTrip("[[ $x =~ ^[0-9]+$ ]]"));
    it("bare word (non-empty test)", () => roundTrip('[[ "nonempty" ]]'));
  });

  describe("string escaping edge cases", () => {
    it("literal with spaces needs escaping", () =>
      roundTrip("echo hello\\ world"));
    it("literal with special chars", () => roundTrip("echo 'a&b|c;d'"));
    it("double quoted with variable", () => roundTrip('echo "hello $name"'));
    it("double quoted with backtick", () =>
      roundTrip('echo "result: `echo hi`"'));
    it("double quoted with command sub", () =>
      roundTrip('echo "result: $(echo hi)"'));
    it("single quotes inside double quotes", () =>
      roundTrip('echo "it\'s fine"'));
    it("double quotes inside single quotes", () =>
      roundTrip("echo '\"quoted\"'"));
    it("empty single quoted string", () => roundTrip("echo ''"));
    it("empty double quoted string", () => roundTrip('echo ""'));
    it("mixed quote types adjacent", () => roundTrip("echo 'a'\"b\"'c'"));
    it("backslash at end of word", () => roundTrip("echo test\\\\"));
    it("escaped newline", () => roundTrip("echo hello\\nworld"));
    it("tab in single quotes", () => roundTrip("echo 'a\tb'"));
    it("glob characters in quotes", () => roundTrip("echo 'file*.txt'"));
    it("parentheses in quotes", () => roundTrip("echo '(test)'"));
    it("brackets in quotes", () => roundTrip("echo '[test]'"));
    it("hash in quotes", () => roundTrip("echo '#comment'"));
    it("exclamation in single quotes", () => roundTrip("echo '!bang'"));
    it("tilde in quotes", () => roundTrip("echo '~user'"));
    it("braces in quotes", () => roundTrip("echo '{a,b}'"));
    it("parameter expansion in double quotes", () =>
      roundTrip('echo "${var}"'));
    it("nested double quotes in command sub", () =>
      roundTrip('echo "$(echo "inner")"'));
    it("arithmetic in double quotes", () =>
      roundTrip('echo "total: $((1 + 2))"'));
  });

  /**
   * Execution-based equivalence tests.
   * Verifies that parse → serialize produces functionally equivalent bash
   * by executing both the original and serialized script and comparing output.
   * This catches escaping edge cases that can't be tested via AST round-trip
   * (e.g., escaped quotes/dollars/backticks inside double quotes).
   */
  describe("execution equivalence", () => {
    async function execEquiv(
      input: string,
      opts?: { env?: Record<string, string> },
    ): Promise<void> {
      const serialized = serialize(parse(input));
      const bash1 = new Bash({ env: opts?.env });
      const bash2 = new Bash({ env: opts?.env });
      const r1 = await bash1.exec(input, { rawScript: true });
      const r2 = await bash2.exec(serialized, { rawScript: true });
      expect(r2.stdout).toBe(r1.stdout);
      expect(r2.stderr).toBe(r1.stderr);
      expect(r2.exitCode).toBe(r1.exitCode);
    }

    // Basic quoting
    it("single quoted string", () => execEquiv("echo 'hello world'"));
    it("double quoted string", () => execEquiv('echo "hello world"'));
    it("empty single quotes", () => execEquiv("echo ''"));
    it("empty double quotes", () => execEquiv('echo ""'));
    it("mixed quote types", () => execEquiv("echo 'a'\"b\"'c'"));

    // Escaping inside double quotes
    it("escaped dollar in double quotes", () =>
      execEquiv('echo "price is \\$5"'));
    it("escaped double quote in double quotes", () =>
      execEquiv('echo "say \\"hello\\""'));
    it("escaped backtick in double quotes", () =>
      execEquiv('echo "\\`not a command\\`"'));
    it("escaped backslash in double quotes", () =>
      execEquiv('echo "path\\\\dir"'));
    it("literal backslash-n in double quotes", () =>
      execEquiv('echo "line1\\nline2"'));

    // Variables and expansions in double quotes
    it("variable in double quotes", () => execEquiv('echo "home: $HOME"'));
    it("braced variable in double quotes", () =>
      execEquiv('echo "home: ${HOME}"'));
    it("command substitution in double quotes", () =>
      execEquiv('echo "result: $(echo hi)"'));
    it("backtick substitution in double quotes", () =>
      execEquiv('echo "result: `echo hi`"'));
    it("arithmetic in double quotes", () =>
      execEquiv('echo "total: $((2 + 3))"'));
    it("nested command sub with inner quotes", () =>
      execEquiv('echo "$(echo "inner value")"'));

    // Special characters in single quotes
    it("dollar sign in single quotes", () => execEquiv("echo '$HOME'"));
    it("backtick in single quotes", () => execEquiv("echo '`cmd`'"));
    it("double quotes in single quotes", () => execEquiv("echo '\"quoted\"'"));
    it("backslash in single quotes", () => execEquiv("echo 'back\\slash'"));
    it("exclamation in single quotes", () => execEquiv("echo '!bang'"));
    it("hash in single quotes", () => execEquiv("echo '#not a comment'"));
    it("all metacharacters in single quotes", () =>
      execEquiv("echo '|&;<>()$`\\\"!#~*?[]{}'"));

    // Unquoted escaping
    it("escaped space in literal", () => execEquiv("echo hello\\ world"));
    it("escaped special chars", () => execEquiv("echo a\\&b\\|c\\;d"));
    it("escaped glob", () => execEquiv("echo \\*.txt"));
    it("escaped hash", () => execEquiv("echo \\#not-comment"));

    // Parameter expansion edge cases
    it("default with special chars", () =>
      execEquiv('echo ${x:-"hello world"}'));
    it("nested expansion in default", () =>
      execEquiv("x=greeting; echo ${x:-$(echo fallback)}"));
    it("substring of variable", () => execEquiv('x=hello; echo "${x:1:3}"'));
    it("length of variable", () => execEquiv("x=hello; echo ${#x}"));
    it("pattern replacement", () =>
      execEquiv('x="hello world"; echo ${x/world/earth}'));
    it("case modification", () =>
      execEquiv("x=hello; echo ${x^}; echo ${x^^}"));

    // Heredocs
    it("heredoc with variable", () =>
      execEquiv("x=world; cat <<EOF\nhello $x\nEOF"));
    it("quoted heredoc preserves literal dollar", () =>
      execEquiv("cat <<'EOF'\nhello $x\nEOF"));
    it("heredoc with command substitution", () =>
      execEquiv("cat <<EOF\nresult: $(echo 42)\nEOF"));
    it("heredoc with special chars in body", () =>
      execEquiv("cat <<EOF\n!@#$%^&*()\nEOF"));
    it("heredoc with all special chars", () =>
      execEquiv("cat <<EOF\n!@#$%^&*\nEOF"));
    it("heredoc with backticks", () =>
      execEquiv("cat <<EOF\nresult: `echo hi`\nEOF"));
    it("heredoc with empty lines", () => execEquiv("cat <<EOF\n\nline\n\nEOF"));
    it("heredoc with tabs", () => execEquiv("cat <<EOF\n\ttabbed\nEOF"));
    it("quoted heredoc with backticks", () =>
      execEquiv("cat <<'EOF'\n`not a command`\nEOF"));
    it("heredoc with escaped dollar", () =>
      execEquiv("cat <<EOF\nprice: \\$5\nEOF"));
    it("strip-tabs heredoc", () =>
      execEquiv("cat <<-EOF\n\thello\n\tworld\nEOF"));

    // Complex combinations
    it("mixed quoting in arguments", () =>
      execEquiv("echo 'single' \"double\" plain"));
    it("variable assignment then use in quotes", () =>
      execEquiv('x="hello world"; echo "value: $x"'));
    it("command sub with pipe in double quotes", () =>
      execEquiv('echo "lines: $(echo -e "a\\nb" | wc -l)"'));
    it("brace expansion (unquoted)", () => execEquiv("echo {a,b,c}"));
    it("tilde expansion", () => execEquiv("echo ~"));
    it("arithmetic expansion", () => execEquiv("echo $((3 * 7 + 1))"));
    it("multiple statements", () => execEquiv("echo first; echo second"));
    it("conditional and logic", () => execEquiv("true && echo yes || echo no"));
    it("if statement", () =>
      execEquiv('if [ 1 -eq 1 ]; then echo "equal"; fi'));
    it("for loop", () => execEquiv('for i in a b c; do echo "item: $i"; done'));
    it("case statement", () =>
      execEquiv(
        'x=hello; case $x in hello) echo "matched";; *) echo "nope";; esac',
      ));

    // Double-quote escaping stress tests
    it("adjacent escaped and unescaped dollars", () =>
      execEquiv('x=val; echo "\\$x is $x"'));
    it("escaped dollar at end of double quotes", () =>
      execEquiv('echo "end\\$"'));
    it("escaped dollar at start of double quotes", () =>
      execEquiv('echo "\\$start"'));
    it("multiple escaped dollars", () => execEquiv('echo "\\$a \\$b \\$c"'));
    it("escaped backslash before dollar", () =>
      execEquiv('x=val; echo "\\\\$x"'));
    it("escaped backslash before escaped dollar", () =>
      execEquiv('echo "\\\\\\$x"'));
    it("dollar in single quotes then double quotes", () =>
      execEquiv("echo '$literal' \"$HOME\""));
    it("empty command substitution", () => execEquiv('echo "$(true)"'));
    it("here-string with quotes", () => execEquiv('cat <<< "hello world"'));
    it("here-string with variable", () =>
      execEquiv('x=hello; cat <<< "$x world"'));
    it("nested subshell in double quotes", () =>
      execEquiv('echo "$(echo "$(echo deep)")"'));
    it("escaped newline continues line", () =>
      execEquiv("echo hello\\\nworld"));
    it("while loop with read", () =>
      execEquiv('echo "a b c" | while read x y z; do echo "$x:$y:$z"; done'));
    it("array in subshell", () => execEquiv("(arr=(x y z); echo ${arr[1]})"));
    it("double quoted glob stays literal", () => execEquiv('echo "*.txt"'));
    it("unquoted backslash before newline in heredoc", () =>
      execEquiv("cat <<EOF\nline1\\\nline2\nEOF"));
  });

  describe("heredocs", () => {
    it("basic heredoc", () => roundTrip("cat <<EOF\nhello\nEOF"));
    it("quoted heredoc", () => roundTrip("cat <<'EOF'\nhello\nEOF"));
    it("strip-tabs heredoc", () => roundTrip("cat <<-EOF\nhello\nEOF"));
    it("heredoc with multiple lines", () =>
      roundTrip("cat <<EOF\nline1\nline2\nline3\nEOF"));
    it("heredoc with empty lines", () => roundTrip("cat <<EOF\n\nline\n\nEOF"));
    it("heredoc with variable expansion", () =>
      roundTrip("cat <<EOF\nhello $name\nEOF"));
    it("quoted heredoc preserves dollar signs", () =>
      roundTrip("cat <<'EOF'\nhello $name\nEOF"));
    it("heredoc with command substitution", () =>
      roundTrip("cat <<EOF\nresult: $(echo hi)\nEOF"));
    it("heredoc with tabs", () => roundTrip("cat <<EOF\n\ttabbed\nEOF"));
    it("heredoc fed to command", () =>
      roundTrip("grep pattern <<EOF\nfoo pattern bar\nEOF"));
  });

  describe("complex scripts", () => {
    it("pipeline with redirections", () =>
      roundTrip("cmd1 2>&1 | cmd2 > out.txt"));

    it("nested command substitution", () =>
      roundTrip("echo $(echo $(echo hi))"));

    it("compound in pipeline", () => roundTrip("{ echo a; echo b; } | cat"));

    it("function with if", () =>
      roundTrip("f() { if true; then echo yes; fi; }"));

    it("for with pipeline body", () =>
      roundTrip("for i in 1 2 3; do echo $i | cat; done"));

    it("function with redirections", () =>
      roundTrip("f() { echo hello; } > out.txt"));
  });
});
