// Automa modifications: original byte/output/flags patch regressions.
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe("Automa shell byte boundaries", () => {
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
