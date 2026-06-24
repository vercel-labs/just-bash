import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

// Regression tests: script normalization (which strips leading indentation so
// indented template literals parse) must NOT trim lines that begin inside a
// multi-line single- or double-quoted string. There the leading whitespace is
// literal (POSIX) and must be preserved verbatim, e.g. the body of
// `python3 -c '...'`.
describe("multi-line quoted string whitespace", () => {
  it("preserves leading indentation inside a single-quoted string", async () => {
    const env = new Bash();
    const result = await env.exec(
      "printf '%s' 'import sys\nfor p in [1]:\n    print(p)\n'",
    );
    expect(result.stdout).toBe("import sys\nfor p in [1]:\n    print(p)\n");
    expect(result.exitCode).toBe(0);
  });

  it("preserves leading indentation inside a double-quoted string", async () => {
    const env = new Bash();
    const result = await env.exec(
      'printf "%s" "first\n    second\n        third\n"',
    );
    expect(result.stdout).toBe("first\n    second\n        third\n");
    expect(result.exitCode).toBe(0);
  });

  it("preserves indentation through a variable assignment and expansion", async () => {
    const env = new Bash();
    const result = await env.exec(
      "v='a\n    b\n        c'\nprintf '%s' \"$v\"",
    );
    expect(result.stdout).toBe("a\n    b\n        c");
    expect(result.exitCode).toBe(0);
  });

  it("still strips indentation from the surrounding (unquoted) script", async () => {
    const env = new Bash();
    const result = await env.exec(
      "    if true; then\n        printf '%s' '    keep'\n    fi",
    );
    expect(result.stdout).toBe("    keep");
    expect(result.exitCode).toBe(0);
  });

  it("is not confused by an apostrophe inside a comment", async () => {
    const env = new Bash();
    // The `'` in the comment must not open a quote that swallows the next
    // line's indentation handling.
    const result = await env.exec(
      "echo start # don't trip on this\n    printf '%s' 'x\n    y'",
    );
    expect(result.stdout).toBe("start\nx\n    y");
    expect(result.exitCode).toBe(0);
  });
});
