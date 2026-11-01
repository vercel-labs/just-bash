// Automa modifications: replacement environments export only the actual environment.
import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";
import { createCommandContext } from "../../custom-commands.js";
import { InMemoryFs } from "../../fs/in-memory-fs/index.js";
import { envCommand } from "./env.js";

describe("Automa env export inheritance", () => {
  it("uses the optional exported environment when it is explicitly empty", async () => {
    const context = createCommandContext({
      fs: new InMemoryFs(),
      env: new Map([["PRIVATE", "hidden"]]),
      exportedEnv: {},
    });
    expect(await envCommand.execute([], context)).toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });
  it("retains the public direct-command context without export metadata", async () => {
    const context = createCommandContext({
      fs: new InMemoryFs(),
      env: new Map([["DIRECT", "value"]]),
    });
    expect(await envCommand.execute([], context)).toEqual({
      stdout: "DIRECT=value\n",
      stderr: "",
      exitCode: 0,
    });
  });
  it("does not promote local shell values while passing explicit env assignments", async () => {
    const result = await new Bash().exec(
      'PRIVATE=hidden; env NAME=value sh -c \'printf "[%s] [%s]" "$NAME" "$PRIVATE"\'',
    );
    expect(result.stdout).toBe("[value] []");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});
