import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("escaped words", () => {
  it("treats an escaped ordinary regex character literally", async () => {
    const result = await new Bash().exec("[[ q =~ \\q ]]");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats an escaped ordinary character in a regex bracket expression literally", async () => {
    const result = await new Bash().exec("[[ q =~ [\\q] ]]");

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves escaped alias arguments while re-parsing", async () => {
    const result = await new Bash().exec(`
      shopt -s expand_aliases
      alias a='echo'
      a \\time
    `);

    expect(result.stdout).toBe("time\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves escaped words in function descriptions", async () => {
    const result = await new Bash().exec(`
      function f { echo \\time; }
      type f
    `);

    expect(result.stdout).toBe(
      "f is a function\nf () \n{ \n    echo \\time\n}\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("quote-removes escaped array subscripts", async () => {
    const result = await new Bash().exec(
      'q=1; a[\\q]=x; printf "%s:%s" "${a[\\q]}" "${a[q]}"',
    );

    expect(result.stdout).toBe("x:x");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps quoted array subscript escapes distinct", async () => {
    const result = await new Bash().exec(
      "q=1; a['\\q']=x; printf '<%s>' \"${a[q]}\"",
    );

    expect(result.stdout).toBe("<>");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps escaped parameter markers literal in array subscripts", async () => {
    const result = await new Bash().exec(
      "declare -A a; x=key; a[\\$x]=literal; declare -p a",
    );

    expect(result.stdout).toBe("declare -A a=(['$x']=literal)\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps escaped quotes inside double-quoted array subscripts", async () => {
    const result = await new Bash().exec(
      'declare -A a; a["a\\"b\\q"]=ok; declare -p a',
    );

    expect(result.stdout).toBe("declare -A a=(['a\"b\\q']=ok)\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not over-escape literals in function descriptions", async () => {
    const result = await new Bash().exec(
      "function f { echo foo#bar mid!word pre~post; }; type f",
    );

    expect(result.stdout).toBe(
      "f is a function\nf () \n{ \n    echo foo#bar mid!word pre~post\n}\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("preserves escaped IFS delimiters in compgen wordlists", async () => {
    const result = await new Bash().exec(
      "IFS=':%'; compgen -W 'spam:eggs%ham cheese\\:colon'",
    );

    expect(result.stdout).toBe("spam\neggs\nham cheese:colon\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps escaped glob syntax literal after word splitting", async () => {
    const result = await new Bash().exec(
      "touch y-match; value='x y'; printf '<%s>\\n' $value\\*",
    );

    expect(result.stdout).toBe("<x>\n<y*>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not failglob escaped syntax after word splitting", async () => {
    const result = await new Bash().exec(
      "shopt -s failglob; value='x y'; printf '<%s>\\n' $value\\*",
    );

    expect(result.stdout).toBe("<x>\n<y*>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("globs backslashes produced by parameter expansion", async () => {
    const result = await new Bash().exec(
      "touch 'a*b'; value='a\\*b'; printf '<%s>\\n' $value",
    );

    expect(result.stdout).toBe("<a*b>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
