import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("array expansion inside a default or alternative word", () => {
  it("joins the prefix to the first element and the suffix to the last", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `arr=(x y)
printf '<%s>' "\${U:-pre\${arr[@]}post}"; echo
printf '<%s>' "\${U:-pre\${arr[@]}}"; echo
printf '<%s>' "\${U:-\${arr[@]}post}"; echo
printf '<%s>' "\${U:-\${arr[@]}}"; echo`,
    );
    expect(result.stdout).toBe(
      "<prex><ypost>\n<prex><y>\n<x><ypost>\n<x><y>\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("applies the literals to an alternative word and under nounset", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `set -u
S=set
arr=(x y)
printf '<%s>' "\${S:+pre\${arr[@]}post}"; echo
printf '<%s>' "\${U:+pre\${arr[@]}post}"; echo
printf '<%s>' "\${U-pre\${arr[@]}post}"; echo`,
    );
    expect(result.stdout).toBe("<prex><ypost>\n<>\n<prex><ypost>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps array-at defaults as separate words after an empty array-star parameter", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `IFS=:
e=()
a=(m n)
arr=(x y)
printf '<%s>' "\${e[*]:-pre\${arr[@]}post}"; echo
printf '<%s>' "\${a[*]:+\${arr[@]}}"; echo
printf '<%s>' "\${U:-pre\${arr[*]}post}"; echo`,
    );
    expect(result.stdout).toBe("<prex><ypost>\n<x><y>\n<prex:ypost>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("returns only the literals for an empty or unset array", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `empty=()
set -- "\${U:-pre\${empty[@]}post}"; echo "$# <$1>"
set -- "\${U:-pre\${missing[*]}}"; echo "$# <$1>"
set -- "\${U:-\${empty[*]}}"; echo "$# <$1>"`,
    );
    expect(result.stdout).toBe("1 <prepost>\n1 <pre>\n1 <>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("leaves a tilde in the default word literal", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `HOME=/home/test
arr=(x y)
printf '<%s>' "\${U:-~/\${arr[@]}}"; echo`,
    );
    expect(result.stdout).toBe("<~/x><y>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
