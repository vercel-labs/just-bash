import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const script = `echo "$# [\${10}] [\${11}]"; printf '(%s)' "$@"; echo; for a; do printf '[%s]' "$a"; done; echo\n`;
const expected =
  "11 [j] [k]\n(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)\n[a][b][c][d][e][f][g][h][i][j][k]\n";

describe("more than nine positional parameters", () => {
  it("should pass every argument to a sourced script", async () => {
    const env = new Bash({ files: { "/s.sh": script } });
    const result = await env.exec("source /s.sh a b c d e f g h i j k");
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should pass every argument to a script run by path", async () => {
    const env = new Bash({ files: { "/s.sh": script } });
    await env.exec("chmod +x /s.sh");
    const result = await env.exec("/s.sh a b c d e f g h i j k");
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should hide and restore the caller's parameters around source", async () => {
    const env = new Bash({
      files: { "/s.sh": `echo "$# [\${10}] [\${11}]"\n` },
    });
    const result = await env.exec(
      `set -- 1 2 3 4 5 6 7 8 9 10 11; source /s.sh x; echo "$# [\${10}] [\${11}]"`,
    );
    expect(result.stdout).toBe("1 [] []\n11 [10] [11]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should not leak the caller's parameters into a script run by path", async () => {
    const env = new Bash({
      files: { "/s.sh": `echo "$# [\${10}] [\${11}]"\n` },
    });
    await env.exec("chmod +x /s.sh");
    const result = await env.exec(
      `set -- 1 2 3 4 5 6 7 8 9 10 11; /s.sh x; echo "$# [\${10}] [\${11}]"`,
    );
    expect(result.stdout).toBe("1 [] []\n11 [10] [11]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should not scan up to a seeded $# when running a script by path", async () => {
    const env = new Bash({
      files: { "/s.sh": `echo "$# [$1]"\n` },
      executionLimits: { maxArrayElements: 10, maxLoopIterations: 10 },
    });
    await env.exec("chmod +x /s.sh");
    const result = await env.exec("env '#=1000000000' /s.sh x");
    expect(result.stdout).toBe("1 [x]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should not scan up to a seeded $# when sourcing or calling a function", async () => {
    const env = new Bash({
      env: { "#": "1000000000" },
      files: { "/s.sh": `echo "$# [$1]"\n` },
      executionLimits: { maxArrayElements: 10, maxLoopIterations: 10 },
    });
    const result = await env.exec(
      `source /s.sh x; f () { echo "$# [$1]"; }; f y`,
    );
    expect(result.stdout).toBe("1 [x]\n1 [y]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should pass arguments when $# is not a number", async () => {
    const env = new Bash({
      env: { "#": "abc" },
      files: { "/s.sh": `echo "$# [$1] [$2]"\n` },
    });
    await env.exec("chmod +x /s.sh");
    const result = await env.exec(
      `/s.sh a b; source /s.sh c d; f () { echo "$# [$1] [$2]"; }; f e g`,
    );
    expect(result.stdout).toBe("2 [a] [b]\n2 [c] [d]\n2 [e] [g]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should hide and restore contiguous parameters set beyond $#", async () => {
    const seeded = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [String(i + 1), `p${i + 1}`]),
    );
    const env = new Bash({
      env: { ...seeded, "#": "0" },
      files: { "/s.sh": `echo "$# [\${12}]"\n` },
    });
    await env.exec("chmod +x /s.sh");
    const result = await env.exec(
      `/s.sh x; source /s.sh y; echo "after [\${12}]"`,
    );
    expect(result.stdout).toBe("1 []\n1 []\nafter [p12]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should drop parameters set by a function or by source inside a function", async () => {
    const env = new Bash({
      files: { "/s.sh": "set -- 1 2 3 4 5 6 7 8 9 10\n" },
    });
    const result = await env.exec(
      `f () { set -- 1 2 3 4 5 6 7 8 9 10; }; g () { set -- a; source /s.sh x; echo "[$#][$1][$2][\${10}]"; }; g; set -- a; f y; echo "[$#][$1][$2][\${10}]"`,
    );
    expect(result.stdout).toBe("[1][a][][]\n[1][a][][]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should hide seeded single digit parameters after a gap", async () => {
    const env = new Bash({
      env: { "1": "a", "3": "c" },
      files: { "/s.sh": `echo "[$#][$1][$3]"\n` },
    });
    await env.exec("chmod +x /s.sh");
    const result = await env.exec(`/s.sh; /s.sh x; source /s.sh y`);
    expect(result.stdout).toBe("[0][][]\n[1][x][]\n[1][y][]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
