import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Real jq's string interpolation `"\(...)"` correctly handles nested
// double-quoted strings inside the interpolation (e.g. sub("T.*"; ""),
// ltrimstr("ab")). Our tokenizer currently terminates the outer string at
// the first inner `"`, producing parse errors. These tests pin the
// real-jq behavior so the fix can be validated.
describe("jq string interpolation with nested double-quoted strings", () => {
  it("evaluates sub() with two string literals inside interpolation", async () => {
    const env = new Bash({
      files: { "/payload.json": '{"m":"2026-06-05T10:00:00Z"}\n' },
    });

    const result = await env.exec(
      `jq -r '"\\(.m | sub("T.*"; ""))"' /payload.json`,
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("2026-06-05\n");
    expect(result.exitCode).toBe(0);
  });

  it("evaluates string concatenation with nested string literal", async () => {
    const env = new Bash({
      files: { "/payload.json": '{"m":"hi"}\n' },
    });

    const result = await env.exec(`jq -r '"\\(.m + "!")"' /payload.json`);

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("hi!\n");
    expect(result.exitCode).toBe(0);
  });

  it("evaluates ltrimstr() with a nested string literal", async () => {
    const env = new Bash({
      files: { "/payload.json": '{"m":"abcd"}\n' },
    });

    const result = await env.exec(
      `jq -r '"\\(.m | ltrimstr("ab"))"' /payload.json`,
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("cd\n");
    expect(result.exitCode).toBe(0);
  });

  it("evaluates the full transcript filter over an array", async () => {
    const env = new Bash({
      files: {
        "/payload.json":
          '[{"m":"2026-06-05T10:00:00Z","n":1,"u":"alice","t":"hello"},' +
          '{"m":"2026-06-06T11:00:00Z","n":2,"u":"bob","t":"world"}]\n',
      },
    });

    const result = await env.exec(
      `jq -r '.[] | "\\(.m | sub("T.*"; "")) #\\(.n) @\\(.u): \\(.t)"' /payload.json`,
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      "2026-06-05 #1 @alice: hello\n2026-06-06 #2 @bob: world\n",
    );
    expect(result.exitCode).toBe(0);
  });

  it("balances parens correctly when nested string contains a paren", async () => {
    const env = new Bash({
      files: { "/payload.json": '{"m":"(hello)"}\n' },
    });

    const result = await env.exec(
      `jq -r '"\\(.m | sub("[(]"; "X"))"' /payload.json`,
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("Xhello)\n");
    expect(result.exitCode).toBe(0);
  });

  // Control cases: these already pass and should continue to pass after the
  // fix. They document the boundary of the bug (no nested string literal
  // inside the interpolation parens).
  it("control: arithmetic inside interpolation (no nested strings)", async () => {
    const env = new Bash({
      files: { "/payload.json": '{"n":5}\n' },
    });

    const result = await env.exec(`jq -r '"\\(.n + 1)"' /payload.json`);

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("6\n");
    expect(result.exitCode).toBe(0);
  });

  it("control: @tsv format string works on array rows", async () => {
    const env = new Bash({
      files: {
        "/payload.json": '[{"a":1,"b":2},{"a":3,"b":4}]\n',
      },
    });

    const result = await env.exec(
      `jq -r '.[] | [.a, .b] | @tsv' /payload.json`,
    );

    expect(result.stderr).toBe("");
    expect(result.stdout).toBe("1\t2\n3\t4\n");
    expect(result.exitCode).toBe(0);
  });
});
