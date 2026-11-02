// Automa modifications: original byte/output/flags patch regressions.
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { expandBraceRange } from "./expansion/brace-range.js";

describe("Automa shell byte boundaries", () => {
  it.each([
    "f(){ echo -n é; }; f >(printf X)",
    "echo -n é 2> >(printf X)",
    "echo -n é 2> >(printf X) | cat",
    "f(){ echo -n é; }; { f >(printf X); } | cat",
    "f(){ echo -n é; }; { f >(printf X); } > /tmp/mixed; cat /tmp/mixed",
  ])("keeps text before a process writer byte stream: %s", async (script) => {
    let observed = "";
    const result = await new Bash().exec(script, {
      onOutput: (text) => {
        observed += text;
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("éX");
    expect(result.stderr).toBe("");
    expect(result.output).toBe("éX");
    expect(observed).toBe("éX");
  });
  it("keeps ordered output through a redirected function return", async () => {
    const result = await new Bash().exec(
      "f(){ printf a; printf b >&2; printf c; return; }; f 2>&1",
    );
    expect(result.stdout).toBe("abc");
    expect(result.stderr).toBe("");
  });
  it("uses the configured brace cap and fails visibly on exhaustion", async () => {
    const bash = new Bash({
      executionLimits: { maxBraceExpansionResults: 12000 },
    });
    const allowed = expandBraceRange(1, 11000, undefined, "1", "11000", {
      maxResults: 12000,
      maxStringBytes: 100000,
    });
    expect(allowed.expanded).toHaveLength(11000);
    expect(allowed.expanded?.at(-1)).toBe("11000");
    const failed = await bash.exec("printf '%s' {1..12001} || echo WRONG");
    expect(failed.exitCode).toBe(126);
    expect(failed.executionFailure?.kind).toBe("resource-limit");
    expect(failed.stdout).toBe("");
  });
  it.each([
    [
      "x=$(printf '\\342'; printf '\\202'; printf '\\254'); printf '%s' \"$x\"",
      "€",
    ],
    ["cat <(printf '\\377'); printf x", "ÿx"],
    ["cat <(printf '\\342'; printf '\\202'; printf '\\254')", "€"],
    ["printf '\\377' > >(cat)", "ÿ"],
    ["printf -v x '\\342\\202\\254'; printf '%s' \"$x\"", "€"],
    ["echo -ne '\\0342\\0202\\0254'", "€"],
    ["printf '%s' 'é😀'", "é😀"],
    [
      "env NAME=value bash -c 'bash -c '\"'\"'printf %s \"$NAME\"'\"'\"''",
      "value",
    ],
  ])("preserves %s", async (script, expected) => {
    const result = await new Bash().exec(script);
    expect(result.exitCode).toBe(0);
    expect(result.output).toBe(expected);
  });
  it("matches only directories for a trailing slash glob", async () => {
    const bash = new Bash({
      files: { "/work/a/file": "", "/work/b": "" },
      cwd: "/work",
    });
    expect((await bash.exec("printf '%s\\n' */")).stdout).toBe("a/\n");
  });
  it("charges process substitution captures to the shared output limit", async () => {
    const result = await new Bash({
      executionLimits: { maxOutputSize: 10 },
    }).exec("cat <(printf '12345678901') || true");
    expect(result.executionFailure?.kind).toBe("resource-limit");
    expect(result.exitCode).toBe(126);
  });
});
