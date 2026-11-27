import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("awk parenthesized concatenation", () => {
  it.each([
    " ",
    "\t",
    " \\\n",
  ])("concatenates a variable and parentheses separated by %j", async (separator) => {
    const bash = new Bash();
    const result = await bash.exec(
      `awk 'BEGIN { a[1]="x"; a[2]="y"; s=""; for(i=1;i<=2;i++) s=s${separator}((a[i]=="x")?"T":"F"); print "s="s }'`,
    );
    expect(result.stdout).toBe("s=TF\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves adjacent user calls and whitespace before built-in calls", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `awk 'function twice(x) { return x*2 } BEGIN { print twice(3), length ("abc"), substr ("abc",2) }'`,
    );
    expect(result.stdout).toBe("6 3 bc\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("concatenates a field selected by a variable with parentheses", async () => {
    const result = await new Bash().exec(
      `awk 'BEGIN { i=1; $0="a b"; print $i ("x") }'`,
    );
    expect(result).toMatchObject({ stdout: "ax\n", stderr: "", exitCode: 0 });
  });

  it("rejects a defined function name used as a variable", async () => {
    for (const separator of [" ", "\\\n"]) {
      const result = await new Bash().exec(
        `awk 'function twice(x) { return x*2 } BEGIN { print twice${separator}(3) }'`,
      );
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "cannot use function twice as a variable",
      );
      expect(result.exitCode).not.toBe(0);
    }
  });
});
