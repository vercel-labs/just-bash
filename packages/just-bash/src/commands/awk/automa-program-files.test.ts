// Automa modifications: N00b patch-awk-program-files.mjs regression fixtures.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import fixtures from "./automa-program-fixtures.json";
import { awkLimitWithOutput, preserveAwkOutput } from "./execution-error.js";
import { createRuntimeContext } from "./interpreter/context.js";

const files = Object.fromEntries(
  Object.entries(fixtures.files).map(([name, content]) => [
    `/workspace/${name}`,
    content,
  ]),
);
describe("awk source programs", () => {
  for (const fixture of fixtures.cases) {
    it(fixture.label, async () => {
      const result = await new Bash({ cwd: "/workspace", files }).exec(
        fixture.command,
      );
      expect({
        stdout: result.stdout,
        exitCode: result.exitCode,
        hasStderr: !!result.stderr,
      }).toEqual(fixture.expected);
    });
  }
  it.each([
    [{ maxInputBytes: 10 }, "awk -f program.awk rows.txt"],
    [{ maxInputBytes: 30 }, "awk -f program.awk -f program.awk rows.txt"],
    [{ maxArrayElements: 1 }, "awk -f program.awk -f program.awk rows.txt"],
  ])("retains source limits %j", async (executionLimits, command) => {
    const shell = new Bash({ cwd: "/workspace", files, executionLimits });
    const result = await shell.exec(`${command}; printf UNEXPECTED_SUCCESS`);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/limit|size|count/);
    expect(result.stdout).not.toContain("UNEXPECTED_SUCCESS");
  });
  it("preserves output before a resource failure and prevents recovery", async () => {
    const result = await new Bash({
      executionLimits: { maxAwkIterations: 2 },
    }).exec(
      `if awk 'BEGIN{print "before"; while(1){i++}}'; then echo WRONG; else echo WRONG; fi; echo WRONG`,
    );
    expect(result.exitCode).toBe(126);
    expect(result.stdout).toBe("before\n");
    expect(result.executionFailure?.kind).toBe("resource-limit");
  });
});

it("keeps identical output from different AWK error owners", () => {
  const parent = createRuntimeContext();
  const child = createRuntimeContext();
  parent.output = child.output = "same\n";
  const error = awkLimitWithOutput(child, "limit", "iterations");
  preserveAwkOutput(error, child);
  expect(error.stdout).toBe("same\n");
  preserveAwkOutput(error, parent);
  expect(error.stdout).toBe("same\nsame\n");
});
