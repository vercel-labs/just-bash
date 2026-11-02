import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("shell metadata and small builtins", () => {
  it.each([
    undefined,
    "x86_64",
    "aarch64",
  ])("uses injected architecture %s", async (arch) => {
    const bash = new Bash({ environmentInfo: { arch } });
    const result = await bash.exec(
      'printf "%s\\n" "$BASH_VERSION" "${BASH_VERSINFO[5]}"',
    );
    expect(result.stdout).toBe(
      `5.2.37(1)-release\n${arch ?? "x86_64"}-pc-linux-gnu\n`,
    );
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("does not accept inherited version values as the build metadata", async () => {
    const bash = new Bash({
      env: { BASH_VERSION: "old", BASH_VERSINFO: "old" },
    });
    const result = await bash.exec('echo "$BASH_VERSION:$BASH_VERSINFO"');
    expect(result.stdout).toBe("5.2.37(1)-release:5\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it.each([
    'echo "$MISSING"',
    'f() { echo inner; echo "$MISSING"; }; f',
    "eval 'echo \"$MISSING\"'",
    ". /missing.sh",
    'for n in 1 2; do { echo "$MISSING"; }; done',
  ])("nounset aborts its shell: %s", async (command) => {
    const bash = new Bash({
      files: { "/missing.sh": 'echo "$MISSING"; echo false-success\n' },
    });
    const result = await bash.exec(
      `set -u; echo before; ${command}; echo false-success`,
    );
    expect(result.stdout).toBe(
      command.startsWith("f()") ? "before\ninner\n" : "before\n",
    );
    expect(result.stderr).toBe("bash: MISSING: unbound variable\n");
    expect(result.exitCode).toBe(127);
  });

  it("cleans caller frames on return and isolates function subshells", async () => {
    const bash = new Bash({
      files: { "/f.sh": "f() { caller; return; }; f\n" },
    });
    const result = await bash.exec(
      '. /f.sh; f() { (caller); }; f; caller; echo "status:$?"',
    );
    expect(result.stdout).toBe("1 /f.sh\n1 NULL\nstatus:1\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("reports virtual CPU counters and explains the fixed values", async () => {
    const bash = new Bash();
    const result = await bash.exec("times");
    expect(result.stdout).toBe("0m0.000s 0m0.000s\n0m0.000s 0m0.000s\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const help = await bash.exec("help times");
    expect(help.stdout).toContain(
      "These fixed values are not actual CPU measurements.",
    );
    expect(help.stderr).toBe("");
    expect(help.exitCode).toBe(0);
  });

  it.each([
    "caller -z",
    "caller invalid",
    "times -z",
  ])("rejects invalid arguments: %s", async (command) => {
    const result = await new Bash().exec(command);
    const [builtin, value] = command.split(" ");
    const reason = value === "invalid" ? "invalid number" : "invalid option";
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ${builtin}: ${value}: ${reason}\n${builtin}: usage: ${builtin}${builtin === "caller" ? " [expr]" : ""}\n`,
    );
    expect(result.exitCode).toBe(2);
  });
});
