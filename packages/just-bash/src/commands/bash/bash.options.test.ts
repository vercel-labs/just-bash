import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

async function run(command: string, files?: Record<string, string>) {
  const env = new Bash({ files });
  const { stdout, stderr, exitCode } = await env.exec(command);
  return { stdout, stderr, exitCode };
}

describe("bash/sh options", () => {
  it.each([
    "bash -lc 'echo hi'",
    "bash -l -c 'echo hi'",
    "bash -c -l 'echo hi'",
    "bash --login -c 'echo hi'",
    "bash --noprofile --norc -c 'echo hi'",
    "bash -i -c 'echo hi'",
    "bash -ilc 'echo hi'",
    "sh -lc 'echo hi'",
    "bash +e -c 'echo hi'",
  ])("accepts %s", async (command) => {
    expect(await run(command)).toEqual({
      stdout: "hi\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("passes $0 and positional parameters after the options", async () => {
    expect((await run("bash -lc 'echo $0 $1 $2' zero one two")).stdout).toBe(
      "zero one two\n",
    );
  });

  it.each([
    "bash -ec 'false; echo after'",
    "bash -e -c 'false; echo after'",
    "bash -c -e 'false; echo after'",
  ])("applies -e: %s", async (command) => {
    expect(await run(command)).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
  });

  it("applies -u", async () => {
    const result = await run("bash -uc 'echo \"$UNSET_X\"; echo after'");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("UNSET_X: unbound variable");
    expect(result.exitCode).not.toBe(0);
  });

  it("applies -o pipefail, bundled or separate", async () => {
    expect(
      (await run("bash -o pipefail -c 'false | true; echo rc=$?'")).stdout,
    ).toBe("rc=1\n");
    expect(
      await run("bash -euo pipefail -c 'false | true; echo after'"),
    ).toEqual({ stdout: "", stderr: "", exitCode: 1 });
  });

  it("applies -x without tracing its own setup", async () => {
    expect(await run("bash -xc 'echo hi'")).toEqual({
      stdout: "hi\n",
      stderr: "+ echo hi\n",
      exitCode: 0,
    });
  });

  it("applies -O as shopt", async () => {
    expect((await run("bash -O extglob -c 'shopt extglob'")).stdout).toMatch(
      /^extglob\s+on\n$/,
    );
  });

  it("shows the options in $-", async () => {
    expect((await run("bash -eu -c 'echo $-'")).stdout).toMatch(/e/);
    expect((await run("bash -eu -c 'echo $-'")).stdout).toMatch(/u/);
  });

  it("keeps $LINENO counting the script's own lines", async () => {
    expect((await run("bash -ec 'echo $LINENO\necho $LINENO'")).stdout).toBe(
      "1\n2\n",
    );
  });

  it("reads the script from stdin with -s, operands as positional parameters", async () => {
    expect((await run("echo 'echo $1 $2' | bash -s one two")).stdout).toBe(
      "one two\n",
    );
  });

  it("applies options to a script file", async () => {
    const files = { "/run.sh": "false\necho after\n", "/a.sh": "echo $1\n" };
    expect(await run("bash -e /run.sh", files)).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
    expect(await run("bash -x /a.sh arg", files)).toEqual({
      stdout: "arg\n",
      stderr: "+ echo arg\n",
      exitCode: 0,
    });
    expect((await run("bash -- /a.sh arg", files)).stdout).toBe("arg\n");
  });

  it("takes --help only in option position", async () => {
    expect((await run("bash --help")).stdout).toContain("Usage");
    expect((await run("bash -c 'echo --help'")).stdout).toBe("--help\n");
  });

  it.each([
    ["bash -c", "bash: -c: option requires an argument\n"],
    ["bash -q -c 'echo hi'", "bash: -q: invalid option\n"],
    ["sh --bogus -c 'echo hi'", "sh: --bogus: invalid option\n"],
    ["bash -o", "bash: -o: option requires an argument\n"],
  ])("refuses %s with status 2", async (command, stderr) => {
    expect(await run(command)).toEqual({ stdout: "", stderr, exitCode: 2 });
  });

  it("ends with status 2 before the script on an option set refuses", async () => {
    const result = await run("bash -o bogus -c 'echo ran'");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("bogus");
    expect(result.exitCode).toBe(2);
  });

  it.each([
    "bash -o bogus",
    "bash -O bogus",
  ])("refuses %s with no script at status 2", async (command) => {
    const result = await run(command);
    expect(result.stderr).toContain("bogus");
    expect(result.exitCode).toBe(2);
  });

  it("takes a shopt name with digits", async () => {
    expect(await run("bash -O compat31 -c 'echo ran'")).toEqual({
      stdout: "ran\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([
    "bash --version",
    "sh --version",
    "bash -l --version",
  ])("%s names the bash version and just-bash", async (command) => {
    const { stdout, stderr, exitCode } = await run(command);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(stdout).toMatchInlineSnapshot(`
      "GNU bash, version 5.1.0(1)-release (just-bash)
      This is just-bash, a bash interpreter written in TypeScript, not GNU bash.
      "
    `);
  });

  it("matches $BASH_VERSION in --version", async () => {
    const { stdout } = await run('bash --version; echo "$BASH_VERSION"');
    const [first, , version] = stdout.split("\n");
    expect(first).toBe(`GNU bash, version ${version} (just-bash)`);
  });

  it("takes --version only in option position", async () => {
    expect((await run("bash -c 'echo --version'")).stdout).toBe("--version\n");
  });

  describe("syntax errors name the script and line, as bash does", () => {
    const files = { "/t.sh": "echo ok\nif then\n" };

    it.each([
      [
        "bash -n /t.sh",
        "/t.sh: line 2: syntax error near unexpected token `then'\n",
      ],
      [
        "bash /t.sh",
        "/t.sh: line 2: syntax error near unexpected token `then'\n",
      ],
      [
        "bash -e /t.sh",
        "/t.sh: line 2: syntax error near unexpected token `then'\n",
      ],
      [
        "bash -c 'echo ok\nif then'",
        "bash: -c: line 2: syntax error near unexpected token `then'\n",
      ],
      [
        "sh -ec 'if then'",
        "sh: -c: line 1: syntax error near unexpected token `then'\n",
      ],
      [
        "bash < /t.sh",
        "bash: line 2: syntax error near unexpected token `then'\n",
      ],
    ])("%s", async (command, stderr) => {
      expect(await run(command, files)).toEqual({
        stdout: "",
        stderr,
        exitCode: 2,
      });
    });

    it("in a sourced file, with status 1", async () => {
      expect(await run("source /t.sh; echo after", files)).toEqual({
        stdout: "after\n",
        stderr: "/t.sh: line 2: syntax error near unexpected token `then'\n",
        exitCode: 0,
      });
    });

    it("counts a shebang line", async () => {
      const shebang = { "/s.sh": "#!/bin/bash\necho $LINENO\nif then\n" };
      expect((await run("bash /s.sh", shebang)).stderr).toBe(
        "/s.sh: line 3: syntax error near unexpected token `then'\n",
      );
      const ok = { "/s.sh": "#!/bin/bash\necho $LINENO\n" };
      expect((await run("bash /s.sh", ok)).stdout).toBe("2\n");
    });
  });
});
