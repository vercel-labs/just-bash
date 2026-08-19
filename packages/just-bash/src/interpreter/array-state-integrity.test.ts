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

  it("evaluates indexed subscripts once while reading colon parameter operators", async () => {
    const result = await new Bash().exec(`
      values=(zero value)
      i=0
      set -- \${values[i += 1]:-default}
      printf 'default=%s|i=%s\n' "$1" "$i"
      i=0
      set -- \${values[i += 1]:+alternative}
      printf 'alternative=%s|i=%s\n' "$1" "$i"
      i=0
      set -- \${values[i += 1]:?missing}
      printf 'required=%s|i=%s\n' "$1" "$i"
      values=(zero value)
      declare -n element='values[i += 1]'
      i=0
      set -- \${element:-fallback}
      printf 'nameref=%s|i=%s\n' "$1" "$i"
      unset values
      set -u
      i=0
      set -- \${values[i += 1]:-fallback}
      printf 'nounset=%s|i=%s\n' "$1" "$i"
    `);

    expect(result).toMatchObject({
      stdout:
        "default=value|i=1\nalternative=alternative|i=1\nrequired=value|i=1\nnameref=value|i=1\nnounset=fallback|i=1\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("does not re-evaluate invalid indexed subscripts", async () => {
    const result = await new Bash().exec(`
      values=()
      i=0
      set -- \${values[i -= 1]:-fallback}
      printf 'value=%s|i=%s\n' "$1" "$i"
    `);

    expect(result).toMatchObject({
      stdout: "value=fallback|i=-1\n",
      stderr: "bash: line 4: values: bad array subscript\n",
      exitCode: 0,
    });
  });

  it("evaluates mixed default words from one prepared indexed target", async () => {
    const result = await new Bash().exec(`
      values=(zero value)
      i=0
      set -- \${values[i += 1]:-"a"b}
      printf 'value=%s|i=%s\n' "$1" "$i"
      unset values
      i=0
      set -- \${values[i += 1]:-"a"b}
      printf 'fallback=%s|i=%s\n' "$1" "$i"
      i=0
      set -- \${values[i -= 1]:-"a"b}
      printf 'invalid=%s|i=%s\n' "$1" "$i"
    `);

    expect(result).toMatchObject({
      stdout: "value=value|i=1\nfallback=ab|i=1\ninvalid=ab|i=-1\n",
      stderr: "bash: line 13: values: bad array subscript\n",
      exitCode: 0,
    });
  });

  it("preserves nameref targets for indirection", async () => {
    const result = await new Bash().exec(`
      values=(zero one)
      one=wrong
      declare -n ref='values[i += 1]'
      i=0
      printf '<%s>|i=%s\n' "\${!ref}" "$i"
    `);

    expect(result).toMatchObject({
      stdout: "<values[i += 1]>|i=0\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("resolves indexed nameref defaults through a fresh assignment target", async () => {
    const result = await new Bash().exec(`
      values=(zero)
      declare -n element='values[i += 1]'
      i=0
      result=\${element:=assigned}
      printf 'result=%s|i=%s|one=%s|two=%s\n' "$result" "$i" "\${values[1]-unset}" "\${values[2]-unset}"
    `);

    expect(result).toMatchObject({
      stdout: "result=assigned|i=2|one=unset|two=assigned\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves quoted mixed assign-default fields", async () => {
    const result = await new Bash().exec(`
      IFS=_
      unset value
      set -- \${value:="a_b"c_d}
      printf '<%s>|<%s>|value=%s\n' "$1" "$2" "$value"
    `);

    expect(result).toMatchObject({
      stdout: "<a_bc>|<d>|value=a_bc_d\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves dynamic quoted operation words in prefixed expansions", async () => {
    const result = await new Bash().exec(`
      IFS=_
      HOME=/home_user
      unset missing
      set -- x\${missing:-"$HOME"/bin}
      printf 'default=<%s>\n' "$1"
      value=set
      set -- x\${value:+"$HOME"y}
      printf 'alternative=<%s>\n' "$1"
    `);

    expect(result).toMatchObject({
      stdout: "default=<x/home_user/bin>\nalternative=<x/home_usery>\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("does not re-evaluate mixed operations in prefixed expansions", async () => {
    const result = await new Bash().exec(`
      values=(zero value)
      i=0
      set -- prefix\${values[i += 1]:-"a"b}
      printf 'read=<%s>|i=%s\n' "$1" "$i"
      values=(zero)
      declare -n element='values[i += 1]'
      i=0
      set -- prefix\${element:="a"b}
      printf 'assign=<%s>|i=%s|two=%s\n' "$1" "$i" "\${values[2]-unset}"
    `);

    expect(result).toMatchObject({
      stdout: "read=<prefixvalue>|i=1\nassign=<prefixab>|i=2|two=ab\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves associative nameref subscripts", async () => {
    const result = await new Bash().exec(`
      declare -A values=([key]=value)
      declare -n reference=values
      set -- \${reference[key]:-fallback}
      printf '%s\n' "$1"
    `);

    expect(result).toMatchObject({
      stdout: "value\n",
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
