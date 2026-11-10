import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("executable scripts", () => {
  it.each([
    "constructor",
    "__proto__",
    "prototype",
    "hasOwnProperty",
    "toString",
    "valueOf",
  ])("inherits exported %s safely", async (name) => {
    const prototype = Object.getOwnPropertyDescriptors(Object.prototype);
    const env = new Bash({
      files: {
        "/probe.sh": {
          content: `printf '%s\\n' "$${name}"\n`,
          mode: 0o755,
        },
      },
    });
    expect(await env.exec(`export ${name}=value; /probe.sh`)).toMatchObject({
      stdout: "value\n",
      stderr: "",
      exitCode: 0,
    });
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(
      prototype,
    );
  });

  it.each([
    ["JB_LOCAL=local; export JB_EXPORTED=exported;", "[] [exported]\n"],
    ["JB_LOCAL=local; JB_EXPORTED=temporary", "[] [temporary]\n"],
    ["export JB_LOCAL=local; export -n JB_LOCAL;", "[] []\n"],
  ])("inherits only exported variables: %s", async (prefix, stdout) => {
    const env = new Bash({
      files: {
        "/probe.sh": {
          content: 'printf "[%s] [%s]\\n" "$JB_LOCAL" "$JB_EXPORTED"\n',
          mode: 0o755,
        },
      },
    });
    expect(await env.exec(`${prefix} /probe.sh`)).toMatchObject({
      stdout,
      stderr: "",
      exitCode: 0,
    });
  });

  it("initializes shell variables without copying unexported parent values", async () => {
    const env = new Bash({
      files: {
        "/probe.sh": {
          content:
            'saved=$IFS; IFS=:; IFS=$saved; value="a b"; set -- $value; echo "$# $OPTIND $HOSTNAME"\n',
          mode: 0o755,
        },
      },
    });
    expect(
      await env.exec("IFS=:; OPTIND=7; HOSTNAME=parent; /probe.sh"),
    ).toMatchObject({
      stdout: "2 1 localhost\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it.each([
    2, 1,
  ])("continues a semicolon list after a script exits %i", async (exitCode) => {
    const env = new Bash({
      files: {
        "/scripts/fail.sh": `exit ${exitCode}\n`,
      },
    });
    await env.exec("chmod +x /scripts/fail.sh");

    const result = await env.exec("/scripts/fail.sh ; echo $?");

    expect(result).toMatchObject({
      stdout: `${exitCode}\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  it("does not continue an AND list after a script fails", async () => {
    const env = new Bash({
      files: {
        "/scripts/fail.sh": "exit 2\n",
      },
    });
    await env.exec("chmod +x /scripts/fail.sh");

    const result = await env.exec("/scripts/fail.sh && echo $?");

    expect(result).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 2,
    });
  });
});
