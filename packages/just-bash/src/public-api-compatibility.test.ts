import { describe, expect, it } from "vitest";
import {
  type Command,
  type CommandContext,
  createCommandContext,
  EMPTY_BYTES,
  InMemoryFs,
} from "./index.js";

describe("public API source compatibility", () => {
  it("separates legacy context inputs from resolved dispatch contexts", async () => {
    const context: CommandContext = {
      fs: new InMemoryFs(),
      cwd: "/",
      env: new Map(),
      stdin: EMPTY_BYTES,
    };
    const command: Command = {
      name: "legacy",
      async execute(_args, ctx) {
        return {
          stdout: `${ctx.cwd}:${ctx.limits.maxOutputSize}`,
          stderr: "",
          exitCode: 0,
        };
      },
    };
    const dispatched = createCommandContext({ fs: context.fs });

    expect(await command.execute([], dispatched)).toEqual({
      stdout: `/:${dispatched.limits.maxOutputSize}`,
      stderr: "",
      exitCode: 0,
    });
    expect("limits" in context).toBe(false);
  });
});
