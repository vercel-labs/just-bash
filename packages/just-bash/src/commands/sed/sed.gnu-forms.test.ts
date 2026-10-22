import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("sed GNU forms", () => {
  it("keeps the original contents in an in-place backup", async () => {
    const bash = new Bash({ files: { "/s.txt": "a\nb\n" } });
    const result = await bash.exec("sed -i.bak 's/a/A/' /s.txt");
    expect(result).toMatchObject({ stdout: "", stderr: "", exitCode: 0 });
    expect(await bash.fs.readFile("/s.txt")).toBe("A\nb\n");
    expect(await bash.fs.readFile("/s.txt.bak")).toBe("a\nb\n");

    await bash.fs.symlink("/s.txt", "/link");
    await bash.fs.symlink("/s.txt", "/link.bak");
    expect(await bash.exec("sed -ni.bak 's/A/X/p' /link")).toMatchObject({
      stderr: "",
      exitCode: 0,
    });
    expect(await bash.fs.readFile("/link.bak")).toBe("A\nb\n");
    expect(await bash.fs.readFile("/link")).toBe("X\n");
    expect(await bash.fs.readFile("/s.txt")).toBe("A\nb\n");
    expect((await bash.fs.lstat("/link.bak")).isSymbolicLink).toBe(false);

    await bash.exec("sed -i.old -i 's/X/Y/' /link; sed -i'*' 's/Y/Z/' /link");
    expect(await bash.fs.exists("/link.old")).toBe(false);
    expect(await bash.fs.readFile("/link")).toBe("Z\n");
  });

  it("consumes the backslash before same-line a/i/c text", async () => {
    const result = await new Bash().exec(
      "printf 'one\\ntwo\\n' | sed -e '1a\\added' -e '2i\\inserted' -e '2c\\changed'",
    );
    expect(result).toMatchObject({
      stdout: "one\nadded\ninserted\nchanged\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("applies case conversion to literals, matches and backreferences", async () => {
    const result = await new Bash().exec(
      String.raw`echo 'hello hello' | sed 's/\(hello\)/\U&-\1\Etail/g'; echo x | sed 's/x/\\Ufoo/'`,
    );
    expect(result).toMatchObject({
      stdout: "HELLO-HELLOtail HELLO-HELLOtail\n\\Ufoo\n",
      stderr: "",
      exitCode: 0,
    });
  });
});
