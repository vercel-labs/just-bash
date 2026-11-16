import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

/**
 * A `$(...)` / backtick substitution nested inside `$(( ))` or `(( ))` used to
 * run through `ctx.execFn`, a fresh top-level execution seeded from the
 * instance's base state. It could not see anything the running script had
 * assigned, and `Number.parseInt(output, 10) || 0` turned the resulting empty
 * output into a plausible wrong number instead of an error.
 *
 * Reported downstream as ai-ecoverse/slicc#2978.
 */
describe("command substitution inside arithmetic", () => {
  it("does not leak the initial environment in place of script state", async () => {
    const bash = new Bash({ env: { X: "initial-value" } });

    const result = await bash.exec(
      'X=abc\necho $(( $(echo -n "$X" | wc -c) ))',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("3\n");
    expect(result.stderr).toBe("");
  });

  it("forwards substitution stderr at expansion time", async () => {
    const bash = new Bash();

    const result = await bash.exec(
      'echo $(( $(echo "boom" >&2; echo 3) + 1 ))',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("4\n");
    expect(result.stderr).toBe("boom\n");
  });

  it("treats an exiting substitution the way a plain one does", async () => {
    const bash = new Bash();

    const result = await bash.exec('echo $(( $(exit 7; echo 1) ))\necho "$?"');

    // Matches bash: the exit discards the output, so the operand is empty (0),
    // and $? reports the `echo` that consumed it rather than the substitution.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("0\n0\n");
    expect(result.stderr).toBe("");
  });

  it("does not silently turn unparsable output into 0", async () => {
    const bash = new Bash();

    const result = await bash.exec(
      'echo "[$(( $(echo "hello world") ))]"\necho "status=$?"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("status=1\n");
    expect(result.stderr).toBe(
      'bash: world: syntax error: invalid arithmetic operator (error token is "world")\n',
    );
  });

  it("does not re-expand a substitution present in the output", async () => {
    const bash = new Bash();

    const result = await bash.exec(
      'f() { echo "\\$(f)"; }\necho "[$(( $(f) ))]"\necho "status=$?"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("status=1\n");
    expect(result.stderr).toBe(
      'bash: $(f): syntax error: operand expected (error token is "$(f)")\n',
    );
  });

  it("does not reach command execution through variable indirection", async () => {
    const bash = new Bash();

    // GNU bash: `$(echo PWNED): syntax error: operand expected`. The command
    // must not run just because its text reached arithmetic as *data*.
    const result = await bash.exec(
      'a=\'$(echo PWNED >&2; echo 1)\'\nb=a\necho "[$(( b ))]"\necho "status=$?"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("status=1\n");
    expect(result.stderr).toBe(
      'bash: $(echo PWNED >&2; echo 1): syntax error: operand expected (error token is "$(echo PWNED >&2; echo 1)")\n',
    );
  });

  it("still expands a command substitution in an array subscript from data", async () => {
    const bash = new Bash();

    // bash *does* expand subscripts reached through data, unlike bare operands
    // (spec-tests bugs.test.sh records this as bash behaviour).
    const result = await bash.exec(
      "a=(0 1 2)\nb=(3 4 5)\nsub='a[$(echo 2)]'\necho \"${b[sub]}\"",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("5\n");
    expect(result.stderr).toBe("");
  });

  it("discards shell state mutated inside the substitution", async () => {
    const bash = new Bash();

    const result = await bash.exec(
      "echo $(( $(f() { :; }; set -u; cd /tmp; echo 1) ))\n" +
        "type f 2>&1 | head -1\n" +
        'echo "unset=[$UNSET_VAR] status=$?"\n' +
        'test "$PWD" != /tmp && echo cwd-kept',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "1\nbash: type: f: not found\nunset=[] status=0\ncwd-kept\n",
    );
    expect(result.stderr).toBe("");
  });

  it("is bounded by the substitution nesting guard, like a plain one", async () => {
    const plain = await new Bash().exec('f() { echo "$(f)"; }\nf');
    const arithmetic = await new Bash().exec(
      "f() { echo $(( $(f) + 1 )); }\nf",
    );

    expect(arithmetic.exitCode).toBe(plain.exitCode);
    expect(arithmetic.stdout).toBe("");
    expect(arithmetic.stderr).toBe(plain.stderr);
    expect(arithmetic.stderr).toBe(
      "bash: Command substitution nesting limit exceeded (50)\n",
    );
  });

  it("evaluates deeply nested substitutions", async () => {
    const bash = new Bash();

    const result = await bash.exec("echo $(( $(echo $(echo $(echo 5))) + 1 ))");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("6\n");
    expect(result.stderr).toBe("");
  });

  it("keeps quoting intact in the (( )) command form", async () => {
    const bash = new Bash();

    const result = await bash.exec(
      'Q="a  b"\n(( n = $(printf %s "$Q" | wc -c) ))\necho "$n"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("4\n");
    expect(result.stderr).toBe("");
  });

  it("does not execute variable data spliced into a backtick substitution", async () => {
    const bash = new Bash();

    const result = await bash.exec(
      "Q='$(echo PWNED)'\necho $(( `printf %s \"$Q\" | wc -c` ))",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("13\n");
    expect(result.stderr).toBe("");
  });

  it("sees script state from an array subscript substitution", async () => {
    const bash = new Bash({ env: { X: "initial-value" } });

    const result = await bash.exec(
      'arr=(zero one two three)\nX=ab\necho "${arr[$(echo "$X" | wc -c)]}"',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("three\n");
    expect(result.stderr).toBe("");
  });
});
