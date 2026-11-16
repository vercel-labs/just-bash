import { describe, expect, it } from "vitest";
import { Bash } from "../Bash.js";

describe.each(["cp", "mv"])("%s trailing source slash", (operation) => {
  it.each([
    "a/b/",
    "a/b///",
    "/work/a/b/",
  ])("uses the basename of %s", async (sourcePath) => {
    const environment = new Bash({
      cwd: "/work",
      files: { "/work/a/b/file": "payload", "/work/destination/keep": "keep" },
    });
    const command = operation === "cp" ? "cp -r" : "mv";

    expect(
      await environment.exec(`${command} ${sourcePath} destination`),
    ).toMatchObject({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(await environment.readFile("/work/destination/b/file")).toBe(
      "payload",
    );
    expect(await environment.fs.exists("/work/a/b/file")).toBe(
      operation === "cp",
    );
    expect(await environment.fs.exists("/work/destination/a")).toBe(false);
  });
});

describe.each(["cp", "mv"])("%s empty destination", (operation) => {
  it.each(["/", "/work"])("preserves files from cwd %s", async (cwd) => {
    const sourcePath = cwd === "/" ? "/source" : "/work/source";
    const environment = new Bash({
      cwd,
      files: { "/source": "root original", [sourcePath]: "payload" },
    });

    const result = await environment.exec(`${operation} source ""`);

    expect(result).toMatchObject({
      stdout: "",
      stderr:
        operation === "cp"
          ? "cp: cannot create regular file '': No such file or directory\n"
          : "mv: cannot move 'source' to '': No such file or directory\n",
      exitCode: 1,
    });
    expect(await environment.readFile(sourcePath)).toBe("payload");
    expect(await environment.readFile("/source")).toBe(
      cwd === "/" ? "payload" : "root original",
    );
  });
});

it.each([
  "missing/target",
  "blocker/target",
  "",
])("cp reports missing -r before destination error for %s", async (destination) => {
  const environment = new Bash({
    cwd: "/work",
    files: { "/work/source/nested": "payload", "/work/blocker": "file" },
  });

  expect(await environment.exec(`cp source "${destination}"`)).toMatchObject({
    stdout: "",
    stderr: "cp: -r not specified; omitting directory 'source'\n",
    exitCode: 1,
  });
  expect(await environment.readFile("/work/source/nested")).toBe("payload");
  expect(await environment.fs.exists("/work/missing")).toBe(false);
});
