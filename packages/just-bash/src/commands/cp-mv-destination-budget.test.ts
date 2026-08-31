import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe.each(["cp", "mv"])("%s destination traversal budget", (operation) => {
  it("charges backend recursion to the command budget without losing files", async () => {
    const environment = new Bash({ executionLimits: { maxTraversalWork: 80 } });
    for (let index = 0; index < 20; index++) {
      await environment.fs.writeFile(`/source/file${index}`, `payload${index}`);
    }
    const command = operation === "cp" ? "cp -r" : "mv";

    const result = await environment.exec(`${command} /source /copied`);

    expect(result).toMatchObject({
      stdout: "",
      stderr: `bash: ${operation}: filesystem traversal work limit exceeded (80)\n`,
      exitCode: 126,
    });
    // The command preflight completed: exhaustion happened during the copy.
    expect(await environment.fs.exists("/copied")).toBe(true);
    for (let index = 0; index < 20; index++) {
      const sourcePath = `/source/file${index}`;
      const preservedPath = (await environment.fs.exists(sourcePath))
        ? sourcePath
        : `/copied/file${index}`;
      expect(await environment.readFile(preservedPath)).toBe(`payload${index}`);
    }
  });

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
