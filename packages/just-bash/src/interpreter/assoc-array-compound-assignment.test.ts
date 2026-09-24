import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("associative array compound assignments", () => {
  it("preserves whitespace in values declared with -A", async () => {
    const result = await new Bash().exec(`
      declare -A values=([first]="a b c" [second]='x y')
      printf '<%s> <%s> count=%s\\n' "\${values[first]}" "\${values[second]}" "\${#values[@]}"
    `);

    expect(result).toMatchObject({
      stdout: "<a b c> <x y> count=2\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves empty values, quotes, and backslashes", async () => {
    const result = await new Bash().exec(`
      declare -A values=([empty]="" [quote]='a "b" c' [slash]='a\\b c')
      printf '<%s> <%s> <%s>\\n' "\${values[empty]}" "\${values[quote]}" "\${values[slash]}"
    `);

    expect(result).toMatchObject({
      stdout: '<> <a "b" c> <a\\b c>\n',
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves whitespace introduced by parameter expansion", async () => {
    const result = await new Bash().exec(`
      phrase="expanded value"
      declare -A values=([key]="$phrase")
      printf '<%s>\\n' "\${values[key]}"
    `);

    expect(result).toMatchObject({
      stdout: "<expanded value>\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves complete values in declaration append assignments", async () => {
    const result = await new Bash().exec(`
      declare -A values=([old]="old value")
      declare values+=([new]="two words" [quote]='a "b" c' [slash]='a\\b c' [empty]="")
      printf 'old=<%s> new=<%s> quote=<%s> slash=<%s> empty=<%s> count=%s\\n' \
        "\${values[old]}" "\${values[new]}" "\${values[quote]}" \
        "\${values[slash]}" "\${values[empty]}" "\${#values[@]}"
    `);

    expect(result).toMatchObject({
      stdout:
        'old=<old value> new=<two words> quote=<a "b" c> slash=<a\\b c> empty=<> count=5\n',
      stderr: "",
      exitCode: 0,
    });
  });
});
