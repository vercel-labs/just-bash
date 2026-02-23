import { describe, expect, it } from "vitest";
import { Bash } from "../../Bash.js";

describe("js-exec", () => {
  describe("basic execution", () => {
    it("should execute simple console.log", { timeout: 30000 }, async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec('js-exec -c "console.log(1 + 2)"');
      expect(result.stdout).toBe("3\n");
      expect(result.exitCode).toBe(0);
    });

    it("should execute string operations", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log('hello' + ' ' + 'world')"`,
      );
      expect(result.stdout).toBe("hello world\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle multiple console.log calls", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log('a'); console.log('b')"`,
      );
      expect(result.stdout).toBe("a\nb\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle JSON operations", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "console.log(JSON.stringify({a: 1, b: 2}))"`,
      );
      expect(result.stdout).toBe('{"a":1,"b":2}\n');
      expect(result.exitCode).toBe(0);
    });

    it("should handle console.error writing to stderr", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "console.error('oops')"`);
      expect(result.stderr).toContain("oops\n");
      expect(result.exitCode).toBe(0);
    });

    it("should handle console.warn writing to stderr", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "console.warn('warning')"`);
      expect(result.stderr).toContain("warning\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("help and version", () => {
    it("should show help with --help", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec("js-exec --help");
      expect(result.stdout).toContain("js-exec");
      expect(result.stdout).toContain("Node.js Compatibility");
      expect(result.exitCode).toBe(0);
    });

    it("should show version with --version", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec("js-exec --version");
      expect(result.stdout).toContain("QuickJS");
      expect(result.exitCode).toBe(0);
    });

    it("should show version with -V", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec("js-exec -V");
      expect(result.stdout).toContain("QuickJS");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    it("should report syntax errors", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "if ("`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBeTruthy();
    });

    it("should report runtime errors", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "undefinedVariable.method()"`);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBeTruthy();
    });

    it("should handle thrown errors", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "throw new Error('test error')"`,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("test error");
    });

    it("should error when no input provided", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec("js-exec");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("no input provided");
    });

    it("should error when -c has no argument", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec("js-exec -c");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("option requires an argument");
    });

    it("should error on unknown option", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec("js-exec --bad");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("unrecognized option");
    });
  });

  describe("script file execution", () => {
    it("should execute a script file", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/test.js": 'console.log("from file")\n',
        },
      });
      const result = await env.exec("js-exec /home/user/test.js");
      expect(result.stdout).toBe("from file\n");
      expect(result.exitCode).toBe(0);
    });

    it("should error on missing script file", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec("js-exec nonexistent.js");
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("No such file or directory");
    });
  });

  describe("stdin execution", () => {
    it("should execute from stdin", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec("echo 'console.log(42)' | js-exec");
      expect(result.stdout).toBe("42\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("process.exit", () => {
    it("should handle process.exit(0)", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "process.exit(0)"`);
      expect(result.exitCode).toBe(0);
    });

    it("should handle process.exit(42)", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "process.exit(42)"`);
      expect(result.exitCode).toBe(42);
    });

    it("should not execute code after process.exit", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(
        `js-exec -c "process.exit(1); console.log('unreachable')"`,
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
    });
  });

  describe("process.argv", () => {
    it("should provide script args via process.argv", async () => {
      const env = new Bash({
        javascript: true,
        files: {
          "/home/user/args.js": "console.log(JSON.stringify(process.argv))\n",
        },
      });
      const result = await env.exec("js-exec /home/user/args.js foo bar");
      const argv = JSON.parse(result.stdout.trim());
      expect(argv).toContain("foo");
      expect(argv).toContain("bar");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("process.cwd", () => {
    it("should return current working directory", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "console.log(process.cwd())"`);
      expect(result.stdout.trim()).toBeTruthy();
      expect(result.exitCode).toBe(0);
    });
  });

  describe("env access", () => {
    it("should access environment variables via env", async () => {
      const env = new Bash({
        javascript: true,
        env: { MY_VAR: "hello" },
      });
      const result = await env.exec(`js-exec -c "console.log(env.MY_VAR)"`);
      expect(result.stdout).toBe("hello\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("console.log with multiple args", () => {
    it("should join multiple args with space", async () => {
      const env = new Bash({ javascript: true });
      const result = await env.exec(`js-exec -c "console.log('a', 'b', 'c')"`);
      expect(result.stdout).toBe("a b c\n");
      expect(result.exitCode).toBe(0);
    });
  });

  describe("opt-in behavior", () => {
    it("should not be available when javascript is not enabled", async () => {
      const env = new Bash();
      const result = await env.exec(`js-exec -c "console.log('hello')"`);
      expect(result.exitCode).toBe(127);
      expect(result.stderr).toContain("command not found");
    });
  });

  describe("bootstrap code", () => {
    it("should run bootstrap code before user code", async () => {
      const env = new Bash({
        javascript: {
          bootstrap: "globalThis.greeting = 'hello from bootstrap';",
        },
      });
      const result = await env.exec(`js-exec -c "console.log(greeting)"`);
      expect(result.stdout).toBe("hello from bootstrap\n");
      expect(result.exitCode).toBe(0);
    });
  });
});
