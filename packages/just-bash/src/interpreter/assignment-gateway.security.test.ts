import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { printfCommand } from "../commands/printf/printf.js";
import { defineCommand } from "../custom-commands.js";
import { EMPTY_BYTES } from "../encoding.js";
import { resolveLimits } from "../limits.js";

describe("interpreter assignment gateway", () => {
  it("rejects special and positional names at the gateway itself", async () => {
    const assign = defineCommand(
      "assign-through-gateway",
      async (args, ctx) => {
        await ctx.assignShellVariable?.(args[0], "poison");
        return { stdout: "", stderr: "", exitCode: 0 };
      },
    );
    const bash = new Bash({ customCommands: [assign] });

    const positional = await bash.exec(
      "assign-through-gateway 1; printf '<%s>' \"$1\"",
    );
    const special = await bash.exec(
      "assign-through-gateway '#'; printf '<%s>' \"$#\"",
    );

    expect(positional.stdout).toBe("<>");
    expect(positional.stderr).toBe(
      "assign-through-gateway: 1: not a valid identifier\n",
    );
    expect(positional.exitCode).toBe(0);
    expect(special.stdout).toBe("<0>");
    expect(special.stderr).toBe(
      "assign-through-gateway: #: not a valid identifier\n",
    );
    expect(special.exitCode).toBe(0);
  });

  it("uses checked shell arithmetic for indexed printf subscripts", async () => {
    const bash = new Bash();
    const result = await bash.exec(
      "i=2; printf -v 'items[i+1]' value; printf '<%s>' \"${items[3]}\"",
    );

    expect(result.stdout).toBe("<value>");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("follows namerefs and enforces readonly on the resolved target", async () => {
    const bash = new Bash();
    const assigned = await bash.exec(
      'target=old; declare -n ref=target; printf -v ref new; echo "$target"',
    );
    const readonly = await bash.exec(
      'target=old; readonly target; declare -n ref=target; printf -v ref new; echo "$target"',
    );

    expect(assigned.stdout).toBe("new\n");
    expect(assigned.stderr).toBe("");
    expect(assigned.exitCode).toBe(0);
    expect(readonly.stdout).toBe("old\n");
    expect(readonly.stderr).toBe("printf: target: readonly variable\n");
    expect(readonly.exitCode).toBe(0);
  });

  it("fails clearly for array assignment in a bare embedder context", async () => {
    const env = new Map<string, string>();
    const result = await printfCommand.execute(["-v", "items[0]", "value"], {
      fs: {} as never,
      cwd: "/",
      env,
      stdin: EMPTY_BYTES,
      limits: resolveLimits(),
    });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      "printf: printf -v array assignment requires an interpreter assignment gateway\n",
    );
    expect(result.exitCode).toBe(1);
    expect(Array.from(env.entries())).toEqual([]);
  });
});
