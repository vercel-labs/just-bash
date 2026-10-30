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
});
