import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Nested sh/bash must start from the parent's exported environment only,
// like a real child process. Expectations verified against bash 3.2 and 5.3.
describe("nested sh/bash environment", () => {
  describe("per-exec env with replaceEnv", () => {
    const opts = {
      env: { MARKER: "YES", PATH: "/usr/bin:/bin" },
      replaceEnv: true,
    };

    for (const shell of ["sh", "bash", "/bin/sh", "/bin/bash"]) {
      it(`${shell} -c sees per-exec env and not the parent's`, async () => {
        const bash = new Bash({ env: { SECRET: "leak" } });
        const result = await bash.exec(shell, {
          args: ["-c", "echo [$MARKER]; printenv MARKER; printenv SECRET"],
          ...opts,
        });
        expect(result.stdout).toBe("[YES]\nYES\n");
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(1);
      });
    }

    it("script file run by sh sees per-exec env", async () => {
      const bash = new Bash({
        env: { SECRET: "leak" },
        files: { "/script.sh": "echo [$MARKER] [$SECRET]\n" },
      });
      const result = await bash.exec("sh /script.sh", opts);
      expect(result.stdout).toBe("[YES] []\n");
      expect(result.exitCode).toBe(0);
    });

    it("direct commands still see per-exec env only", async () => {
      const bash = new Bash({ env: { SECRET: "leak" } });
      const result = await bash.exec("echo [$MARKER] [$SECRET]", opts);
      expect(result.stdout).toBe("[YES] []\n");
    });
  });

  it("per-exec env without replaceEnv reaches nested shells", async () => {
    const bash = new Bash({ env: { KEEP: "kept" } });
    const result = await bash.exec("sh -c 'echo [$KEEP] [$EXTRA]'", {
      env: { EXTRA: "added" },
    });
    expect(result.stdout).toBe("[kept] [added]\n");
  });

  it("exported variables are inherited", async () => {
    const bash = new Bash();
    const result = await bash.exec("export FOO=bar; sh -c 'echo [$FOO]'");
    expect(result.stdout).toBe("[bar]\n");
  });

  it("prefix assignments are inherited", async () => {
    const bash = new Bash();
    const result = await bash.exec("FOO=pref sh -c 'echo [$FOO]'");
    expect(result.stdout).toBe("[pref]\n");
  });

  it("unexported shell variables are not inherited", async () => {
    const bash = new Bash();
    const result = await bash.exec("FOO=noleak; sh -c 'echo [$FOO]'");
    expect(result.stdout).toBe("[]\n");
  });

  it("an export in one exec does not persist into the next", async () => {
    const bash = new Bash();
    await bash.exec("export FOO=bar");
    const result = await bash.exec("FOO=noleak; sh -c 'echo [$FOO]'");
    expect(result.stdout).toBe("[]\n");
  });

  it("export -n removes a variable from the child", async () => {
    const bash = new Bash();
    const result = await bash.exec("export -n HOME; sh -c 'echo [$HOME]'");
    expect(result.stdout).toBe("[]\n");
  });

  it("positional parameters do not leak into grandchildren", async () => {
    const bash = new Bash();
    const result = await bash.exec(`bash -c 'sh -c "echo [\\$1] [\\$#]"' x a`);
    expect(result.stdout).toBe("[] [0]\n");
  });

  it("IFS and OPTIND are reset rather than imported", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `export IFS=: OPTIND=5; sh -c 'printf "[%s] %s\\n" "$IFS" "$OPTIND"'`,
    );
    expect(result.stdout).toBe("[ \t\n] 1\n");
  });

  it("shell-initialized variables are still set in the child", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "sh -c 'echo $OSTYPE $HOSTNAME; echo $SHELLOPTS; echo $BASHOPTS'",
    );
    expect(result.stdout).toBe(
      "linux-gnu localhost\nbraceexpand:hashall:interactive-comments\nglobskipdots\n",
    );
  });

  it("a child started without PATH gets the default one", async () => {
    const bash = new Bash();
    const result = await bash.exec("unset PATH; sh -c 'echo $PATH'");
    expect(result.stdout).toBe("/usr/bin:/bin\n");
  });

  it("cwd and PWD follow the parent", async () => {
    const bash = new Bash();
    const result = await bash.exec("cd /tmp; sh -c 'pwd; echo $PWD'");
    expect(result.stdout).toBe("/tmp\n/tmp\n");
  });

  describe("variables the new shell initializes itself", () => {
    it("are not exported to the child's children", async () => {
      const bash = new Bash();
      const result = await bash.exec(
        "unset PATH; sh -c 'IFS=:; export -p' | grep -cE ' (PATH|IFS|OPTIND|OSTYPE|HOSTNAME|SHELLOPTS|BASHOPTS)='",
      );
      expect(result.stdout).toBe("0\n");
    });

    it("do not copy unexported values from the parent", async () => {
      const bash = new Bash();
      const result = await bash.exec(
        "OSTYPE=secret HOSTNAME=secret; export -n OSTYPE HOSTNAME; sh -c 'echo $OSTYPE $HOSTNAME'",
      );
      expect(result.stdout).toBe("linux-gnu localhost\n");
    });

    it("take exported values from the environment", async () => {
      const bash = new Bash();
      const result = await bash.exec(
        "export HOSTNAME=mine; sh -c 'echo $HOSTNAME'",
      );
      expect(result.stdout).toBe("mine\n");
    });
  });

  it("env and time do not export the shell's variables", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "FOO=secret; env sh -c 'echo [$FOO]'; time sh -c 'echo [$FOO]' 2>/dev/null",
    );
    expect(result.stdout).toBe("[]\n[]\n");
  });

  it("host replaceEnv keeps the environment free of shell variables", async () => {
    const bash = new Bash();
    const result = await bash.exec("printenv", {
      env: { A: "1" },
      replaceEnv: true,
    });
    expect(result.stdout).toBe("A=1\n");
  });

  it("cd - fails in a child that did not inherit OLDPWD", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "cd /tmp; export -n OLDPWD; sh -c 'cd -'; echo rc=$?",
    );
    expect(result.stdout).toBe("rc=1\n");
    expect(result.stderr).toBe("bash: cd: OLDPWD not set\n");
  });

  it("cd - works in a child that inherited OLDPWD", async () => {
    const bash = new Bash();
    const result = await bash.exec("cd /tmp; sh -c 'cd -'");
    expect(result.stdout).toBe("/home/user\n");
  });
});
