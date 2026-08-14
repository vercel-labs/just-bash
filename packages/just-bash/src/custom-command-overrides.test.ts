import { afterEach, describe, expect, it } from "vitest";
import { Bash } from "./Bash.js";
import { defineCommand } from "./custom-commands.js";
import {
  DefenseInDepthBox,
  SecurityViolationError,
} from "./security/defense-in-depth-box.js";
import { _setTimeout } from "./timers.js";
import type { RuntimeCommand } from "./types.js";

describe("custom command overrides", () => {
  afterEach(() => {
    DefenseInDepthBox.resetInstance();
  });

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

  it("preserves output accounting when delegating to find", async () => {
    const find = defineCommand("find", async (args, ctx) => {
      if (!ctx.origCommand) throw new Error("missing original command");
      return ctx.origCommand(args);
    });
    const bash = new Bash({
      files: {
        "/root/message.txt": "hello\n",
        "/root/nested/another.txt": "world\n",
      },
      customCommands: [find],
    });

    expect(await bash.exec("find /root -type f")).toMatchObject({
      stdout: "/root/message.txt\n/root/nested/another.txt\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("preserves output accounting when delegating to xargs", async () => {
    const xargs = defineCommand("xargs", async (args, ctx) => {
      if (!ctx.origCommand) throw new Error("missing original command");
      return ctx.origCommand(args);
    });
    const bash = new Bash({ customCommands: [xargs] });

    expect(await bash.exec("printf 'one\\ntwo\\n' | xargs echo")).toMatchObject(
      {
        stdout: "one two\n",
        stderr: "",
        exitCode: 0,
      },
    );
  });

  it("runs the original command with its own trust setting", async () => {
    const bash = new Bash({ defenseInDepth: true });
    const commands = (
      bash as unknown as { commands: Map<string, RuntimeCommand> }
    ).commands;
    const originalCat = commands.get("cat");
    if (!originalCat) throw new Error("missing bundled cat command");
    originalCat.execute = async () => {
      const isFunctionBlocked = () => {
        try {
          new Function("return 1");
          return false;
        } catch (error) {
          return error instanceof SecurityViolationError;
        }
      };
      const directlyBlocked = isFunctionBlocked();
      const promiseBlocked = await Promise.resolve().then(isFunctionBlocked);
      const timerBlocked = await new Promise<boolean>((resolve) => {
        _setTimeout(() => resolve(isFunctionBlocked()), 0);
      });
      const trustedValue = await DefenseInDepthBox.runTrustedAsync(async () =>
        new Function("return 2")(),
      );
      return {
        stdout: `${directlyBlocked}:${promiseBlocked}:${timerBlocked}:${trustedValue}\n`,
        stderr: "",
        exitCode: 0,
      };
    };
    bash.registerCommand(
      defineCommand("cat", async (args, ctx) => {
        if (!ctx.origCommand) throw new Error("missing original command");
        return ctx.origCommand(args);
      }),
    );

    expect(await bash.exec("cat")).toMatchObject({
      stdout: "true:true:true:2\n",
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
