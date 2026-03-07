import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { Command, type OutputMessage, Sandbox } from "./Sandbox.js";

describe("Sandbox API", () => {
  describe("Sandbox.create()", () => {
    it("should create a sandbox instance", async () => {
      const sandbox = await Sandbox.create();
      expect(sandbox).toBeInstanceOf(Sandbox);
    });

    it("should accept cwd option", async () => {
      const sandbox = await Sandbox.create({ cwd: "/app" });
      const cmd = await sandbox.runCommand("pwd");
      const output = await cmd.stdout();
      expect(output.trim()).toBe("/app");
    });

    it("should accept env option", async () => {
      const sandbox = await Sandbox.create({
        env: { MY_VAR: "hello" },
      });
      const cmd = await sandbox.runCommand("echo $MY_VAR");
      const output = await cmd.stdout();
      expect(output.trim()).toBe("hello");
    });

    it("should accept BashEnv-specific maxCallDepth option", async () => {
      const sandbox = await Sandbox.create({ maxCallDepth: 5 });
      // Define and call recursive function in same exec (each exec is a new shell)
      const cmd = await sandbox.runCommand("recurse() { recurse; }; recurse");
      const stderr = await cmd.stderr();
      expect(stderr).toContain("maximum recursion depth");
    });
  });

  describe("sandbox.runCommand()", () => {
    it("should execute a command and return Command instance", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo hello");
      expect(cmd).toBeInstanceOf(Command);
    });

    it("should have correct cmdId", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo test");
      expect(cmd.cmdId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it("should have startedAt timestamp", async () => {
      const before = new Date();
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo test");
      const after = new Date();
      expect(cmd.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(cmd.startedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it("should support cwd option", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.mkDir("/mydir", { recursive: true });
      const cmd = await sandbox.runCommand("pwd", { cwd: "/mydir" });
      const output = await cmd.stdout();
      expect(output.trim()).toBe("/mydir");
    });

    it("should support per-command env option", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo $MY_VAR", {
        env: { MY_VAR: "per-exec-value" },
      });
      const output = await cmd.stdout();
      expect(output.trim()).toBe("per-exec-value");
    });

    it("should not persist per-command env after execution", async () => {
      const sandbox = await Sandbox.create();

      // First command with per-exec env
      const cmd1 = await sandbox.runCommand("echo $MY_VAR", {
        env: { MY_VAR: "temporary" },
      });
      expect((await cmd1.stdout()).trim()).toBe("temporary");

      // Second command without per-exec env - should not have the variable
      const cmd2 = await sandbox.runCommand("echo $MY_VAR");
      expect((await cmd2.stdout()).trim()).toBe("");
    });

    it("should support both cwd and env options together", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.mkDir("/app", { recursive: true });
      const cmd = await sandbox.runCommand('echo "$PWD: $APP_ENV"', {
        cwd: "/app",
        env: { APP_ENV: "production" },
      });
      const output = await cmd.stdout();
      expect(output.trim()).toBe("/app: production");
    });

    it("should restore sandbox state after per-exec options", async () => {
      const sandbox = await Sandbox.create({
        cwd: "/",
        env: { MODE: "original" },
      });
      await sandbox.mkDir("/temp", { recursive: true });

      // Run with overrides (runCommand now waits by default)
      const overrideCmd = await sandbox.runCommand("echo $MODE", {
        cwd: "/temp",
        env: { MODE: "override" },
      });
      expect((await overrideCmd.stdout()).trim()).toBe("override");

      // Verify original state is restored
      const cwdCmd = await sandbox.runCommand("pwd");
      expect((await cwdCmd.stdout()).trim()).toBe("/");

      const envCmd = await sandbox.runCommand("echo $MODE");
      expect((await envCmd.stdout()).trim()).toBe("original");
    });

    it("should support string + args form (Vercel style)", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo", ["-n", "hello world"]);
      const output = await cmd.stdout();
      expect(output).toBe("hello world");
    });

    it("should support object form with cmd and args", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand({
        cmd: "echo",
        args: ["-n", "from object"],
      });
      const output = await cmd.stdout();
      expect(output).toBe("from object");
    });

    it("should support object form with cwd and env", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.mkDir("/work", { recursive: true });
      const cmd = await sandbox.runCommand({
        cmd: "printenv",
        args: ["PWD", "MY_VAR"],
        cwd: "/work",
        env: { MY_VAR: "test123" },
      });
      const output = await cmd.stdout();
      expect(output).toBe("/work\ntest123\n");
    });

    it("should return CommandFinished with exitCode by default", async () => {
      const sandbox = await Sandbox.create();
      const result = await sandbox.runCommand("echo hello");
      // exitCode is guaranteed to be a number (not undefined)
      expect(result.exitCode).toBe(0);
    });

    it("should return Command immediately when detached", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand({
        cmd: "echo",
        args: ["detached"],
        detached: true,
      });
      expect(cmd).toBeInstanceOf(Command);
      // Must explicitly wait for completion
      const finished = await cmd.wait();
      expect(finished.exitCode).toBe(0);
      expect(await cmd.stdout()).toBe("detached\n");
    });

    it("should pipe to stdout/stderr streams in object form", async () => {
      const sandbox = await Sandbox.create();
      const stdoutChunks: string[] = [];
      const stderrChunks: string[] = [];
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();
      stdoutStream.on("data", (chunk: Buffer) =>
        stdoutChunks.push(chunk.toString()),
      );
      stderrStream.on("data", (chunk: Buffer) =>
        stderrChunks.push(chunk.toString()),
      );

      await sandbox.runCommand({
        cmd: "bash",
        args: ["-c", "echo out; echo err >&2"],
        stdout: stdoutStream,
        stderr: stderrStream,
      });

      expect(stdoutChunks.join("")).toBe("out\n");
      expect(stderrChunks.join("")).toBe("err\n");
    });

    it("should escape args with special characters", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo", ["hello world", "it's"]);
      const output = await cmd.stdout();
      expect(output).toBe("hello world it's\n");
    });
  });

  describe("Command.stdout()", () => {
    it("should return stdout", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo hello world");
      const output = await cmd.stdout();
      expect(output).toBe("hello world\n");
    });
  });

  describe("Command.stderr()", () => {
    it("should return stderr", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("cat /nonexistent 2>&1");
      const stderr = await cmd.stderr();
      // stderr is redirected to stdout, so stderr should be empty
      expect(stderr).toBe("");
    });

    it("should capture actual stderr", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("cat /nonexistent");
      const stderr = await cmd.stderr();
      expect(stderr).toContain("No such file");
    });
  });

  describe("Command.output()", () => {
    it("should return combined stdout and stderr", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.writeFiles({ "/test.txt": "content" });
      const cmd = await sandbox.runCommand("cat /test.txt; cat /nonexistent");
      const output = await cmd.output();
      expect(output).toContain("content");
      expect(output).toContain("No such file");
    });
  });

  describe("Command.wait()", () => {
    it("should wait for command completion", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo done");
      const finished = await cmd.wait();
      expect(finished.exitCode).toBe(0);
    });

    it("should return CommandFinished with exitCode", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("false");
      const finished = await cmd.wait();
      expect(finished.exitCode).toBe(1);
    });
  });

  describe("Command.logs()", () => {
    it("should yield stdout messages", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo hello");
      const messages: OutputMessage[] = [];
      for await (const msg of cmd.logs()) {
        messages.push(msg);
      }
      expect(messages.length).toBe(1);
      expect(messages[0].type).toBe("stdout");
      expect(messages[0].data).toBe("hello\n");
    });

    it("should yield stderr messages", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("cat /nonexistent");
      const messages: OutputMessage[] = [];
      for await (const msg of cmd.logs()) {
        messages.push(msg);
      }
      const stderrMsg = messages.find((m) => m.type === "stderr");
      expect(stderrMsg).toBeDefined();
      expect(stderrMsg?.data).toContain("No such file");
    });

    it("should have timestamp on messages", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand("echo test");
      for await (const msg of cmd.logs()) {
        expect(msg.timestamp).toBeInstanceOf(Date);
      }
    });
  });

  describe("Command.kill()", () => {
    it("should abort a running command", async () => {
      const sandbox = await Sandbox.create();
      const cmd = await sandbox.runCommand({
        cmd: "sleep",
        args: ["1"],
        detached: true,
      });
      const start = Date.now();
      await cmd.kill();
      const finished = await cmd.wait();
      const elapsedMs = Date.now() - start;
      expect(elapsedMs).toBeLessThan(500);
      expect([0, 124]).toContain(finished.exitCode);
    });
  });

  describe("sandbox.writeFiles()", () => {
    it("should write string content", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.writeFiles({
        "/test.txt": "hello world",
      });
      const cmd = await sandbox.runCommand("cat /test.txt");
      const output = await cmd.stdout();
      expect(output).toBe("hello world");
    });

    it("should write object content with utf-8 encoding", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.writeFiles({
        "/test.txt": { content: "hello", encoding: "utf-8" },
      });
      const content = await sandbox.readFile("/test.txt");
      expect(content).toBe("hello");
    });

    it("should write object content with base64 encoding", async () => {
      const sandbox = await Sandbox.create();
      const base64Content = Buffer.from("decoded content").toString("base64");
      await sandbox.writeFiles({
        "/test.txt": { content: base64Content, encoding: "base64" },
      });
      const content = await sandbox.readFile("/test.txt");
      expect(content).toBe("decoded content");
    });

    it("should create parent directories", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.writeFiles({
        "/deep/nested/path/file.txt": "content",
      });
      const cmd = await sandbox.runCommand("cat /deep/nested/path/file.txt");
      const output = await cmd.stdout();
      expect(output).toBe("content");
    });

    it("should write multiple files", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.writeFiles({
        "/a.txt": "content a",
        "/b.txt": "content b",
        "/c.txt": "content c",
      });
      const cmdA = await sandbox.runCommand("cat /a.txt");
      const cmdB = await sandbox.runCommand("cat /b.txt");
      const cmdC = await sandbox.runCommand("cat /c.txt");
      expect(await cmdA.stdout()).toBe("content a");
      expect(await cmdB.stdout()).toBe("content b");
      expect(await cmdC.stdout()).toBe("content c");
    });
  });

  describe("sandbox.readFile()", () => {
    it("should read file content as utf-8 by default", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.writeFiles({ "/test.txt": "hello" });
      const content = await sandbox.readFile("/test.txt");
      expect(content).toBe("hello");
    });

    it("should read file content as base64 when specified", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.writeFiles({ "/test.txt": "hello" });
      const content = await sandbox.readFile("/test.txt", "base64");
      expect(content).toBe(Buffer.from("hello").toString("base64"));
    });
  });

  describe("sandbox.mkDir()", () => {
    it("should create a directory", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.mkDir("/mydir");
      // Verify by writing a file into it
      await sandbox.writeFiles({ "/mydir/test.txt": "content" });
      const content = await sandbox.readFile("/mydir/test.txt");
      expect(content).toBe("content");
    });

    it("should create nested directories with recursive option", async () => {
      const sandbox = await Sandbox.create();
      await sandbox.mkDir("/a/b/c", { recursive: true });
      // Verify by writing a file into the deepest directory
      await sandbox.writeFiles({ "/a/b/c/test.txt": "nested" });
      const content = await sandbox.readFile("/a/b/c/test.txt");
      expect(content).toBe("nested");
    });
  });

  describe("sandbox.stop()", () => {
    it("should be a no-op but not throw", async () => {
      const sandbox = await Sandbox.create();
      await expect(sandbox.stop()).resolves.toBeUndefined();
    });
  });

  describe("sandbox.extendTimeout()", () => {
    it("should be a no-op but not throw", async () => {
      const sandbox = await Sandbox.create();
      await expect(sandbox.extendTimeout(5000)).resolves.toBeUndefined();
    });
  });

  describe("sandbox.domain", () => {
    it("should return undefined", async () => {
      const sandbox = await Sandbox.create();
      expect(sandbox.domain).toBeUndefined();
    });
  });

  describe("sandbox.bashEnvInstance", () => {
    it("should expose the underlying BashEnv", async () => {
      const sandbox = await Sandbox.create();
      const bashEnv = sandbox.bashEnvInstance;
      expect(bashEnv).toBeDefined();
      expect(typeof bashEnv.exec).toBe("function");
    });

    it("should allow direct BashEnv operations", async () => {
      const sandbox = await Sandbox.create();
      const result = await sandbox.bashEnvInstance.exec("echo direct");
      expect(result.stdout).toBe("direct\n");
    });
  });

  describe("Integration tests", () => {
    it("should handle multi-step workflow", async () => {
      const sandbox = await Sandbox.create({ cwd: "/app" });

      // Write files
      await sandbox.writeFiles({
        "/app/script.sh": 'echo "Step 1"\necho "Step 2"\necho "Done"',
      });

      // Run script
      const cmd = await sandbox.runCommand("bash /app/script.sh");
      const output = await cmd.stdout();

      expect(output).toContain("Step 1");
      expect(output).toContain("Step 2");
      expect(output).toContain("Done");

      await sandbox.stop();
    });

    it("should handle file manipulation workflow", async () => {
      const sandbox = await Sandbox.create();

      // Create directory structure
      await sandbox.mkDir("/project/src", { recursive: true });

      // Write source files
      await sandbox.writeFiles({
        "/project/src/main.ts": 'console.log("Hello");',
        "/project/package.json": '{"name": "test"}',
      });

      // Verify with commands
      const findCmd = await sandbox.runCommand("find /project -type f");
      const findOutput = await findCmd.stdout();
      expect(findOutput).toContain("main.ts");
      expect(findOutput).toContain("package.json");

      // Read back
      const content = await sandbox.readFile("/project/src/main.ts");
      expect(content).toBe('console.log("Hello");');
    });

    it("should handle error scenarios gracefully", async () => {
      const sandbox = await Sandbox.create();

      // Command that fails
      const cmd = await sandbox.runCommand("cat /nonexistent");
      const finished = await cmd.wait();

      expect(finished.exitCode).not.toBe(0);
      const stderr = await cmd.stderr();
      expect(stderr).toContain("No such file");
    });
  });

  describe("defense-in-depth", () => {
    it("should enable defense-in-depth by default", async () => {
      const sandbox = await Sandbox.create();
      // Defense-in-depth is active — verify via bashEnvInstance
      expect(sandbox.bashEnvInstance).toBeDefined();
      // Execute a command to verify it works with defense enabled
      const cmd = await sandbox.runCommand("echo ok");
      const stdout = await cmd.stdout();
      expect(stdout.trim()).toBe("ok");
    });

    it("should allow disabling defense-in-depth", async () => {
      const sandbox = await Sandbox.create({ defenseInDepth: false });
      const cmd = await sandbox.runCommand("echo ok");
      const stdout = await cmd.stdout();
      expect(stdout.trim()).toBe("ok");
    });
  });
});
