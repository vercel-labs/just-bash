import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("assignment tilde provenance", () => {
  it("expands only syntactically eligible unquoted tildes", async () => {
    const result = await new Bash({ env: { HOME: "/home/test" } }).exec(`
      quoted='~'
      generated='~'
      direct=~
      path=before:~/bin
      export exportedQuoted='~' exportedGenerated=$generated exportedPath=before:~/bin
      declare declaredQuoted='~' declaredGenerated=$generated declaredPath=before:~/bin
      f() {
        local localQuoted='~' localGenerated=$generated localPath=before:~/bin
        printf '%s|%s|%s\n' "$localQuoted" "$localGenerated" "$localPath"
      }
      f
      printf '%s|%s|%s|%s\n' "$quoted" "$direct" "$path" "$exportedQuoted"
      printf '%s|%s|%s|%s\n' "$exportedGenerated" "$exportedPath" "$declaredQuoted" "$declaredGenerated"
      printf '%s\n' "$declaredPath"
    `);

    expect(result).toMatchObject({
      stdout:
        "~|~|before:/home/test/bin\n" +
        "~|/home/test|before:/home/test/bin|~\n" +
        "~|before:/home/test/bin|~|~\n" +
        "before:/home/test/bin\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves an explicitly empty HOME", async () => {
    const result = await new Bash({ env: { HOME: "" } }).exec(`
      direct=~
      export path=left:~/right
      printf '<%s>|<%s>\n' "$direct" "$path"
    `);

    expect(result).toMatchObject({
      stdout: "<>|<left:/right>\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
