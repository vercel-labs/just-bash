import { describe, expect, it } from "vitest";
import { defineCommand } from "../custom-commands.js";
import { createBashTool } from "./index.js";

type BashResult = { stdout: string; stderr: string; exitCode: number };

// Helper to execute tool and get result (handles async iterable case)
async function exec(
  tool: ReturnType<typeof createBashTool>["tool"],
  command: string,
): Promise<BashResult> {
  if (!tool.execute) {
    throw new Error("Tool has no execute function");
  }
  const result = await tool.execute(
    { command },
    { toolCallId: "test", messages: [] },
  );
  // Our implementation always returns a plain object, not an async iterable
  return result as BashResult;
}

describe("createBashTool", () => {
  it("returns tool and filesystem", () => {
    const { tool, filesystem } = createBashTool();

    expect(tool).toBeDefined();
    expect(tool.description).toContain("Execute bash commands");
    expect(tool.inputSchema).toBeDefined();
    expect(tool.execute).toBeInstanceOf(Function);

    expect(filesystem).toBeDefined();
    expect(typeof filesystem.exec).toBe("function");
    expect(typeof filesystem.writeFiles).toBe("function");
    expect(typeof filesystem.readFile).toBe("function");
  });

  it("executes commands and returns results", async () => {
    const { tool } = createBashTool();
    const result = await exec(tool, "echo hello");

    expect(result).toEqual({
      stdout: "hello\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("includes file hints in description when files provided", () => {
    const { tool } = createBashTool({
      files: {
        "/src/index.ts": "export const x = 1;",
        "/README.md": "# Hello",
      },
    });

    expect(tool.description).toContain("Available files:");
    expect(tool.description).toContain("/src/index.ts");
    expect(tool.description).toContain("/README.md");
    expect(tool.description).toContain("Common operations:");
  });

  it("limits file hints to 5 files", () => {
    const { tool } = createBashTool({
      files: {
        "/a.txt": "a",
        "/b.txt": "b",
        "/c.txt": "c",
        "/d.txt": "d",
        "/e.txt": "e",
        "/f.txt": "f",
        "/g.txt": "g",
      },
    });

    expect(tool.description).toContain("... and 2 more");
  });

  it("can read files from virtual filesystem", async () => {
    const { tool } = createBashTool({
      files: {
        "/test.txt": "file content here",
      },
    });

    const result = await exec(tool, "cat /test.txt");

    expect(result).toEqual({
      stdout: "file content here",
      stderr: "",
      exitCode: 0,
    });
  });

  it("restricts commands when commands option provided", async () => {
    const { tool } = createBashTool({
      commands: ["echo", "cat"],
    });

    // echo should work
    const echoResult = await exec(tool, "echo hi");
    expect(echoResult.exitCode).toBe(0);

    // ls should not work
    const lsResult = await exec(tool, "ls");
    expect(lsResult.exitCode).toBe(127);
    expect(lsResult.stderr).toContain("command not found");
  });

  it("shows available commands in description when filtered", () => {
    const { tool } = createBashTool({
      commands: ["echo", "cat", "grep"],
    });

    expect(tool.description).toContain("Available commands: echo, cat, grep");
  });

  it("includes extra instructions in description", () => {
    const { tool } = createBashTool({
      extraInstructions: "This is a special environment for testing.",
    });

    expect(tool.description).toContain(
      "This is a special environment for testing.",
    );
  });

  it("mentions network when configured", () => {
    const { tool } = createBashTool({
      network: { dangerouslyAllowFullInternetAccess: true },
    });

    expect(tool.description).toContain("Network access via curl is enabled");
  });

  it("sets environment variables", async () => {
    const { tool } = createBashTool({
      env: { MY_VAR: "my_value" },
    });

    const result = await exec(tool, "echo $MY_VAR");
    expect(result.stdout).toBe("my_value\n");
  });

  it("uses custom cwd", async () => {
    const { tool } = createBashTool({
      cwd: "/custom/path",
      files: { "/custom/path/file.txt": "content" },
    });

    const result = await exec(tool, "pwd");
    expect(result.stdout).toBe("/custom/path\n");
  });

  it("help command works and lists available commands", async () => {
    const { tool } = createBashTool();
    const result = await exec(tool, "help");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Available commands:");
    expect(result.stdout).toContain("echo");
    expect(result.stdout).toContain("grep");
  });

  it("help shows only registered commands when filtered", async () => {
    const { tool } = createBashTool({
      commands: ["echo", "cat", "help"],
    });

    const result = await exec(tool, "help");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("echo");
    expect(result.stdout).toContain("cat");
    expect(result.stdout).not.toContain("grep");
    expect(result.stdout).not.toContain("find");
  });

  it("calls onCall callback before command execution", async () => {
    const calls: string[] = [];
    const { tool } = createBashTool({
      onCall: (command) => calls.push(command),
    });

    await exec(tool, "echo hello");
    await exec(tool, "echo world");

    expect(calls).toEqual(["echo hello", "echo world"]);
  });

  it("supports custom commands via customCommands option", async () => {
    const hello = defineCommand("hello", async (args) => ({
      stdout: `Hello, ${args[0] || "world"}!\n`,
      stderr: "",
      exitCode: 0,
    }));

    const { tool } = createBashTool({
      customCommands: [hello],
    });

    const result = await exec(tool, "hello Alice");
    expect(result).toEqual({
      stdout: "Hello, Alice!\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("custom commands override built-in commands", async () => {
    const customEcho = defineCommand("echo", async (args) => ({
      stdout: `custom: ${args.join(" ")}\n`,
      stderr: "",
      exitCode: 0,
    }));

    const { tool } = createBashTool({
      customCommands: [customEcho],
    });

    const result = await exec(tool, "echo test");
    expect(result).toEqual({
      stdout: "custom: test\n",
      stderr: "",
      exitCode: 0,
    });
  });

  describe("filesystem integration", () => {
    it("tool and filesystem share state", async () => {
      const { tool, filesystem } = createBashTool();

      // Write via filesystem
      await filesystem.writeFiles({ "/shared/file.txt": "filesystem content" });

      // Read via tool
      const result = await exec(tool, "cat /shared/file.txt");
      expect(result.stdout).toBe("filesystem content");

      // Write via tool
      await exec(tool, 'echo "tool content" > /shared/tool-file.txt');

      // Read via filesystem
      const content = await filesystem.readFile("/shared/tool-file.txt");
      expect(content).toBe("tool content\n");
    });

    it("filesystem can read files created with files option", async () => {
      const { filesystem } = createBashTool({
        files: { "/data/test.txt": "initial content" },
      });

      const content = await filesystem.readFile("/data/test.txt");
      expect(content).toBe("initial content");
    });

    it("filesystem can write files before tool execution", async () => {
      const { tool, filesystem } = createBashTool();

      await filesystem.writeFiles({ "/config.json": '{"debug": true}' });

      const result = await exec(tool, "cat /config.json");
      expect(result.stdout).toBe('{"debug": true}');
    });
  });

  describe("fullVM option", () => {
    it("changes description when fullVM is true", () => {
      const { tool } = createBashTool({ fullVM: true });

      expect(tool.description).toContain("full VM environment");
      expect(tool.description).toContain("node, python");
    });

    it("uses simulated description when fullVM is false", () => {
      const { tool } = createBashTool({ fullVM: false });

      expect(tool.description).toContain("simulated bash environment");
      expect(tool.description).not.toContain("full VM");
    });
  });
});
