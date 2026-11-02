// Automa modifications: migrate frozen GNU bash 5.2.37 trap fixtures from
// utils/upstream/patch-trap-builtin.fixtures.mjs, plus cancellation/limit guards.
import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";
import { defineCommand } from "../custom-commands.js";
import fixtures from "./automa-trap-fixtures.json";

describe("Automa trap lifecycle", () => {
  it.each(fixtures)("$name", async ({ script, expected }) => {
    const bash = new Bash({
      cwd: "/workspace",
      env: { LC_ALL: "C", TZ: "UTC" },
    });
    const result = await bash.exec(script);
    expect({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    }).toEqual({
      stdout: expected.stdout,
      stderr: expected.stderr,
      exitCode: expected.exitCode,
    });
    for (const [path, content] of Object.entries(expected.files))
      expect(await bash.fs.readFile(`/workspace/${path}`)).toBe(content);
  });
  it("does not trap resource failures", async () => {
    const bash = new Bash({ executionLimits: { maxLoopIterations: 5 } });
    const result = await bash.exec(
      "trap 'echo bad' ERR EXIT; while true; do :; done; echo bad",
    );
    expect(result.executionFailure?.kind).toBe("resource-limit");
    expect(result.stdout).not.toContain("bad");
  });
  it("does not trap Stop", async () => {
    const controller = new AbortController();
    const bash = new Bash({
      customCommands: [
        defineCommand("revoke", async () => {
          controller.abort();
          return { stdout: "", stderr: "", exitCode: 0 };
        }),
      ],
    });
    const result = await bash.exec(
      "trap 'echo bad' ERR EXIT; revoke; echo bad",
      { signal: controller.signal },
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("bad");
  });
  it("bounds cleanup itself", async () => {
    for (const event of ["ERR", "EXIT"]) {
      const result = await new Bash({
        executionLimits: { maxLoopIterations: 5 },
      }).exec(`trap 'while true; do :; done' ${event}; false`);
      expect(result.executionFailure?.kind).toBe("resource-limit");
    }
  });
  it("streams body and trap output once in descriptor order", async () => {
    let observed = "";
    const result = await new Bash().exec(
      "trap 'printf X; printf Y >&2' EXIT; trap 'printf E; printf F >&2' ERR; printf B; false; printf A",
      {
        onOutput: (text) => {
          observed += text;
        },
      },
    );
    expect(observed).toBe("BEFAXY");
    expect(result.output).toBe(observed);
  });
  it.each([
    "kill -TERM $$",
    "trap 'echo bad' TERM",
  ])("fails visibly for unsupported host state: %s", async (script) => {
    const result = await new Bash().exec(script);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/unavailable|unsupported/);
  });
});
