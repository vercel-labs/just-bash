import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("pattern removal expansion order", () => {
  it.each([
    ['"${value#$((i += 1))$((i += 1))}"', "<a>\ni=2\n"],
    ['"${values[@]#$((i += 1))$((i += 1))}"', "<a>\n<b>\ni=2\n"],
    ["${values[@]#$((i += 1))$((i += 1))}", "<a>\n<b>\ni=2\n"],
    ['"pre${values[@]#$((i += 1))$((i += 1))}post"', "<prea>\n<bpost>\ni=2\n"],
  ])("expands pattern parts once in order for %s", async (expression, stdout) => {
    const bash = new Bash();
    const result = await bash.exec(`
i=0
value=12a
values=(12a 12b)
printf '<%s>\\n' ${expression}
printf 'i=%s\\n' "$i"
`);

    expect(result.stdout).toBe(stdout);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
