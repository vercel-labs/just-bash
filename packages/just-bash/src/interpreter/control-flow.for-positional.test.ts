import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("for loop without an in list", () => {
  it("should keep spaces and empty parameters inside a function", async () => {
    const env = new Bash();
    const result = await env.exec(
      `f () { for a; do echo "[$a]"; done; }; f "a b" "" c`,
    );
    expect(result.stdout).toBe("[a b]\n[]\n[c]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should accept the form without a semicolon", async () => {
    const env = new Bash();
    const result = await env.exec(
      `f () { for a do echo "[$a]"; done; }; f "x  y" ""`,
    );
    expect(result.stdout).toBe("[x  y]\n[]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should not split on tabs or newlines or expand globs", async () => {
    const env = new Bash({ files: { "/a.txt": "", "/b.txt": "" } });
    const result = await env.exec(
      `cd /; set -- "$(printf 't\\tu')" "$(printf 'n\\nl')" "*.txt"; for a; do printf '<%s>' "$a"; done; echo`,
    );
    expect(result.stdout).toBe("<t\tu><n\nl><*.txt>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should not run the body when there are no parameters", async () => {
    const env = new Bash();
    const result = await env.exec(
      `set --; for a; do echo "[$a]"; done; echo done`,
    );
    expect(result.stdout).toBe("done\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should iterate more than nine parameters in order", async () => {
    const env = new Bash();
    const result = await env.exec(
      `set -- 1 2 3 4 5 6 7 8 9 "1 0" 11; for a; do printf '[%s]' "$a"; done; echo`,
    );
    expect(result.stdout).toBe("[1][2][3][4][5][6][7][8][9][1 0][11]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should use the parameters from when the loop started", async () => {
    const env = new Bash();
    const result = await env.exec(
      `set -- "a b" c; for a; do echo "[$a]"; set -- z; done; for a; do echo "[$a]"; done`,
    );
    expect(result.stdout).toBe("[a b]\n[c]\n[z]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should enforce the element limit before reading a seeded $#", async () => {
    const env = new Bash({ env: { "#": "1000000000" } });
    const result = await env.exec(`for a; do :; done; echo after`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: for-loop expansion element limit exceeded (1000000)\n",
    );
    expect(result.exitCode).toBe(126);
  });

  it("should iterate the arguments of a sourced script", async () => {
    const env = new Bash({
      files: { "/s.sh": `for a; do echo "[$a]"; done\n` },
    });
    const result = await env.exec(`source /s.sh "p q" ""`);
    expect(result.stdout).toBe("[p q]\n[]\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
