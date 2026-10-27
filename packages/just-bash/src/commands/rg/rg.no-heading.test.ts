import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("rg --no-heading", () => {
  it.each([
    "--no-heading",
    "--heading --no-heading",
  ])("prints filename prefixes with %s", async (flags) => {
    const bash = new Bash({
      cwd: "/work",
      files: { "/work/a": "match\n", "/work/b": "match\n" },
    });
    const result = await bash.exec(`rg -n ${flags} match a b`);
    expect(result).toMatchObject({
      stdout: "a:1:match\nb:1:match\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("lets a later --heading restore headings", async () => {
    const bash = new Bash({
      cwd: "/work",
      files: { "/work/a": "match\n", "/work/b": "match\n" },
    });
    const result = await bash.exec("rg -n --no-heading --heading match a b");
    expect(result).toMatchObject({
      stdout: "a\n1:match\n\nb\n1:match\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
