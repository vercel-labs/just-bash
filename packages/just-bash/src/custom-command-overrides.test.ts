import { describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import { defineCommand } from "./custom-commands.js";

describe("custom command overrides", () => {
  it("provides the shadowed bundled command through the context", async () => {
    const cat = defineCommand("cat", async (args, ctx) => {
      if (!ctx.origCommand) throw new Error("missing original command");
      return ctx.origCommand(args);
    });
    const bash = new Bash({
      files: { "/message.txt": "hello\n" },
      customCommands: [cat],
    });

    expect(await bash.exec("cat /message.txt")).toMatchObject({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("omits the original command for a new command name", async () => {
    const custom = defineCommand("custom", async (_args, ctx) => ({
      stdout: String(ctx.origCommand),
      stderr: "",
      exitCode: 0,
    }));

    expect(
      await new Bash({ customCommands: [custom] }).exec("custom"),
    ).toMatchObject({
      stdout: "undefined",
      stderr: "",
      exitCode: 0,
    });
  });
});
