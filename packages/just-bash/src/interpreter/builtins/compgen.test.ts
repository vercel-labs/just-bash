import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("compgen builtin", () => {
  it("should run the next command after a lexer error in -C", async () => {
    const env = new Bash();
    const result = await env.exec(
      "echo start; compgen -C 'x=$(echo a # )' foo; echo end",
    );
    expect(result.stdout).toBe("start\nend\n");
    expect(result.stderr).toBe(
      "compgen: -C: line 1: unexpected EOF while looking for matching `)'\n",
    );
    expect(result.exitCode).toBe(0);
  });
});
