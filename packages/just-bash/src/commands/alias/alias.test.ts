import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

// Note: Each exec is a new shell - aliases don't persist across execs
describe("alias command", () => {
  it("keeps alias-shaped environment values as data with explicit expansion", async () => {
    const bash = new Bash({ env: { BASH_ALIAS_echo: "printf injected" } });
    const result = await bash.exec(
      `shopt -s expand_aliases; echo expected; alias; compgen -A alias; type -t echo`,
    );
    expect(result.stdout).toBe("expected\nbuiltin\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.env.BASH_ALIAS_echo).toBe("printf injected");
  });

  it("isolates alias changes in subshells, substitutions, and pipelines", async () => {
    const bash = new Bash();
    const result = await bash.exec(`shopt -s expand_aliases
alias greet='echo parent'
(alias greet='echo subshell'; eval greet)
value=$(alias greet='echo substitution'; eval greet)
echo "$value"
alias greet='echo pipeline' | cat
greet`);
    expect(result.stdout).toBe("subshell\nsubstitution\nparent\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.env.BASH_ALIAS_greet).toBeUndefined();
  });

  it("copies aliases into wrappers but starts nested shells with none", async () => {
    const result = await new Bash().exec(
      "alias greet='echo parent'; env alias greet; bash -c 'alias'",
    );
    expect(result.stdout).toBe("alias greet='echo parent'\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
  it("should list no aliases initially", async () => {
    const env = new Bash();
    const result = await env.exec("alias");
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should set and list an alias within same exec", async () => {
    const env = new Bash();
    const result = await env.exec(
      "alias ll='ls -la'; alias; type -t ll; compgen -A alias",
    );
    expect(result.stdout).toBe("alias ll='ls -la'\nalias\nll\n");
    expect(result.exitCode).toBe(0);
  });

  it("should show a specific alias within same exec", async () => {
    const env = new Bash();
    const result = await env.exec("alias ll='ls -la'; alias ll");
    expect(result.stdout).toBe("alias ll='ls -la'\n");
    expect(result.exitCode).toBe(0);
  });

  it("should error when alias not found", async () => {
    const env = new Bash();
    const result = await env.exec("alias notexists");
    expect(result.stderr).toContain("not found");
    expect(result.exitCode).toBe(1);
  });

  it("should set multiple aliases within same exec", async () => {
    const env = new Bash();
    const result = await env.exec("alias ll='ls -la' la='ls -a'; alias");
    expect(result.stdout).toBe("alias ll='ls -la'\nalias la='ls -a'\n");
  });

  it("should show help with --help", async () => {
    const env = new Bash();
    const result = await env.exec("alias --help");
    expect(result.stdout).toContain("alias");
    expect(result.exitCode).toBe(0);
  });

  it("alias does not persist across exec calls", async () => {
    const env = new Bash();
    await env.exec("alias ll='ls -la'");
    // Each exec is a new shell - alias is not defined
    const result = await env.exec("alias ll");
    expect(result.stderr).toContain("not found");
    expect(result.exitCode).toBe(1);
  });
});

// Non-interactive shells expand aliases only with shopt -s expand_aliases.

describe("unalias command", () => {
  it("should remove an alias within same exec", async () => {
    const env = new Bash();
    const result = await env.exec("alias ll='ls -la'; unalias ll; alias ll");
    expect(result.stderr).toContain("not found");
    expect(result.exitCode).toBe(1);
  });

  it("should error when unaliasing non-existent alias", async () => {
    const env = new Bash();
    const result = await env.exec("unalias notexists");
    expect(result.stderr).toContain("not found");
    expect(result.exitCode).toBe(1);
  });

  it("should remove all aliases with -a", async () => {
    const env = new Bash();
    const result = await env.exec(
      "alias ll='ls -la' la='ls -a'; unalias -a; alias",
    );
    expect(result.stdout).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("should show help with --help", async () => {
    const env = new Bash();
    const result = await env.exec("unalias --help");
    expect(result.stdout).toContain("unalias");
    expect(result.exitCode).toBe(0);
  });
});
