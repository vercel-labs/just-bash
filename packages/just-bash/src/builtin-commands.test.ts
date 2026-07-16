import { describe, expect, it, vi } from "vitest";
import { createBuiltinCommands as createBrowserBuiltinCommands } from "./browser.js";
import { Bash, createBuiltinCommands, defineCommand } from "./index.js";

describe("createBuiltinCommands", () => {
  it("returns only the requested built-in commands", () => {
    const commands = createBuiltinCommands(["cat", "grep"]);

    expect(commands.map((command) => command.name)).toEqual(["cat", "grep"]);
  });

  it("is available from the browser entry point", () => {
    expect(createBrowserBuiltinCommands(["cat"]).map((command) => command.name)).toEqual([
      "cat",
    ]);
  });

  it("allows a custom command to decorate a built-in", async () => {
    const [builtinCat] = createBuiltinCommands(["cat"]);
    const execute = vi.fn(builtinCat.execute.bind(builtinCat));
    const cat = defineCommand("cat", execute);
    const bash = new Bash({
      files: { "/message.txt": "hello\n" },
      customCommands: [cat],
    });

    const result = await bash.exec("cat /message.txt");

    expect(result.stdout).toBe("hello\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0][0]).toEqual(["/message.txt"]);
  });
});
