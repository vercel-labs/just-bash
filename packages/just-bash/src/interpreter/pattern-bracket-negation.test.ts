import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

async function run(script: string) {
  return new Bash().exec(script);
}

describe("bracket negation in case and [[ == ]] patterns", () => {
  it("negates a bracket expression written with !", async () => {
    const result = await run("case x in [!_a]) echo neg;; *) echo none;; esac");

    expect(result.stdout).toBe("neg\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not match a character listed after !", async () => {
    const result = await run("case a in [!_a]) echo neg;; *) echo none;; esac");

    expect(result.stdout).toBe("none\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("negates a bracket expression inside [[ == ]]", async () => {
    const result = await run(
      "[[ b == [!a] ]] && echo match; [[ a == [!a] ]] || echo nomatch",
    );

    expect(result.stdout).toBe("match\nnomatch\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats a ] right after [! as a literal member of the set", async () => {
    const result = await run(
      "case a in [!]]) echo a-matches;; esac; case ']' in [!]]) echo bad;; *) echo bracket-excluded;; esac",
    );

    expect(result.stdout).toBe("a-matches\nbracket-excluded\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("treats a ] right after [ as a literal member of the set", async () => {
    const result = await run("case ']' in []a]) echo in;; *) echo out;; esac");

    expect(result.stdout).toBe("in\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("negates a set that contains a POSIX class", async () => {
    const result = await run(
      "case 5 in [![:alpha:]]) echo not-alpha;; esac; case Q in [[:upper:]]) echo upper;; esac",
    );

    expect(result.stdout).toBe("not-alpha\nupper\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("matches the autoconf variable-name check", async () => {
    const result = await run(
      "for v in CPPFLAGS 'bad-name'; do case $v in '' | [0-9]* | *[!_a-zA-Z0-9]*) echo \"invalid:$v\";; *) echo \"ok:$v\";; esac; done",
    );

    expect(result.stdout).toBe("ok:CPPFLAGS\ninvalid:bad-name\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
