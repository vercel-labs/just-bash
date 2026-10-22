import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

async function run(script: string) {
  return new Bash().exec(script);
}

describe("adjacent double-quoted segments are parsed on their own", () => {
  it.each([
    ['echo "$x""_y"', "AB_y\n"],
    ['echo "a $x""_c"', "a AB_c\n"],
    ['echo "${x}""_y"', "AB_y\n"],
    ['echo "$x""$x"', "ABAB\n"],
    ['echo "$x""_y""$x"', "AB_yAB\n"],
    ['echo "a""$x""b"', "aABb\n"],
    ['echo "$x"""_y', "AB_y\n"],
    ["echo \"$x\"'_y'", "AB_y\n"],
    ["echo '$x'\"_y\"", "$x_y\n"],
    ['echo "${b[0]}""_${b[1]}"', "x_y\n"],
  ])("%s", async (command, stdout) => {
    const result = await run(`x=AB; x_y=Q; b=(x y); ${command}`);
    expect(result).toMatchObject({ stdout, stderr: "", exitCode: 0 });
  });

  it("keeps the text of adjacent segments together as one word", async () => {
    const result = await run(
      `printf '[%s]' "a b""c d"; echo; printf '[%s]' "a b" "c d"; echo; printf '[%s]' "" ""; echo`,
    );
    expect(result.stdout).toBe("[a bc d]\n[a b][c d]\n[][]\n");
  });

  it("expands command and arithmetic substitutions in a segment", async () => {
    const result = await run(
      `printf '[%s]' "$(echo a)""b" "$((1+2))""4"; echo`,
    );
    expect(result.stdout).toBe("[ab][34]\n");
  });

  it("keeps glob characters and escaped quotes literal", async () => {
    const result = await run(
      String.raw`printf '[%s]' "*""?" "a""\"" "a\"""b"; echo`,
    );
    expect(result.stdout).toBe('[*?][a"][a"b]\n');
  });

  it("counts the words made of adjacent segments", async () => {
    const result = await run(
      `f() { echo "$#"; }; y="1 2"; f "a""b" "c"; f "$y""$y"; f $y"$y"`,
    );
    expect(result.stdout).toBe("2\n1\n2\n");
  });

  it("matches adjacent segments in case and [[ ]] patterns", async () => {
    const result = await run(
      `case ab in "a""b") echo m1;; *) echo n1;; esac; case ab in "a""*") echo m2;; *) echo n2;; esac; case 'a*' in "a""*") echo m3;; *) echo n3;; esac; [[ ab == "a""b" ]] && echo m4 || echo n4; [[ abc == "a""*" ]] && echo m5 || echo n5`,
    );
    expect(result.stdout).toBe("m1\nn2\nm3\nm4\nn5\n");
  });

  it.each([
    ['echo $"a""b"', "ab\n"],
    ['echo $"a"b', "ab\n"],
    ["echo $\"a\"'b'", "ab\n"],
    ['echo $"$x""_y"', "AB_y\n"],
    ['echo $"$x"_y', "AB_y\n"],
    ['echo $"a b""c"', "a bc\n"],
  ])("keeps a locale-quoted word together with what follows it: %s", async (command, stdout) => {
    const result = await run(`a=V; x=AB; ${command}`);
    expect(result).toMatchObject({ stdout, stderr: "", exitCode: 0 });
  });

  it("handles empty adjacent segments", async () => {
    const result = await run(
      `x=AB; echo ""$x""; echo """"; echo """a"; echo "a"""; printf '[%s]' "$x""" """$x"; echo`,
    );
    expect(result.stdout).toBe("AB\n\na\na\n[AB][AB]\n");
  });
});
