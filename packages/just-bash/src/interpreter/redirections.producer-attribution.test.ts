import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("compound write-error attribution", () => {
  // Bash 5 reports these failures at the leaf producer. macOS Bash 3.2 can
  // flush buffered output after restoring fd 1, so recorded fixtures differ.
  it.each([
    ["{ echo o; } 1<<<foo", "echo"],
    ["{ printf x; } >&-", "printf"],
    ["f(){ echo hi; }; f >&-", "echo"],
    ["( echo o ) 1<&0 </dev/null", "echo"],
    ["{ { printf x; }; true; } >&-", "printf"],
    ["f(){ command printf x; }; f >&-", "printf"],
    ["{ builtin printf x; } >&-", "printf"],
  ])("attributes %s to %s", async (script, command) => {
    const result = await new Bash().exec(script);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ${command}: write error: Bad file descriptor\n`,
    );
    expect(result.exitCode).toBe(1);
  });

  it("retains each producer rather than the last command in the group", async () => {
    const result = await new Bash().exec(
      "{ echo first; printf second; true; } >&-",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: echo: write error: Bad file descriptor\nbash: printf: write error: Bad file descriptor\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it("does not attribute discarded output to a later failure", async () => {
    const result = await new Bash().exec(
      "{ printf ignored >/dev/null; echo visible; } >&-",
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: echo: write error: Bad file descriptor\n",
    );
    expect(result.exitCode).toBe(1);
  });

  it.each([
    "{ printf x; exit; } >&-",
    "( printf x; exit ) >&-",
    "f(){ printf x; return; }; f >&-",
  ])("retains the producer across control flow in %s", async (script) => {
    const result = await new Bash().exec(script);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "bash: printf: write error: Bad file descriptor\n",
    );
  });

  it("preserves exec's external diagnostic prefix", async () => {
    const result = await new Bash().exec("{ exec printf x; } >&-");
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("printf: write error: Bad file descriptor\n");
    expect(result.exitCode).toBe(1);
  });
});
