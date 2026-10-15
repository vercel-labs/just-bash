import { describe, expect, it } from "vitest";
import {
  type Command,
  type CommandContext,
  createCommandContext,
  EMPTY_BYTES,
  InMemoryFs,
  isBashParseError,
  parse,
} from "./index.js";

const getParseError = (source: string): unknown => {
  try {
    parse(source);
  } catch (error) {
    return error;
  }
  throw new Error("Expected parsing to fail");
};

describe("public API source compatibility", () => {
  it("keeps standalone inputs separate from resolved command callbacks", async () => {
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
    expect(dispatched.limits.maxOutputSize).toBeGreaterThan(0);
  });

  it("classifies expected parse failures without matching unrelated errors", () => {
    expect(isBashParseError(getParseError("fi"))).toBe(true);
    expect(isBashParseError(getParseError('echo "unterminated'))).toBe(true);
    expect(isBashParseError(getParseError("echo $((1.2))"))).toBe(true);
    expect(isBashParseError(new Error("implementation failure"))).toBe(false);
  });
});
