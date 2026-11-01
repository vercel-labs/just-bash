// Automa modifications: N00b regressions migrated from just-bash-shell-flags.test.mjs.
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

const create = () =>
  new Bash({
    cwd: "/work",
    files: {
      "/work/f": "one\ntwo\n",
      "/work/d/nested": "two\n",
      "/work/--color=never": "two\n",
    },
  });

describe("Automa shell flag compatibility", () => {
  it("defaults paste to stdin", async () => {
    expect(
      await create().exec("printf 'a\\nb\\nc\\n' | paste -sd+"),
    ).toMatchObject({ stdout: "a+b+c\n", stderr: "", exitCode: 0 });
  });
  it.each([
    "--color",
    "--colour",
    "--color=always",
    "--colour=auto",
    "--color=never",
  ])("accepts plain-text %s", async (flag) => {
    expect(await create().exec(`grep ${flag} two f`)).toMatchObject({
      stdout: "two\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("preserves option boundaries and recursive dot prefixes", async () => {
    const shell = create();
    expect(await shell.exec("grep -n -- two --color=never")).toMatchObject({
      stdout: "1:two\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await shell.exec("grep -rn --exclude-dir=d two .")).toMatchObject({
      stdout: "./--color=never:1:two\n./f:2:two\n",
      stderr: "",
      exitCode: 0,
    });
    expect((await shell.exec("grep --color=invalid two f")).exitCode).not.toBe(
      0,
    );
  });
  it("implements GNU BRE escaped repetition without changing fixed or ERE mode", async () => {
    const shell = create();
    for (const [flags, pattern, expected] of [
      ["", "a\\+", "aa\na+\n"],
      ["", "\\+", "+\na+\n"],
      ["-F", "a\\+", ""],
      ["-E", "a+", "aa\na+\n"],
    ]) {
      const result = await shell.exec(
        `printf 'aa\\n+\\na+\\n' | grep ${flags} '${pattern}'`,
      );
      expect(result.stdout).toBe(expected);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(expected ? 0 : 1);
    }
  });
  it("reports missing ls operands with GNU diagnostics", async () => {
    expect(await create().exec("ls absent")).toMatchObject({
      stdout: "",
      stderr: "ls: cannot access 'absent': No such file or directory\n",
      exitCode: 2,
    });
  });
  it.each([
    ["-i.bak", "f.bak"],
    ["--in-place=.old", "f.old"],
    ["-i'.bak*'", ".bakf"],
  ])("writes byte-preserving sed backup %s", async (flag, backup) => {
    const shell = create();
    const bytes = new Uint8Array([0, 255, 128, 120, 10]);
    await shell.fs.writeFile("/work/f", bytes);
    expect(await shell.exec(`sed ${flag} 's/x/Z/' f`)).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await shell.fs.readFileBuffer(`/work/${backup}`)).toEqual(bytes);
  });
  it("replaces backup symlinks and does not overwrite input after a failed backup", async () => {
    const shell = create();
    await shell.fs.symlink("/work/d/nested", "/work/f.bak");
    expect((await shell.exec("sed -i.bak 's/one/ONE/' f")).exitCode).toBe(0);
    expect(await shell.fs.readFile("/work/d/nested")).toBe("two\n");
    expect((await shell.fs.lstat("/work/f.bak")).isSymbolicLink).toBe(false);
    const write = shell.fs.writeFile.bind(shell.fs);
    shell.fs.writeFile = async (path, ...args) => {
      if (path.endsWith(".bad")) throw new Error("EACCES: backup denied");
      return write(path, ...args);
    };
    expect(
      (await shell.exec("sed -i.bad 's/ONE/changed/' f")).exitCode,
    ).not.toBe(0);
    expect(await shell.fs.readFile("/work/f")).toBe("ONE\ntwo\n");
  });
});
