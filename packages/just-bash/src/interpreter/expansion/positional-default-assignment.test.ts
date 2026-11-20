import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("default assignment to positional and special parameters", () => {
  it("rejects mixed-quote positional defaults before evaluating them", async () => {
    const bash = new Bash();
    const result = await bash.exec(`set --
echo \${1:=$(echo evaluated >&2)"fallback"}
echo reached`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: $1: cannot assign in this way\n");
    expect(result.exitCode).toBe(1);
  });

  it.each([
    "1",
    "12",
    "@",
    "*",
  ])("rejects assignment to %s before evaluating the default", async (parameter) => {
    const bash = new Bash();
    const result = await bash.exec(`set -eu
set --
printf '<%s>\\n' "\${${parameter}:=$(echo evaluated >&2; echo fallback)}"
echo reached`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: $${parameter}: cannot assign in this way\n`,
    );
    expect(result.exitCode).toBe(1);
  });

  it.each([
    "=",
    ":=",
  ])("rejects an unset positional parameter with %s and an empty default", async (operator) => {
    const bash = new Bash();
    const result = await bash.exec(`set -e; set --; echo "\${1${operator}}"`);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: $1: cannot assign in this way\n");
    expect(result.exitCode).toBe(1);
  });

  it("rejects array-valued defaults through the whole-word quoted path", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'set -eu; set --; defaults=(one two); printf "<%s>\\n" "${1:=${defaults[@]}}"; echo reached',
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("bash: $1: cannot assign in this way\n");
    expect(result.exitCode).toBe(1);
  });

  it("preserves a positional parameter when no assignment is needed", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      'set -u; set -- value ""; printf "<%s>\\n" "${1:=ignored}" "${2=ignored}" "${1}" "${2}"',
    );
    expect(result.stdout).toBe("<value>\n<>\n<value>\n<>\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
