import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("local -A and readonly -A", () => {
  it("keeps string keys apart in a map declared with local -A", async () => {
    const result = await new Bash().exec(`
      f() {
        local -A M
        M[alpha]=one
        M[beta]=two
        echo "attr=\${M@a} alpha=[\${M[alpha]}] beta=[\${M[beta]}] count=\${#M[@]}"
      }
      f
      echo "after=[\${M@a}] count=\${#M[@]}"
    `);

    expect(result).toMatchObject({
      stdout: "attr=A alpha=[one] beta=[two] count=2\nafter=[] count=0\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("assigns keyed and bare compound values with local -A", async () => {
    const result = await new Bash().exec(`
      f() {
        local -A K=([k]="a b c" [j]=x)
        local -A P=(k1 v1 k2)
        printf '<%s> <%s> %s\\n' "\${K[k]}" "\${K[j]}" "\${#K[@]}"
        printf '<%s> <%s> %s\\n' "\${P[k1]}" "\${P[k2]}" "\${#P[@]}"
      }
      f
    `);

    expect(result).toMatchObject({
      stdout: "<a b c> <x> 2\n<v1> <> 2\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("supports index, append and scalar forms with local -A", async () => {
    const result = await new Bash().exec(`
      f() {
        k=dyn
        local -A W[key]=val W[$k]=x
        local -A W+=([more]="two words")
        local -A S=hello
        printf '<%s> <%s> <%s> %s\\n' "\${W[key]}" "\${W[dyn]}" "\${W[more]}" "\${#W[@]}"
        echo "S=\${S@a} <\${S[0]}>"
      }
      f
    `);

    expect(result).toMatchObject({
      stdout: "<val> <x> <two words> 3\nS=A <hello>\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("restores the outer variable after the function returns", async () => {
    const result = await new Bash().exec(`
      S=outer
      I=(1 2)
      declare -A G=([a]=1)
      f() {
        local -A S I G
        S[x]=1; I[y]=2; G[b]=3
        echo "in: \${S@a} \${I@a} \${G@a} \${#G[@]}"
      }
      f
      echo "out: S=\${S} I=\${I@a}:\${I[*]} G=\${G@a}:\${G[a]}:\${#G[@]}"
    `);

    expect(result).toMatchObject({
      stdout: "in: A A A 1\nout: S=outer I=a:1 2 G=A:1:1\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("keeps elements when local -A repeats for an associative local", async () => {
    const result = await new Bash().exec(`
      f() {
        local -A M=([a]=1)
        local -A M
        local -A M[b]=2
        printf '<%s> <%s> %s\\n' "\${M[a]}" "\${M[b]}" "\${#M[@]}"
      }
      f
    `);

    expect(result).toMatchObject({
      stdout: "<1> <2> 2\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("refuses to turn an indexed local into an associative array", async () => {
    const result = await new Bash().exec(`
      f() {
        local -a I=(1 2)
        local -A I
        echo "status=$? attr=\${I@a} values=\${I[*]}"
      }
      f
    `);

    expect(result).toMatchObject({
      stdout: "status=1 attr=a values=1 2\n",
      stderr: "bash: local: I: cannot convert indexed to associative array\n",
      exitCode: 0,
    });
  });

  it("creates an associative array with readonly -A", async () => {
    const result = await new Bash().exec(`
      readonly -A X=([k]="a b c" [j]=x)
      readonly -A P=(k1 v1)
      printf '%s <%s> <%s> %s\\n' "\${X@a}" "\${X[k]}" "\${X[j]}" "\${#X[@]}"
      printf '%s <%s> %s\\n' "\${P@a}" "\${P[k1]}" "\${#P[@]}"
      ( X[z]=1 )
      echo "write=$? count=\${#X[@]}"
    `);

    expect(result).toMatchObject({
      stdout: "Ar <a b c> <x> 2\nAr <v1> 1\nwrite=1 count=2\n",
      stderr: "bash: X: readonly variable\n",
      exitCode: 0,
    });
  });

  it("refuses readonly -A on an indexed array", async () => {
    const result = await new Bash().exec(`
      I=(1 2)
      readonly -A I=([k]=v)
      echo "status=$? attr=\${I@a} values=\${I[*]}"
      E=()
      readonly -A E=([k]=v)
      echo "status=$? attr=\${E@a} count=\${#E[@]}"
    `);

    expect(result).toMatchObject({
      stdout: "status=1 attr=a values=1 2\nstatus=1 attr=a count=0\n",
      stderr:
        "bash: I: cannot convert indexed to associative array\nbash: E: cannot convert indexed to associative array\n",
      exitCode: 0,
    });
  });

  it("keeps brackets inside bare keys and values", async () => {
    const result = await new Bash().exec(`
      f() {
        local -A M=(k '[v]' digit [0-9] "a[b" x)
        key='a[b'
        printf '<%s> <%s> <%s> %s\\n' "\${M[k]}" "\${M[digit]}" "\${M[$key]}" "\${#M[@]}"
      }
      f
      readonly -A R=(k "a[0]")
      printf '%s <%s> %s\\n' "\${R@a}" "\${R[k]}" "\${#R[@]}"
    `);

    expect(result).toMatchObject({
      stdout: "<[v]> <[0-9]> <x> 3\nAr <a[0]> 1\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
