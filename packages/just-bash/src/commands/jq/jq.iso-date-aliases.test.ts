import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("jq ISO date builtin names", () => {
  it("preserves user-defined ISO date functions with arguments", async () => {
    const result = await new Bash().exec(
      "jq -nc 'def fromdateiso8601(x): x; def todateiso8601(x): x; [fromdateiso8601(7), todateiso8601(8)]'",
    );
    expect(result).toMatchObject({
      stdout: "[7,8]\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves zero-argument user-defined aliases", async () => {
    const result = await new Bash().exec(
      "jq -nc 'def fromdateiso8601: 42; def todateiso8601: 7; [fromdateiso8601, todateiso8601]'",
    );
    expect(result).toMatchObject({
      stdout: "[42,7]\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("parses ISO dates with fromdateiso8601", async () => {
    const result = await new Bash().exec(
      `jq -n '"2026-05-03T22:28:02Z" | fromdateiso8601'`,
    );
    expect(result.stdout).toBe("1777847282\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("formats ISO dates with todateiso8601", async () => {
    const result = await new Bash().exec("jq -nr '1777847282 | todateiso8601'");
    expect(result.stdout).toBe("2026-05-03T22:28:02Z\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("lists both ISO names in builtins", async () => {
    const result = await new Bash().exec(
      `jq -c -n '[builtins[] | select(. == "fromdateiso8601/0" or . == "todateiso8601/0")] | sort'`,
    );
    expect(result.stdout).toBe('["fromdateiso8601/0","todateiso8601/0"]\n');
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
