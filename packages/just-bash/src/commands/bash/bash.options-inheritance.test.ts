import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("nested shell option inheritance", () => {
  it("hides wrapper dispatch while preserving tracing in custom scripts", async () => {
    const bash = new Bash({
      customCommands: [
        {
          name: "script",
          execute: async (_args, ctx) => {
            if (!ctx.exec) throw new Error("exec required");
            return ctx.exec('echo "$-"', { cwd: ctx.cwd });
          },
        },
      ],
    });
    const wrapped = await bash.exec("set -x; env echo hi");
    expect(wrapped.stderr).toBe("+ env echo hi\n");
    expect(wrapped.stdout).toBe("hi\n");
    const verbose = await bash.exec("set -v\nenv echo hi");
    expect(verbose.stderr).toBe("env echo hi\n");
    const custom = await bash.exec("set -x; env script");
    expect(custom.stdout).toContain("x");
    expect(custom.stderr).toContain("+ echo ");
  });

  it("enables alias expansion when importing POSIX mode", async () => {
    const bash = new Bash({
      files: { "/script.sh": '#!/bin/bash\nalias greet="echo hello"\ngreet\n' },
    });
    const result =
      await bash.exec(`chmod +x /script.sh; set -o posix; export SHELLOPTS; /script.sh; bash -c 'alias greet="echo hello"
greet'`);
    expect(result.stdout).toBe("hello\nhello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
  it("does not carry shopt changes into later host executions", async () => {
    const bash = new Bash();
    await bash.exec("shopt -s nullglob");
    const result = await bash.exec(
      'printf "<%s>\\n" missing-*; echo "$BASHOPTS"',
    );
    expect(result.stdout).toBe("<missing-*>\nglobskipdots\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
  it("keeps environment alias-shaped values as data", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'bash -c \'echo expected; printf "%s\\n" "$BASH_ALIAS_echo"\'',
      {
        env: { BASHOPTS: "expand_aliases", BASH_ALIAS_echo: "printf injected" },
        replaceEnv: true,
      },
    );
    expect(result.stdout).toBe("expected\nprintf injected\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("uses child shopt options in direct recursive wrappers", async () => {
    const result = await new Bash().exec(
      `bash -c 'shopt -s xpg_echo; echo "\\t"; env echo "\\t"'`,
    );
    expect(result.stdout).toBe("\t\n\t\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("copies active caller options without connecting the child to root state", async () => {
    const bash = new Bash({
      customCommands: [
        {
          name: "wrapper",
          execute: async (_args, ctx) => {
            if (!ctx.exec) throw new Error("wrapper requires recursive exec");
            return ctx.exec("false | true; echo $?; shopt -s nullglob", {
              cwd: ctx.cwd,
            });
          },
        },
      ],
    });
    const result = await bash.exec(
      `set -o pipefail; export SHELLOPTS; bash -c 'wrapper'; printf "<%s>\\n" missing-*`,
    );
    expect(result.stdout).toBe("1\n<missing-*>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
  it("sh enables exported pipefail", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `set -o pipefail; export SHELLOPTS; sh -c 'false | true; echo $?'`,
    );
    expect(result.stdout).toBe("1\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("applies options across multiple generations and recursive wrappers", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `set -o pipefail; export SHELLOPTS; env bash -c 'command time bash -c "false | true; echo \\$?" 2>/dev/null'`,
    );
    expect(result.stdout).toBe("1\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("enables nounset before executing the child script", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `set -u; export SHELLOPTS; bash -c 'echo "$MISSING"'`,
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: MISSING: unbound variable\n");
    expect(result.exitCode).toBe(1);
  });

  it("enables exported nullglob and reports the effective options", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `shopt -s nullglob; export BASHOPTS; bash -c 'printf "<%s>\\n" missing-*; echo "$BASHOPTS"'`,
    );
    expect(result.stdout).toBe("<>\nglobskipdots:nullglob\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not inherit unexported shell options", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `set -o pipefail; bash -c 'false | true; echo $?'`,
    );
    expect(result.stdout).toBe("0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("keeps child option changes out of its parent and sibling shells", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `shopt -s nullglob; export BASHOPTS; bash -c 'shopt -u nullglob; printf "<%s>\\n" missing-*'; printf "<%s>\\n" missing-*; bash -c 'printf "<%s>\\n" missing-*'`,
    );
    expect(result.stdout).toBe("<missing-*>\n<>\n<>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("rebuilds option variables after importing host-provided child environments", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      `bash -c 'false | true; echo $?; printf "<%s>\\n" missing-*; echo "$SHELLOPTS"; echo "$BASHOPTS"'`,
      {
        env: { SHELLOPTS: "pipefail:noglob", BASHOPTS: "nullglob" },
        replaceEnv: true,
      },
    );
    expect(result.stdout).toBe(
      "1\n<missing-*>\nbraceexpand:hashall:interactive-comments:noglob:pipefail\nglobskipdots:nullglob\n",
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not import option strings into the host execution", async () => {
    const bash = new Bash();
    const result = await bash.exec("false | true; echo $?", {
      env: { SHELLOPTS: "pipefail" },
      replaceEnv: true,
    });
    expect(result.stdout).toBe("0\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not treat prototype property names as option state", async () => {
    const before = Object.getOwnPropertyDescriptors(Object.prototype);
    const bash = new Bash();
    const result = await bash.exec(
      `bash -c 'printf "<%s>\\n" missing-*; echo "$BASHOPTS"'`,
      {
        env: {
          BASHOPTS:
            "__proto__:constructor:prototype:hasOwnProperty:toString:valueOf:nullglob",
        },
        replaceEnv: true,
      },
    );
    expect(result.stdout).toBe("<>\nglobskipdots:nullglob\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    for (const name of Object.keys(before)) {
      expect(
        Object.getOwnPropertyDescriptor(Object.prototype, name),
      ).toStrictEqual(before[name]);
    }
  });
});
