import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("structured array state integrity", () => {
  it("keeps scalar names independent from indexed array storage", async () => {
    const result = await new Bash().exec(`
      a=(array-zero array-one)
      a_0=scalar-zero
      a__length=scalar-length
      printf '%s|%s|%s\n' "\${a[0]}" "$a_0" "$a__length"
      a=(replacement)
      printf '%s|%s|%s\n' "\${a[0]}" "$a_0" "$a__length"
    `);

    expect(result).toMatchObject({
      stdout:
        "array-zero|scalar-zero|scalar-length\nreplacement|scalar-zero|scalar-length\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves exact associative keys including former metadata prefixes", async () => {
    const result = await new Bash().exec(`
      declare -A a=(['_length']=exact ['_lengthfoo']=long ['x_y']=under)
      printf '%s|%s|%s\n' "\${a[_length]}" "\${a[_lengthfoo]}" "\${a[x_y]}"
      printf '<%s>\n' "\${!a[@]}"
    `);

    expect(result.stdout).toBe(
      "exact|long|under\n<_length>\n<_lengthfoo>\n<x_y>\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("uses identical associative subscript normalization for value and set tests", async () => {
    const result = await new Bash().exec(`
      declare -A a=([actual]=value)
      key=actual
      printf '%s|%s\n' "\${a[$key]:-fallback}" "\${a[$key]+set}"
    `);

    expect(result).toMatchObject({
      stdout: "value|set\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([
    ["export", "readonly x=old; export x=new"],
    ["export -n", "readonly x=old; export -n x=new"],
    ["read", "readonly x=old; read x <<< new"],
    ["read -a", "readonly -a x=(old); read -a x <<< new"],
    ["mapfile", "readonly -a x=(old); mapfile x <<< new"],
    ["declare literal", "readonly -a x=(old); declare x=(new)"],
    ["unset element", "readonly -a x=(old); unset 'x[0]'"],
    ["printf -v", "readonly -a x=(old); printf -v 'x[0]' %s new"],
  ])("rejects readonly mutation through %s", async (_label, script) => {
    const result = await new Bash().exec(script);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/readonly variable|cannot unset/);
  });

  it("restores complete local arrays and removes newly-created elements", async () => {
    const result = await new Bash().exec(`
      a=(outer0 outer1)
      f() { local a=(inner0 inner1 inner2); a[8]=inner8; }
      f
      printf '%s|%s|%s\n' "\${a[0]}" "\${a[1]}" "\${a[8]-missing}"
    `);

    expect(result).toMatchObject({
      stdout: "outer0|outer1|missing\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("hides stale positional parameters in nested function calls", async () => {
    const result = await new Bash().exec(`
      inner() { printf '%s|%s|%s\n' "$#" "\${2-unset}" "\${3-unset}"; }
      outer() { inner only; }
      outer one two three
    `);

    expect(result).toMatchObject({
      stdout: "1|unset|unset\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
