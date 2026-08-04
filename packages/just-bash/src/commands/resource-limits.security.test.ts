import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { ExecutionLimitError } from "../interpreter/errors.js";

describe("standalone command resource limits", () => {
  it("bounds cat's aggregate repeated stdin before concatenating it", async () => {
    const bash = new Bash({ executionLimits: { maxOutputSize: 5 } });
    const result = await bash.exec("printf 1234 | cat - -");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "cat: output size limit exceeded (5 bytes)",
    );
  });

  it("bounds cat transformations before expanding the next byte", async () => {
    const bash = new Bash({
      files: { "/bytes": "\x7f\x7f" },
      executionLimits: { maxStringLength: 100, maxOutputSize: 3 },
    });
    const result = await bash.exec("cat -v /bytes");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("cat: output size limit exceeded");
  });

  it("bounds join's duplicate-key Cartesian product", async () => {
    const bash = new Bash({
      files: {
        "/a": "1 a\n1 b\n1 c\n",
        "/b": "1 x\n1 y\n1 z\n",
      },
      executionLimits: { maxLoopIterations: 4 },
    });
    const result = await bash.exec("join /a /b");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("join: iteration limit exceeded (4)");
  });

  it("bounds fragmented strings results before retaining another entry", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 2 } });
    const result = await bash.exec("printf 'a\\0b\\0c\\0' | strings -n 1");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "strings: array element limit exceeded (2)",
    );
  });

  it("bounds strings aggregate input across repeated stdin operands", async () => {
    const bash = new Bash({
      files: { "/f": "abcdef" },
      executionLimits: { maxStringLength: 10 },
    });
    const result = await bash.exec("strings -n 1 /f /f");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "strings: aggregate input size limit exceeded",
    );
  });

  it.each([
    "0",
    "-1",
    "nope",
    "999999999999999999999999",
  ])("rejects a non-positive or malformed xargs -n value (%s)", async (value) => {
    const bash = new Bash();
    const result = await bash.exec(`printf x | xargs -n ${value} echo`);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("xargs: invalid number for -n");
  });

  it("bounds xargs item arrays while tokenizing", async () => {
    const bash = new Bash({ executionLimits: { maxArrayElements: 2 } });
    const result = await bash.exec("printf 'a b c' | xargs echo");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("xargs: array element limit exceeded (2)");
  });

  it("bounds tr SET range expansion before constructing the range", async () => {
    const bash = new Bash({ executionLimits: { maxLoopIterations: 5 } });
    const result = await bash.exec("printf abc | tr 'a-z' 'A-Z'");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "tr: SET expansion iteration limit exceeded (5)",
    );
  });

  it("shares grep's filesystem-operation budget across recursion", async () => {
    const bash = new Bash({
      files: {
        "/tree/a": "needle\n",
        "/tree/b": "needle\n",
        "/tree/c": "needle\n",
      },
      executionLimits: { maxGlobOperations: 2 },
    });
    const result = await bash.exec("grep -r needle /tree");

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain("grep: glob operation limit exceeded (2)");
  });

  it("passes grep's matcher work budget to stdin searches", async () => {
    const bash = new Bash({ executionLimits: { maxLoopIterations: 2 } });
    const input = `${"a\\n".repeat(24)}`;
    const result = await bash.exec(`printf '${input}' | grep a`);

    expect(result.exitCode).toBe(ExecutionLimitError.EXIT_CODE);
    expect(result.stderr).toContain(
      "search: matching work limit exceeded (20)",
    );
  });
});
