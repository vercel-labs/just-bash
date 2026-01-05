import { describe, expect, it } from "vitest";
import { BashSandbox } from "./BashSandbox.js";
import type { SandboxProvider } from "./provider.js";

type BashResult = { stdout: string; stderr: string; exitCode: number };

// Helper to execute tool and get result (handles async iterable case)
async function execTool(
  tool: ReturnType<BashSandbox["tool"]>,
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

describe("BashSandbox", () => {
  describe("default (just-bash) provider", () => {
    it("should execute commands", async () => {
      const sandbox = new BashSandbox();
      const result = await sandbox.exec("echo hello");
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });

    it("should initialize with files", async () => {
      const sandbox = new BashSandbox({
        files: { "/data/test.txt": "hello world" },
      });
      const result = await sandbox.exec("cat /data/test.txt");
      expect(result.stdout).toBe("hello world");
    });

    it("should write and read files", async () => {
      const sandbox = new BashSandbox();
      await sandbox.writeFiles({
        "/app/config.json": '{"debug": true}',
      });
      const content = await sandbox.readFile("/app/config.json");
      expect(content).toBe('{"debug": true}');
    });

    it("should support base64 encoding for writeFiles", async () => {
      const sandbox = new BashSandbox();
      await sandbox.writeFiles({
        "/data/file.txt": {
          content: Buffer.from("hello").toString("base64"),
          encoding: "base64",
        },
      });
      const content = await sandbox.readFile("/data/file.txt");
      expect(content).toBe("hello");
    });

    it("should support base64 encoding for readFile", async () => {
      const sandbox = new BashSandbox();
      await sandbox.writeFiles({ "/data/file.txt": "hello" });
      const base64 = await sandbox.readFile("/data/file.txt", "base64");
      expect(base64).toBe(Buffer.from("hello").toString("base64"));
    });

    it("should create directories", async () => {
      const sandbox = new BashSandbox();
      await sandbox.mkdir("/app/logs", { recursive: true });
      const result = await sandbox.exec("ls -d /app/logs");
      expect(result.stdout).toBe("/app/logs\n");
    });

    it("should respect cwd option", async () => {
      const sandbox = new BashSandbox({ cwd: "/tmp" });
      const result = await sandbox.exec("pwd");
      expect(result.stdout).toBe("/tmp\n");
    });

    it("should respect env option", async () => {
      const sandbox = new BashSandbox({ env: { MY_VAR: "test123" } });
      const result = await sandbox.exec("echo $MY_VAR");
      expect(result.stdout).toBe("test123\n");
    });

    it("should expose sandbox provider", async () => {
      const sandbox = new BashSandbox();
      expect(sandbox.sandbox).toBeDefined();
      expect(typeof sandbox.sandbox.exec).toBe("function");
    });
  });

  describe("custom provider", () => {
    it("should use custom provider", async () => {
      const mockProvider: SandboxProvider = {
        exec: async () => ({
          stdout: "custom output",
          stderr: "",
          exitCode: 0,
        }),
        writeFiles: async () => {},
        readFile: async () => "custom content",
        mkdir: async () => {},
        stop: async () => {},
      };

      const sandbox = new BashSandbox({ provider: mockProvider });
      const result = await sandbox.exec("anything");
      expect(result.stdout).toBe("custom output");

      const content = await sandbox.readFile("/any/path");
      expect(content).toBe("custom content");
    });
  });

  describe("tool()", () => {
    it("should return an AI SDK compatible tool", async () => {
      const sandbox = new BashSandbox({
        files: { "/data/test.txt": "hello" },
      });
      const bashTool = sandbox.tool();

      expect(bashTool).toBeDefined();
      expect(bashTool.description).toContain("bash");
      expect(bashTool.execute).toBeDefined();
    });

    it("should execute commands via tool", async () => {
      const sandbox = new BashSandbox();
      const bashTool = sandbox.tool();

      const result = await execTool(bashTool, "echo test");
      expect(result.stdout).toBe("test\n");
      expect(result.exitCode).toBe(0);
    });

    it("should share state between tool and direct operations", async () => {
      const sandbox = new BashSandbox();
      const bashTool = sandbox.tool();

      // Write via direct API
      await sandbox.writeFiles({ "/shared/file.txt": "from direct" });

      // Read via tool
      const result = await execTool(bashTool, "cat /shared/file.txt");
      expect(result.stdout).toBe("from direct");

      // Write via tool
      await execTool(bashTool, 'echo "from tool" > /shared/tool-file.txt');

      // Read via direct API
      const content = await sandbox.readFile("/shared/tool-file.txt");
      expect(content).toBe("from tool\n");
    });

    it("should call onCall callback", async () => {
      const sandbox = new BashSandbox();
      const commands: string[] = [];
      const bashTool = sandbox.tool({
        onCall: (cmd) => commands.push(cmd),
      });

      await execTool(bashTool, "echo one");
      await execTool(bashTool, "echo two");

      expect(commands).toEqual(["echo one", "echo two"]);
    });

    it("should include extraInstructions in description", async () => {
      const sandbox = new BashSandbox();
      const bashTool = sandbox.tool({
        extraInstructions: "This is a TypeScript project.",
      });

      expect(bashTool.description).toContain("This is a TypeScript project.");
    });

    it("should list available files in description", async () => {
      const sandbox = new BashSandbox({
        files: {
          "/src/index.ts": "export const x = 1;",
          "/package.json": "{}",
        },
      });
      const bashTool = sandbox.tool();

      expect(bashTool.description).toContain("/src/index.ts");
      expect(bashTool.description).toContain("/package.json");
    });
  });

  describe("stop()", () => {
    it("should be callable (no-op for bash provider)", async () => {
      const sandbox = new BashSandbox();
      await expect(sandbox.stop()).resolves.toBeUndefined();
    });
  });
});
