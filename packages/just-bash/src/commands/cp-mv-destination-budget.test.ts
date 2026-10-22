import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe.each(["cp", "mv"])("%s destination traversal budget", (operation) => {
  it("rejects repeated canceled components before mutating either file", async () => {
    const environment = new Bash({
      files: { "/source": "payload", "/a/keep": "keep", "/copied": "original" },
      executionLimits: { maxTraversalWork: 20 },
    });

    const result = await environment.exec(
      `${operation} /source /${"a/../".repeat(100)}copied`,
    );

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `bash: ${operation}: filesystem traversal work limit exceeded (20)\n`,
    );
    expect(result.exitCode).toBe(126);
    expect(await environment.fs.readFile("/source")).toBe("payload");
    expect(await environment.fs.readFile("/copied")).toBe("original");

    // A rejected execution must not poison subsequent execution budgets.
    expect(
      await environment.exec(`${operation} /source /copied`),
    ).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await environment.fs.readFile("/copied")).toBe("payload");
  });
});
