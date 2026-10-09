import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("tr operand validation", () => {
  it.each([
    ["echo é | tr 'é' X '\\377'", "\\377"],
    ["echo é | tr -s 'é' X '\\377'", "\\377"],
    ["echo é | tr -d 'é' '\\377'", "\\377"],
    ["echo é | tr -ds 'é' X '\\377'", "\\377"],
    ["echo abc | tr a X ignored", "ignored"],
  ])("rejects extra operands before processing input in %s", async (script, extra) => {
    const result = await new Bash({ files: {}, cwd: "/" }).exec(script);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(`tr: extra operand '${extra}'\n`);
    expect(result.exitCode).toBe(1);
  });
});
